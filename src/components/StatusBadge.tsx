import { cn } from "@/lib/utils";
import type { EquipmentStatus, ReservationStatus } from "@/lib/types";

type Tone = "ok" | "warn" | "bad" | "idle";
const toneCls: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  idle: "bg-idle-soft text-idle",
};
export const EQ_LABEL: Record<EquipmentStatus, [string, Tone]> = {
  available: ["Disponible", "ok"],
  reserved: ["Réservé", "warn"],
  checked_out: ["Emprunté", "bad"],
  maintenance: ["Maintenance", "idle"],
  out_of_service: ["Hors service", "idle"],
};
export const RES_LABEL: Record<ReservationStatus, [string, Tone]> = {
  requested: ["En attente", "warn"],
  approved: ["Approuvée", "ok"],
  active: ["En cours", "ok"],
  returned: ["Rendue", "idle"],
  cancelled: ["Annulée", "idle"],
  rejected: ["Refusée", "bad"],
  overdue: ["En retard", "bad"],
};

export function Pill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneCls[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
export function EqStatus({ s }: { s: EquipmentStatus }) {
  const [l, t] = EQ_LABEL[s];
  return <Pill tone={t}>{l}</Pill>;
}
export function ResStatus({ s }: { s: ReservationStatus }) {
  const [l, t] = RES_LABEL[s];
  return <Pill tone={t}>{l}</Pill>;
}
