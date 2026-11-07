import type { AppSettings, Reservation, ReservationItem } from "./types";

/** Statuses that hold a physical unit (block other reservations). */
export const BLOCKING_STATUSES = ["requested", "approved", "active", "overdue"] as const;

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface ConflictInput {
  equipmentIds: string[];
  start: Date;
  end: Date;
  reservations: Reservation[];
  items: ReservationItem[];
  excludeReservationId?: string;
}

/** Returns equipment ids that are already booked on an overlapping slot. */
export function findConflicts({
  equipmentIds,
  start,
  end,
  reservations,
  items,
  excludeReservationId,
}: ConflictInput): string[] {
  const byId = new Map(reservations.map((r) => [r.id, r]));
  const conflicts = new Set<string>();
  for (const it of items) {
    if (!equipmentIds.includes(it.equipment_id)) continue;
    if (it.status === "returned" || it.status === "cancelled") continue;
    const r = byId.get(it.reservation_id);
    if (!r || r.id === excludeReservationId) continue;
    if (!(BLOCKING_STATUSES as readonly string[]).includes(r.status)) continue;
    if (overlaps(start, end, new Date(r.start_at), new Date(r.due_at)))
      conflicts.add(it.equipment_id);
  }
  return [...conflicts];
}

export function validateReservationWindow(
  start: Date,
  end: Date,
  settings: AppSettings,
  now = new Date(),
): string | null {
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "Dates invalides.";
  if (end <= start) return "L'échéance doit être après le début.";
  if (end.getTime() < now.getTime()) return "L'échéance est déjà passée.";
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours > settings.max_loan_hours) return `Durée maximale : ${settings.max_loan_hours} h.`;
  return null;
}

/** Minutes late beyond grace; 0 if not late. */
export function minutesOverdue(dueAt: Date, now: Date, graceMinutes = 0): number {
  const diff = (now.getTime() - dueAt.getTime()) / 60_000 - graceMinutes;
  return diff > 0 ? Math.floor(diff) : 0;
}

export function isOverdue(dueAt: Date, now: Date, graceMinutes = 0): boolean {
  return minutesOverdue(dueAt, now, graceMinutes) > 0;
}

/** Should the responsible borrower be blocked? Only the borrower, never a group. */
export function shouldBlockBorrower(dueAt: Date, now: Date, s: AppSettings): boolean {
  const late = minutesOverdue(dueAt, now, s.overdue_grace_minutes);
  return late >= s.block_after_overdue_hours * 60;
}

export function withinPickupWindow(
  startAt: Date,
  dueAt: Date,
  now: Date,
  windowMinutes: number,
): boolean {
  const opens = startAt.getTime() - windowMinutes * 60_000;
  return now.getTime() >= opens && now.getTime() < dueAt.getTime();
}

export function formatDate(iso: string | Date, tz: string, withTime = true): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

export function relativeDue(dueAt: string, now = new Date()): string {
  const m = Math.round((new Date(dueAt).getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(m);
  const txt =
    abs < 60
      ? `${abs} min`
      : abs < 2880
        ? `${Math.round(abs / 60)} h`
        : `${Math.round(abs / 1440)} j`;
  return m >= 0 ? `dans ${txt}` : `en retard de ${txt}`;
}
