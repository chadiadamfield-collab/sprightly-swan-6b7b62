import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { AppShell, Empty, useMe } from "@/components/AppShell";
import { EqStatus, ResStatus } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { boardOf } from "@/lib/lookup";
import { getEquipmentHistory, useDB, type HistoryEvent } from "@/lib/data";
import { formatDate, relativeDue } from "@/lib/rules";

export const Route = createFileRoute("/equipment/$id")({
  head: () => ({
    meta: [
      { title: "Fiche équipement — ISMAC-FLT" },
      { name: "description", content: "Statut, emplacement et historique d'un équipement." },
      { property: "og:title", content: "Fiche équipement — ISMAC-FLT" },
      { property: "og:description", content: "Statut, emplacement et historique d'un équipement." },
    ],
  }),
  component: EquipmentPage,
});

function EquipmentPage() {
  const { id } = Route.useParams();
  const db = useDB();
  const me = useMe();
  const [hist, setHist] = useState<HistoryEvent[]>([]);
  // Historique filtré côté serveur selon la politique de confidentialité ; rechargé à chaque changement de données.
  useEffect(() => {
    let off = false;
    getEquipmentHistory(id)
      .then((h) => {
        if (!off) setHist(h);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [id, db]);
  const e = db.equipment.find((x) => x.id === id);
  const tz = db.settings.timezone;
  if (!e)
    return (
      <AppShell title="Équipement">
        <Empty>
          Équipement introuvable.{" "}
          <Link to="/" className="underline">
            Retour au parc
          </Link>
        </Empty>
      </AppShell>
    );
  const l = db.locations.find((x) => x.id === e.location_id);
  const staff = me?.role !== "student";
  const curItem = db.items.find((i) => i.equipment_id === e.id && i.status === "checked_out");
  const curRes = curItem && db.reservations.find((r) => r.id === curItem.reservation_id);
  const bd = boardOf(db, e.id, staff);
  const cur = bd.due_at
    ? { due_at: bd.due_at, status: curRes?.status, purpose: curRes?.purpose }
    : undefined;
  const holderProfile = curRes && db.profiles.find((p) => p.id === curRes.borrower_id);
  const holderName = bd.holder ?? holderProfile?.full_name ?? null;
  const showHolder = staff || db.settings.show_holder_to_students || curRes?.borrower_id === me?.id;
  const next = db.items
    .filter((i) => i.equipment_id === e.id && i.status === "pending")
    .map((i) => db.reservations.find((r) => r.id === i.reservation_id)!)
    .filter((r) => ["approved", "requested"].includes(r.status))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];

  const LABEL: Record<string, string> = {
    checkout: "Sortie",
    return: "Retour",
    check_checkout: "Contrôle à la sortie",
    check_return: "Contrôle au retour",
    incident_open: "Incident ouvert",
    incident_in_progress: "Incident pris en charge",
    incident_resolved: "Incident résolu",
  };
  const events = hist.map((h) => {
    const who =
      h.kind === "checkout" || h.kind === "return"
        ? h.mine
          ? "vous"
          : (h.holder_name ?? "un étudiant")
        : null;
    return {
      at: h.at,
      label: LABEL[h.kind] ?? h.kind,
      detail: [who, h.detail].filter(Boolean).join(" — "),
    };
  });

  return (
    <AppShell title={e.asset_code}>
      <div className="space-y-4">
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{e.name}</h2>
              <p className="text-sm text-muted-foreground">
                {e.brand} {e.model} · {e.category}
              </p>
            </div>
            <EqStatus s={e.status} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <MapPin className="size-4 text-muted-foreground" />
            {l ? `${l.room} › ${l.cabinet} › ${l.shelf}` : "—"}
          </div>
          {staff && e.serial_number && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">S/N {e.serial_number}</p>
          )}
          {cur && (
            <div className="mt-3 rounded-md bg-secondary p-3 text-sm">
              {showHolder && holderName ? (
                <>
                  Détenu par <b>{holderName}</b>
                  {staff && holderProfile && ` (${holderProfile.email})`}
                  <br />
                </>
              ) : null}
              Retour prévu <b>{formatDate(cur.due_at, tz)}</b> ·{" "}
              <span className={new Date(cur.due_at) < new Date() ? "text-bad" : ""}>
                {relativeDue(cur.due_at)}
              </span>
            </div>
          )}
          {next && (
            <p className="mt-2 text-xs text-muted-foreground">
              Prochaine réservation : {formatDate(next.start_at, tz)} →{" "}
              {formatDate(next.due_at, tz)}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button asChild className="h-12">
              <Link to="/reserve" search={{ eq: e.id }}>
                Réserver
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12">
              <Link to="/scan">Scanner</Link>
            </Button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Historique</h3>
          {events.length ? (
            <ol className="space-y-0 border-l pl-4">
              {events.map((ev, i) => (
                <li key={i} className="relative pb-3">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-foreground" />
                  <div className="text-xs text-muted-foreground">{formatDate(ev.at, tz)}</div>
                  <div className="text-sm">
                    <b>{ev.label}</b>
                    {ev.detail && ` — ${ev.detail}`}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>Aucun mouvement enregistré pour cet objet.</Empty>
          )}
        </section>
        {staff && cur?.status && (
          <p className="text-xs text-muted-foreground">
            Réservation : <ResStatus s={cur.status} /> {cur.purpose}
          </p>
        )}
      </div>
    </AppShell>
  );
}
