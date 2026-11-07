import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EqStatus } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createReservation, useDB } from "@/lib/data";
import { overlaps, validateReservationWindow } from "@/lib/rules";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { busySlots } from "@/lib/lookup";

export const Route = createFileRoute("/reserve")({
  validateSearch: (s: Record<string, unknown>): { eq?: string } => ({
    eq: typeof s.eq === "string" ? s.eq : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Réserver — ISMAC-FLT" },
      { name: "description", content: "Réserver un ou plusieurs équipements." },
      { property: "og:title", content: "Réserver — ISMAC-FLT" },
      { property: "og:description", content: "Réserver un ou plusieurs équipements." },
    ],
  }),
  component: ReservePage,
});

const local = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function ReservePage() {
  const { eq } = Route.useSearch();
  const db = useDB();
  const nav = useNavigate();
  const [start, setStart] = useState(() => local(new Date(Date.now() + 3600_000)));
  const [end, setEnd] = useState(() => local(new Date(Date.now() + 25 * 3600_000)));
  const [purpose, setPurpose] = useState("");
  const [sel, setSel] = useState<string[]>(eq ? [eq] : []);
  const [q, setQ] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const s = new Date(start),
    e = new Date(end);
  const winErr = validateReservationWindow(s, e, db.settings);
  const busy = useMemo(() => busySlots(db), [db]);
  const conflicts = useMemo(() => {
    if (winErr) return [] as string[];
    return [
      ...new Set(
        busy
          .filter((b) => overlaps(s, e, new Date(b.start_at), new Date(b.due_at)))
          .map((b) => b.equipment_id),
      ),
    ];
  }, [busy, start, end, winErr]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = db.equipment.filter((x) =>
    `${x.asset_code} ${x.name} ${x.category}`.toLowerCase().includes(q.toLowerCase()),
  );

  const calEq = sel.length ? db.equipment.filter((x) => sel.includes(x.id)) : list.slice(0, 6);
  const pickDay = (day: Date) => {
    const st = new Date(day);
    st.setHours(9, 0, 0, 0);
    const minStart = new Date(Date.now() + 15 * 60_000);
    const from = st < minStart ? minStart : st;
    const to = new Date(day);
    to.setHours(18, 0, 0, 0);
    setStart(local(from));
    setEnd(local(to > from ? to : new Date(from.getTime() + 4 * 3600_000)));
  };
  const addDuration = (h: number) => {
    const b = new Date(start);
    setEnd(local(new Date(b.getTime() + h * 3600_000)));
  };

  const submit = async () => {
    setIsSubmitting(true);
    try {
      await createReservation(sel, s, e, purpose);
      toast.success("Demande envoyée — en attente de validation administrateur.");
      nav({ to: "/loans" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell title="Nouvelle réservation">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="st">Début</Label>
            <Input
              id="st"
              type="datetime-local"
              value={start}
              onChange={(x) => setStart(x.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="en">Échéance</Label>
            <Input
              id="en"
              type="datetime-local"
              value={end}
              onChange={(x) => setEnd(x.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Durée :</span>
          {[
            [4, "4 h"],
            [24, "1 j"],
            [72, "3 j"],
          ].map(([h, l]) => (
            <Button
              key={l}
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => addDuration(Number(h))}
            >
              {l}
            </Button>
          ))}
        </div>
        {winErr && (
          <p role="alert" className="text-sm text-bad">
            {winErr}
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="pu">Motif / projet</Label>
          <Input
            id="pu"
            value={purpose}
            onChange={(x) => setPurpose(x.target.value)}
            placeholder="Court-métrage, exercice…"
          />
        </div>
        <section>
          <h2 className="mb-1 text-sm font-semibold">
            Disponibilités{" "}
            <span className="font-normal text-muted-foreground">
              — touchez un jour pour proposer un créneau
            </span>
          </h2>
          <AvailabilityCalendar
            equipment={calEq}
            busy={busy}
            window={winErr ? null : { start: s, end: e }}
            onPickDay={pickDay}
          />
        </section>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Équipements ({sel.length})</Label>
            <Input
              aria-label="Filtrer"
              placeholder="Filtrer…"
              value={q}
              onChange={(x) => setQ(x.target.value)}
              className="h-8 w-40"
            />
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {list.map((x) => {
              const blocked = x.status === "maintenance" || x.status === "out_of_service";
              const conflict = conflicts.includes(x.id);
              const dis = blocked || conflict;
              return (
                <li key={x.id}>
                  <label
                    className={`flex items-center gap-3 px-3 py-2.5 ${dis ? "opacity-50" : "cursor-pointer"}`}
                  >
                    <Checkbox
                      disabled={dis}
                      checked={sel.includes(x.id)}
                      onCheckedChange={(v) =>
                        setSel((p) => (v ? [...p, x.id] : p.filter((i) => i !== x.id)))
                      }
                      className="size-5"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-xs text-muted-foreground">
                        {x.asset_code}
                      </span>{" "}
                      <span className="text-sm">{x.name}</span>
                    </div>
                    {conflict ? (
                      <span className="text-xs text-bad">Déjà réservé</span>
                    ) : (
                      <EqStatus s={x.status} />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <Button
          size="lg"
          className="sticky bottom-20 h-14 w-full text-base md:bottom-4"
          disabled={isSubmitting || !!winErr || !sel.length}
          onClick={submit}
        >
          Demander {sel.length} objet{sel.length > 1 ? "s" : ""}
        </Button>
      </div>
    </AppShell>
  );
}
