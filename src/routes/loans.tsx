import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell, Empty, useMe } from "@/components/AppShell";
import { ResStatus } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { cancelReservation, useDB } from "@/lib/data";
import { formatDate, relativeDue } from "@/lib/rules";
import type { Reservation } from "@/lib/types";

export const Route = createFileRoute("/loans")({
  head: () => ({
    meta: [
      { title: "Mes emprunts — ISMAC-FLT" },
      { name: "description", content: "Emprunts actifs, à venir et en retard." },
      { property: "og:title", content: "Mes emprunts — ISMAC-FLT" },
      { property: "og:description", content: "Emprunts actifs, à venir et en retard." },
    ],
  }),
  component: LoansPage,
});

function LoansPage() {
  const db = useDB();
  const me = useMe();
  const mine = db.reservations.filter((r) => r.borrower_id === me?.id);
  const groups: [string, Reservation[]][] = [
    ["En retard", mine.filter((r) => r.status === "overdue")],
    ["En cours", mine.filter((r) => r.status === "active")],
    ["À venir", mine.filter((r) => ["requested", "approved"].includes(r.status))],
    ["Historique", mine.filter((r) => ["returned", "cancelled", "rejected"].includes(r.status))],
  ];
  const tz = db.settings.timezone;

  return (
    <AppShell title="Mes emprunts">
      {!mine.length && (
        <Empty>
          Aucune réservation.{" "}
          <Link to="/reserve" className="underline">
            Réserver du matériel
          </Link>
        </Empty>
      )}
      <div className="space-y-5">
        {groups
          .filter(([, l]) => l.length)
          .map(([label, list]) => (
            <section key={label}>
              <h2 className="mb-2 text-sm font-semibold">
                {label} <span className="text-muted-foreground">({list.length})</span>
              </h2>
              <ul className="space-y-2">
                {list.map((r) => {
                  const items = db.items.filter((i) => i.reservation_id === r.id);
                  const late = r.status === "overdue";
                  return (
                    <li
                      key={r.id}
                      className={`rounded-lg border bg-card p-3 ${late ? "border-bad" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium">{r.purpose}</div>
                        <ResStatus s={r.status} />
                      </div>
                      <div className={`mt-1 text-sm ${late ? "font-semibold text-bad" : ""}`}>
                        Échéance {formatDate(r.due_at, tz)} · {relativeDue(r.due_at)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Début {formatDate(r.start_at, tz)}
                      </div>
                      {r.decision_reason && (
                        <div className="mt-1 text-xs">Motif : {r.decision_reason}</div>
                      )}
                      <ul className="mt-2 space-y-1">
                        {items.map((i) => {
                          const e = db.equipment.find((x) => x.id === i.equipment_id)!;
                          return (
                            <li key={i.id} className="flex justify-between text-xs">
                              <Link
                                to="/equipment/$id"
                                params={{ id: e.id }}
                                className="underline-offset-2 hover:underline"
                              >
                                <span className="font-mono">{e.asset_code}</span> {e.name}
                              </Link>
                              <span className="text-muted-foreground">
                                {
                                  {
                                    pending: "à retirer",
                                    checked_out: "sorti",
                                    returned: "rendu",
                                    cancelled: "annulé",
                                  }[i.status]
                                }
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        {["approved", "active", "overdue"].includes(r.status) && (
                          <Button asChild size="sm" className="h-10 flex-1">
                            <Link to="/scan">
                              {r.status === "approved" ? "Scanner au retrait" : "Retour / signaler"}
                            </Link>
                          </Button>
                        )}
                        {["requested", "approved"].includes(r.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-10"
                            onClick={async () => {
                              try {
                                await cancelReservation(r.id);
                                toast.success("Réservation annulée.");
                              } catch (e) {
                                toast.error((e as Error).message);
                              }
                            }}
                          >
                            Annuler
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </div>
    </AppShell>
  );
}
