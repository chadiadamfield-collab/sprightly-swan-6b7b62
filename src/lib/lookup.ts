import type { DB } from "./demo-store";
import type { Equipment, Reservation, ReservationItem } from "./types";
import { withinPickupWindow } from "./rules";

/** Fonctions pures sur un instantané de base (utilisées par le mode Supabase). */
export function resolveTokenIn(d: DB, code: string): Equipment | undefined {
  const c = code.trim();
  return d.equipment.find(
    (e) => e.qr_token === c || e.asset_code.toLowerCase() === c.toLowerCase(),
  );
}

type Found = { item: ReservationItem; res: Reservation } | { error: string };

export function findCheckoutItemIn(d: DB, equipmentId: string): Found {
  const p = d.profiles.find((x) => x.id === d.sessionUserId);
  if (!p) return { error: "Session expirée." };
  const e = d.equipment.find((x) => x.id === equipmentId);
  if (!e) return { error: "Équipement introuvable." };
  const staff = p.role !== "student";
  const now = new Date();
  for (const it of d.items.filter(
    (i) => i.equipment_id === equipmentId && i.status === "pending",
  )) {
    const r = d.reservations.find((x) => x.id === it.reservation_id);
    if (!r || !["approved", "active"].includes(r.status)) continue;
    if (r.borrower_id !== p.id && !staff) continue;
    if (
      !withinPickupWindow(
        new Date(r.start_at),
        new Date(r.due_at),
        now,
        d.settings.pickup_window_minutes,
      )
    )
      return {
        error: `Hors fenêtre de retrait (ouvre ${d.settings.pickup_window_minutes} min avant le début).`,
      };
    if (e.status !== "available" && e.status !== "reserved")
      return { error: `Objet non disponible (${e.status}).` };
    return { item: it, res: r };
  }
  return { error: "Aucune réservation approuvée à votre nom pour cet objet." };
}

export function findReturnItemIn(d: DB, equipmentId: string): Found {
  const p = d.profiles.find((x) => x.id === d.sessionUserId);
  if (!p) return { error: "Session expirée." };
  const it = d.items.find((i) => i.equipment_id === equipmentId && i.status === "checked_out");
  if (!it) return { error: "Cet objet n'est pas sorti, ou n'est pas lié à votre emprunt." };
  const r = d.reservations.find((x) => x.id === it.reservation_id);
  if (!r) return { error: "Réservation introuvable." };
  if (r.borrower_id !== p.id && p.role === "student")
    return { error: "Cet objet n'est pas lié à votre emprunt." };
  return { item: it, res: r };
}

/** Échéance / détenteur d'un objet sorti, selon les permissions. Utilise `board` (Supabase) sinon dérive des données locales. */
export function boardOf(
  d: DB,
  equipmentId: string,
  canSeeHolder: boolean,
): { due_at?: string; holder?: string | null } {
  if (d.board) {
    const b = d.board[equipmentId];
    return b ? { due_at: b.due_at, holder: b.holder_name } : {};
  }
  const it = d.items.find((i) => i.equipment_id === equipmentId && i.status === "checked_out");
  const r = it && d.reservations.find((x) => x.id === it.reservation_id);
  if (!r) return {};
  const holder = d.profiles.find((p) => p.id === r.borrower_id);
  return {
    due_at: r.due_at,
    holder: canSeeHolder || d.settings.show_holder_to_students ? (holder?.full_name ?? null) : null,
  };
}

export interface HistoryEvent {
  at: string;
  kind: string;
  detail: string | null;
  holder_name: string | null;
  mine: boolean;
}

/** Historique d'un équipement selon la politique de confidentialité (même règles que la RPC equipment_history). */
export function historyIn(d: DB, equipmentId: string): HistoryEvent[] {
  const me = d.profiles.find((p) => p.id === d.sessionUserId);
  const staff = !!me && me.role !== "student";
  const reveal = staff || d.settings.show_holder_to_students;
  const ev: HistoryEvent[] = [];
  for (const i of d.items.filter((x) => x.equipment_id === equipmentId)) {
    const r = d.reservations.find((x) => x.id === i.reservation_id);
    if (!r) continue;
    const mine = r.borrower_id === me?.id;
    const name =
      reveal || mine ? (d.profiles.find((p) => p.id === r.borrower_id)?.full_name ?? null) : null;
    if (i.checked_out_at)
      ev.push({ at: i.checked_out_at, kind: "checkout", detail: null, holder_name: name, mine });
    if (i.returned_at)
      ev.push({ at: i.returned_at, kind: "return", detail: null, holder_name: name, mine });
  }
  for (const c of d.checks.filter((x) => x.equipment_id === equipmentId)) {
    const good = c.visual_ok && c.accessories_ok && c.power_ok;
    ev.push({
      at: c.created_at,
      kind: `check_${c.kind}`,
      detail: (good ? "OK" : "Problème") + (staff && c.notes ? ` — ${c.notes}` : ""),
      holder_name: null,
      mine: c.performed_by === me?.id,
    });
  }
  for (const n of d.incidents.filter((x) => x.equipment_id === equipmentId)) {
    ev.push({
      at: n.created_at,
      kind: `incident_${n.status}`,
      detail: staff ? n.description + (n.resolution ? ` → ${n.resolution}` : "") : null,
      holder_name: null,
      mine: n.reported_by === me?.id,
    });
  }
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}

export interface BusySlot {
  equipment_id: string;
  start_at: string;
  due_at: string;
}

/** Créneaux occupés par objet, sans identité. Supabase : fournis par le serveur ; démo : dérivés des réservations. */
export function busySlots(d: DB): BusySlot[] {
  if (d.busy) return d.busy;
  const out: BusySlot[] = [];
  for (const i of d.items) {
    if (i.status !== "pending" && i.status !== "checked_out") continue;
    const r = d.reservations.find((x) => x.id === i.reservation_id);
    if (r) out.push({ equipment_id: i.equipment_id, start_at: r.start_at, due_at: r.due_at });
  }
  return out;
}
