import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Empty, useMe } from "@/components/AppShell";
import { EqStatus, ResStatus } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EquipmentManager } from "@/components/EquipmentManager";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { busySlots } from "@/lib/lookup";
import {
  decideReservation,
  directCheckout,
  resolveIncident,
  setBlocked,
  takeIncident,
  useDB,
} from "@/lib/data";
import { formatDate } from "@/lib/rules";

export const Route = createFileRoute("/tech")({
  head: () => ({
    meta: [
      { title: "Console technicien — ISMAC-FLT" },
      { name: "description", content: "Opérations du jour, demandes et incidents." },
      { property: "og:title", content: "Console technicien — ISMAC-FLT" },
      { property: "og:description", content: "Opérations du jour, demandes et incidents." },
    ],
  }),
  component: TechPage,
});

const run = async (fn: () => Promise<unknown>, ok: string) => {
  try {
    await fn();
    toast.success(ok);
  } catch (e) {
    toast.error((e as Error).message);
  }
};

function TechPage() {
  const db = useDB();
  const me = useMe();
  const [reason, setReason] = useState<Record<string, string>>({});
  if (me && me.role === "student")
    return (
      <AppShell title="Console">
        <Empty>Accès réservé aux techniciens.</Empty>
      </AppShell>
    );
  const tz = db.settings.timezone;
  const name = (id: string) => db.profiles.find((p) => p.id === id)?.full_name ?? "?";
  const pending = db.reservations.filter((r) => r.status === "requested");
  const today = new Date();
  today.setHours(23, 59, 59);
  const pickups = db.reservations.filter(
    (r) => r.status === "approved" && new Date(r.start_at) <= today,
  );
  const returns = db.reservations
    .filter((r) => ["active", "overdue"].includes(r.status))
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const openInc = db.incidents.filter((i) => i.status !== "resolved");

  return (
    <AppShell title="Console technicien">
      <div className="mb-4 grid grid-cols-4 gap-2 text-center">
        {[
          ["Demandes", pending.length],
          ["Sorties", pickups.length],
          ["Retours", returns.length],
          ["Incidents", openInc.length],
        ].map(([l, n]) => (
          <div key={l} className="rounded-lg border bg-card p-2">
            <div className="font-mono text-xl font-semibold">{n}</div>
            <div className="text-[11px] text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>
      <Tabs defaultValue="ops">
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="ops">Jour</TabsTrigger>
          <TabsTrigger value="req">Demandes</TabsTrigger>
          <TabsTrigger value="plan">Planning</TabsTrigger>
          <TabsTrigger value="inc">Incidents</TabsTrigger>
          <TabsTrigger value="eq">Matériel</TabsTrigger>
          <TabsTrigger value="users">Comptes</TabsTrigger>
        </TabsList>

        <TabsContent value="ops" className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Retours attendus / en retard</h3>
            {returns.length ? (
              <ul className="divide-y rounded-lg border bg-card">
                {returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between p-3 text-sm">
                    <span>
                      {name(r.borrower_id)} — {formatDate(r.due_at, tz)}
                    </span>
                    <ResStatus s={r.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Aucun retour attendu.</Empty>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Sorties attendues aujourd'hui</h3>
            {pickups.length ? (
              <ul className="divide-y rounded-lg border bg-card">
                {pickups.map((r) => (
                  <li key={r.id} className="p-3 text-sm">
                    {name(r.borrower_id)} — {formatDate(r.start_at, tz)} · {r.purpose}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Aucune sortie prévue.</Empty>
            )}
          </section>
          <Button asChild size="lg" className="h-14 w-full">
            <Link to="/scan">Scanner un retour / une sortie</Link>
          </Button>
          {db.settings.technician_direct_checkout && (
            <form
              className="space-y-2 rounded-lg border bg-card p-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                void run(async () => {
                  await directCheckout(
                    String(f.get("de")),
                    String(f.get("db")),
                    new Date(String(f.get("dd"))),
                  );
                  form.reset();
                }, "Sortie directe enregistrée.");
              }}
            >
              <h3 className="font-semibold">Retrait direct (sans réservation)</h3>
              <select
                name="de"
                required
                aria-label="Équipement"
                className="h-10 w-full rounded border bg-background px-2"
              >
                <option value="">Équipement disponible…</option>
                {db.equipment
                  .filter((x) => x.status === "available")
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.asset_code} — {x.name}
                    </option>
                  ))}
              </select>
              <select
                name="db"
                required
                aria-label="Emprunteur"
                className="h-10 w-full rounded border bg-background px-2"
              >
                <option value="">Emprunteur…</option>
                {db.profiles
                  .filter((p) => p.role === "student" && !p.is_blocked)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} — {p.promo}
                    </option>
                  ))}
              </select>
              <Input name="dd" type="datetime-local" required aria-label="Échéance" />
              <Button className="w-full">Enregistrer la sortie</Button>
            </form>
          )}
        </TabsContent>

        <TabsContent value="req" className="space-y-2">
          {!pending.length && <Empty>Aucune demande en attente.</Empty>}
          {pending.map((r) => (
            <div key={r.id} className="rounded-lg border bg-card p-3 text-sm">
              <b>{name(r.borrower_id)}</b> — {r.purpose}
              <div className="text-xs text-muted-foreground">
                {formatDate(r.start_at, tz)} → {formatDate(r.due_at, tz)}
              </div>
              <div className="mt-1 text-xs">
                {db.items
                  .filter((i) => i.reservation_id === r.id)
                  .map((i) => db.equipment.find((e) => e.id === i.equipment_id)?.asset_code)
                  .join(", ")}
              </div>
              <Input
                className="mt-2"
                placeholder="Motif (obligatoire si refus)"
                value={reason[r.id] ?? ""}
                onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(() => decideReservation(r.id, false, reason[r.id] ?? ""), "Refusée.")
                  }
                >
                  Refuser
                </Button>
                <Button
                  onClick={() =>
                    void run(() => decideReservation(r.id, true, reason[r.id] ?? ""), "Approuvée.")
                  }
                >
                  Approuver
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="inc" className="space-y-2">
          {!openInc.length && <Empty>Aucun incident ouvert.</Empty>}
          {openInc.map((i) => {
            const e = db.equipment.find((x) => x.id === i.equipment_id)!;
            return (
              <div key={i.id} className="rounded-lg border bg-card p-3 text-sm">
                <b className="font-mono">{e.asset_code}</b> {e.name} —{" "}
                {formatDate(i.created_at, tz)} par {name(i.reported_by)}
                <p className="mt-1">{i.description}</p>
                <p className="text-xs text-muted-foreground">
                  Statut : {i.status === "open" ? "Ouvert" : "Pris en charge"}
                </p>
                {i.photo_url && (
                  <img
                    src={i.photo_url}
                    alt="Photo de l'anomalie"
                    className="mt-2 max-h-40 rounded"
                  />
                )}
                {i.status === "open" && (
                  <Button
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => void run(() => takeIncident(i.id), "Incident pris en charge.")}
                  >
                    Prendre en charge
                  </Button>
                )}
                <Input
                  className="mt-2"
                  placeholder="Résolution"
                  value={reason[i.id] ?? ""}
                  onChange={(x) => setReason({ ...reason, [i.id]: x.target.value })}
                />
                <Button
                  className="mt-2 w-full"
                  onClick={() =>
                    void run(
                      () => resolveIncident(i.id, reason[i.id] ?? "", true),
                      "Incident résolu.",
                    )
                  }
                >
                  Résoudre et remettre disponible
                </Button>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="plan">
          <AvailabilityCalendar equipment={db.equipment} busy={busySlots(db)} days={14} />
        </TabsContent>

        <TabsContent value="eq">
          <EquipmentManager />
        </TabsContent>

        <TabsContent value="users">
          <ul className="divide-y rounded-lg border bg-card">
            {db.profiles
              .filter((p) => p.role === "student")
              .map((p) => (
                <li key={p.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      <b>{p.full_name}</b> · {p.promo}
                    </span>
                    <Button
                      size="sm"
                      variant={p.is_blocked ? "default" : "outline"}
                      onClick={() =>
                        void run(
                          () =>
                            setBlocked(
                              p.id,
                              !p.is_blocked,
                              p.is_blocked ? "Débloqué par technicien" : "Blocage manuel",
                            ),
                          "Mis à jour.",
                        )
                      }
                    >
                      {p.is_blocked ? "Débloquer" : "Bloquer"}
                    </Button>
                  </div>
                  {p.is_blocked && (
                    <p className="text-xs text-bad">
                      {p.blocked_reason}
                      {p.contest_note && ` — Contestation : ${p.contest_note}`}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
