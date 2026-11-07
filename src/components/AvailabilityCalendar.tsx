import { cn } from "@/lib/utils";
import type { BusySlot } from "@/lib/lookup";
import type { Equipment } from "@/lib/types";

const DAY = 86_400_000;
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Frise de disponibilité : une ligne par objet, une colonne par jour.
 * Rouge = déjà réservé / sorti, hachuré = indisponible (maintenance), cadre = créneau choisi.
 * Informatif : le contrôle des conflits est fait par la base au moment de la demande.
 */
export function AvailabilityCalendar({
  equipment,
  busy,
  days = 14,
  window: win,
  onPickDay,
}: {
  equipment: Equipment[];
  busy: BusySlot[];
  days?: number;
  window?: { start: Date; end: Date } | null;
  onPickDay?: (day: Date) => void;
}) {
  const t0 = startOfDay(new Date()).getTime();
  const span = days * DAY;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - t0) / span) * 100));
  const cols = Array.from({ length: days }, (_, i) => new Date(t0 + i * DAY));
  const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit" });
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const grid = { gridTemplateColumns: `repeat(${days}, minmax(34px, 1fr))` };
  const winBox =
    win && win.end.getTime() > t0 && win.start.getTime() < t0 + span
      ? {
          left: `${pct(win.start.getTime())}%`,
          width: `${Math.max(1.5, pct(win.end.getTime()) - pct(win.start.getTime()))}%`,
        }
      : null;

  if (!equipment.length)
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        Sélectionnez du matériel pour voir ses disponibilités.
      </p>
    );

  return (
    <div
      className="overflow-x-auto rounded-lg border bg-card"
      role="group"
      aria-label={`Disponibilités sur ${days} jours`}
    >
      <div className="min-w-[640px]">
        <div className="flex border-b text-[11px]">
          <div className="sticky left-0 z-10 w-24 shrink-0 bg-card" />
          <div className="grid flex-1" style={grid}>
            {cols.map((c, i) => (
              <button
                key={i}
                type="button"
                disabled={!onPickDay}
                onClick={() => onPickDay?.(c)}
                aria-label={`Choisir le ${c.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
                className={cn(
                  "border-l px-0.5 py-1 text-center capitalize leading-tight",
                  i === 0 && "bg-secondary font-semibold",
                  [0, 6].includes(c.getDay()) && "text-muted-foreground",
                  onPickDay && "hover:bg-secondary",
                )}
              >
                {fmtDay.format(c).replace(".", "")}
              </button>
            ))}
          </div>
        </div>
        {equipment.map((e) => {
          const slots = busy.filter(
            (b) =>
              b.equipment_id === e.id &&
              new Date(b.due_at).getTime() > t0 &&
              new Date(b.start_at).getTime() < t0 + span,
          );
          const down = e.status === "maintenance" || e.status === "out_of_service";
          const summary = down
            ? "indisponible"
            : slots.length
              ? "occupé " +
                slots
                  .map(
                    (s) =>
                      `du ${fmt.format(new Date(s.start_at))} au ${fmt.format(new Date(s.due_at))}`,
                  )
                  .join(", ")
              : "libre sur toute la période";
          return (
            <div
              key={e.id}
              className="flex border-b last:border-b-0"
              role="img"
              aria-label={`${e.asset_code} ${e.name} : ${summary}`}
            >
              <div
                className="sticky left-0 z-10 w-24 shrink-0 truncate bg-card px-2 py-2 font-mono text-[11px]"
                title={`${e.asset_code} — ${e.name}`}
              >
                {e.asset_code}
              </div>
              <div className="relative h-8 flex-1">
                <div className="pointer-events-none absolute inset-0 grid" style={grid} aria-hidden>
                  {cols.map((_, i) => (
                    <div key={i} className={cn("border-l", i === 0 && "bg-secondary/60")} />
                  ))}
                </div>
                {down && (
                  <div
                    className="absolute inset-y-1 inset-x-0 rounded bg-idle-soft text-center text-[10px] leading-6 text-idle"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, transparent 0 6px, rgb(0 0 0 / .06) 6px 12px)",
                    }}
                  >
                    Indisponible ({e.status === "maintenance" ? "maintenance" : "hors service"})
                  </div>
                )}
                {!down &&
                  slots.map((s, i) => {
                    const l = pct(new Date(s.start_at).getTime()),
                      r = pct(new Date(s.due_at).getTime());
                    return (
                      <div
                        key={i}
                        className="absolute inset-y-1 rounded bg-bad/70"
                        style={{ left: `${l}%`, width: `${Math.max(1, r - l)}%` }}
                        title={`${fmt.format(new Date(s.start_at))} → ${fmt.format(new Date(s.due_at))}`}
                      />
                    );
                  })}
                {winBox && (
                  <div
                    className="pointer-events-none absolute inset-y-0 rounded border-2 border-accent bg-accent/20"
                    style={winBox}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block size-2.5 rounded-sm bg-bad/70" /> Réservé / sorti
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-2.5 rounded-sm border-2 border-accent" /> Votre créneau
        </span>
        <span>Les horaires s'affichent dans le fuseau de votre appareil.</span>
      </div>
    </div>
  );
}
