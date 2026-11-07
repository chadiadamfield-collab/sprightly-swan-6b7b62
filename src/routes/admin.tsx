import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, Empty, useMe } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DATA_MODE } from "@/lib/supabase";
import { resetDemo, setRole, updateSettings, useDB } from "@/lib/data";
import { formatDate } from "@/lib/rules";
import type { AppSettings, Role } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Réglages — ISMAC-FLT" },
      { name: "description", content: "Rôles, règles et journal d'audit." },
      { property: "og:title", content: "Réglages — ISMAC-FLT" },
      { property: "og:description", content: "Rôles, règles et journal d'audit." },
    ],
  }),
  component: AdminPage,
});

function csv(rows: Record<string, unknown>[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const body = [
    keys.join(";"),
    ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(";")),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + body], { type: "text/csv" }));
  a.download = name;
  a.click();
}

function AdminPage() {
  const db = useDB();
  const me = useMe();
  const [s, setS] = useState<AppSettings>(db.settings);
  // En mode Supabase les réglages arrivent après le premier rendu.
  useEffect(() => {
    setS(db.settings);
  }, [db.settings]);
  if (me && me.role !== "admin")
    return (
      <AppShell title="Réglages">
        <Empty>Accès réservé aux administrateurs.</Empty>
      </AppShell>
    );
  const num = (k: keyof AppSettings, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={k}>{label}</Label>
      <Input
        id={k}
        type="number"
        min={0}
        value={Number(s[k])}
        onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
      />
    </div>
  );
  const sw = (k: keyof AppSettings, label: string) => (
    <label className="flex items-center justify-between text-sm">
      {label}
      <Switch checked={Boolean(s[k])} onCheckedChange={(v) => setS({ ...s, [k]: v })} />
    </label>
  );
  const total = db.equipment.length;
  const avail = db.equipment.filter((e) => e.status === "available").length;
  const loansDone = db.items.filter((i) => i.returned_at && i.checked_out_at);
  const avgH = loansDone.length
    ? loansDone.reduce(
        (n, i) =>
          n +
          (new Date(i.returned_at!).getTime() - new Date(i.checked_out_at!).getTime()) / 3_600_000,
        0,
      ) / loansDone.length
    : 0;
  const kpis: [string, string][] = [
    ["Disponibilité du parc", total ? `${Math.round((avail / total) * 100)} %` : "—"],
    ["Sorties totales", String(db.items.filter((i) => i.checked_out_at).length)],
    [
      "Réservations en retard",
      String(db.reservations.filter((r) => r.status === "overdue").length),
    ],
    ["Incidents ouverts", String(db.incidents.filter((i) => i.status !== "resolved").length)],
    ["Comptes bloqués", String(db.profiles.filter((p) => p.is_blocked).length)],
    ["Durée moyenne d'emprunt", loansDone.length ? `${avgH.toFixed(1)} h` : "—"],
  ];
  const reservationRows = db.reservations.map((r) => ({
    id: r.id,
    emprunteur: db.profiles.find((p) => p.id === r.borrower_id)?.full_name ?? "",
    statut: r.status,
    debut: r.start_at,
    echeance: r.due_at,
    motif: r.purpose,
    objets: db.items
      .filter((i) => i.reservation_id === r.id)
      .map((i) => db.equipment.find((e) => e.id === i.equipment_id)?.asset_code)
      .join(" "),
  }));
  const usage = db.equipment.map((e) => ({
    code: e.asset_code,
    nom: e.name,
    sorties: db.items.filter((i) => i.equipment_id === e.id && i.checked_out_at).length,
    incidents: db.incidents.filter((i) => i.equipment_id === e.id).length,
  }));

  return (
    <AppShell title="Réglages">
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Règles</h2>
          <div className="space-y-1">
            <Label htmlFor="tz">Fuseau horaire</Label>
            <Input
              id="tz"
              value={s.timezone}
              onChange={(e) => setS({ ...s, timezone: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {num("max_loan_hours", "Durée max (h)")}
            {num("pickup_window_minutes", "Fenêtre retrait (min)")}
            {num("overdue_grace_minutes", "Tolérance retard (min)")}
            {num("block_after_overdue_hours", "Blocage après (h)")}
          </div>
          {sw("reminder_d1", "Rappel J-1")}
          {sw("reminder_h3", "Rappel H-3")}
          {sw("show_holder_to_students", "Montrer le détenteur aux étudiants")}
          {sw("technician_direct_checkout", "Retrait direct administrateur")}
          <Button
            onClick={async () => {
              try {
                new Intl.DateTimeFormat("fr", { timeZone: s.timezone });
                await updateSettings(s);
                toast.success("Paramètres enregistrés.");
              } catch (e) {
                toast.error(
                  e instanceof RangeError ? "Fuseau horaire invalide." : (e as Error).message,
                );
              }
            }}
          >
            Enregistrer
          </Button>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Utilisateurs et rôles</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {db.profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="min-w-0 truncate">
                  <b>{p.full_name}</b> <span className="text-muted-foreground">{p.email}</span>
                </span>
                <select
                  aria-label={`Rôle de ${p.full_name}`}
                  disabled={p.id === me?.id}
                  className="rounded border bg-background px-2 py-1"
                  value={p.role}
                  onChange={async (e) => {
                    try {
                      await setRole(p.id, e.target.value as Role);
                      toast.success("Rôle modifié.");
                    } catch (x) {
                      toast.error((x as Error).message);
                    }
                  }}
                >
                  <option value="student">Étudiant</option>
                  <option value="technician">Administrateur</option>
                  <option value="admin">Super-admin</option>
                </select>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Statistiques</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => csv(usage, "usage.csv")}>
                CSV usage
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => csv(reservationRows, "reservations.csv")}
              >
                CSV réservations
              </Button>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {kpis.map(([l, v]) => (
              <div key={l} className="rounded-lg border bg-card p-3">
                <div className="font-mono text-xl font-semibold">{v}</div>
                <div className="text-[11px] text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {usage
              .sort((a, b) => b.sorties - a.sorties)
              .slice(0, 8)
              .map((u) => (
                <li key={u.code} className="flex justify-between p-2">
                  <span>
                    <span className="font-mono">{u.code}</span> {u.nom}
                  </span>
                  <span>
                    {u.sorties} sorties · {u.incidents} inc.
                  </span>
                </li>
              ))}
          </ul>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Journal d'audit</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => csv(db.audit as unknown as Record<string, unknown>[], "audit.csv")}
            >
              Export CSV
            </Button>
          </div>
          {db.audit.length ? (
            <ul className="max-h-80 divide-y overflow-auto rounded-lg border bg-card text-xs">
              {db.audit.map((a) => (
                <li key={a.id} className="p-2">
                  <span className="text-muted-foreground">
                    {formatDate(a.created_at, db.settings.timezone)}
                  </span>{" "}
                  · <b>{a.action}</b> ·{" "}
                  {a.actor_id ? db.profiles.find((p) => p.id === a.actor_id)?.full_name : "système"}{" "}
                  {a.details}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Journal vide.</Empty>
          )}
        </section>
        {DATA_MODE === "demo" && (
          <Button
            variant="destructive"
            onClick={() => {
              resetDemo();
              toast.success("Données de démo réinitialisées.");
            }}
          >
            Réinitialiser la démo
          </Button>
        )}
      </div>
    </AppShell>
  );
}
