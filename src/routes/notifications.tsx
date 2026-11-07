import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Empty, useMe } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { markNotificationsRead, useDB } from "@/lib/data";
import { formatDate } from "@/lib/rules";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — ISMAC-FLT" },
      { name: "description", content: "Rappels, retards et incidents." },
      { property: "og:title", content: "Notifications — ISMAC-FLT" },
      { property: "og:description", content: "Rappels, retards et incidents." },
    ],
  }),
  component: NotifPage,
});

function NotifPage() {
  const db = useDB();
  const me = useMe();
  const list = db.notifications.filter(
    (n) => n.user_id === me?.id || (me?.role !== "student" && n.user_id === "role:technician"),
  );
  return (
    <AppShell title="Notifications">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Notifications in-app uniquement (email/SMS/push non configurés).
        </p>
        {list.some((n) => !n.read) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void markNotificationsRead();
            }}
          >
            Tout marquer lu
          </Button>
        )}
      </div>
      {!list.length ? (
        <Empty>Aucune notification pour l'instant.</Empty>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.map((n) => (
            <li key={n.id} className={`p-3 ${n.read ? "" : "bg-warn-soft/40"}`}>
              <div className="flex justify-between gap-2">
                <b className="text-sm">{n.title}</b>
                <span className="text-xs text-muted-foreground">
                  {formatDate(n.created_at, db.settings.timezone)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{n.body}</p>
              {n.link && (
                <a href={n.link} className="text-xs underline">
                  Ouvrir
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
