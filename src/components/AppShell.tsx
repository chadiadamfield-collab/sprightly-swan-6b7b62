import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  Boxes,
  CalendarPlus,
  ClipboardList,
  LogOut,
  QrCode,
  Settings,
  User,
  Wrench,
  WifiOff,
} from "lucide-react";
import { useDB, signOut, runScheduler, reload } from "@/lib/data";
import { DATA_MODE } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Parc", icon: Boxes, roles: ["student", "technician", "admin"] },
  { to: "/scan", label: "Scanner", icon: QrCode, roles: ["student", "technician", "admin"] },
  {
    to: "/reserve",
    label: "Réserver",
    icon: CalendarPlus,
    roles: ["student", "technician", "admin"],
  },
  {
    to: "/loans",
    label: "Emprunts",
    icon: ClipboardList,
    roles: ["student", "technician", "admin"],
  },
  { to: "/tech", label: "Administration", icon: Wrench, roles: ["technician", "admin"] },
  { to: "/admin", label: "Réglages", icon: Settings, roles: ["admin"] },
] as const;

export function useMe() {
  const db = useDB();
  return db.profiles.find((p) => p.id === db.sessionUserId) ?? null;
}

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const db = useDB();
  const me = useMe();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setHydrated(true);
    setOnline(navigator.onLine);
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const tick = () => {
      runScheduler().catch(() => undefined);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (hydrated && db.ready !== false && !me) nav({ to: "/auth", replace: true });
  }, [hydrated, db.ready, me, nav]);

  if (!hydrated || db.ready === false || !me)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );

  const items = NAV.filter((n) => (n.roles as readonly string[]).includes(me.role));
  const unread = db.notifications.filter(
    (n) =>
      !n.read &&
      (n.user_id === me.id || (me.role !== "student" && n.user_id === "role:technician")),
  ).length;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Aller au contenu
      </a>
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card p-3 md:flex">
        <div className="px-2 py-3 font-mono text-sm font-semibold tracking-tight">ISMAC‑FLT</div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {items.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                path === n.to
                  ? "bg-secondary font-medium"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <n.icon className="size-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <Link
          to="/profile"
          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-secondary"
        >
          <User className="size-4" />
          <span className="truncate">{me.full_name}</span>
        </Link>
        <button
          onClick={() => {
            void signOut();
          }}
          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-secondary"
        >
          <LogOut className="size-4" /> Déconnexion
        </button>
      </aside>

      <div className="flex min-h-screen flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
          {DATA_MODE === "demo" && (
            <span
              className="rounded bg-warn px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary-foreground"
              title="Données de démonstration locales — base non connectée"
            >
              DEMO
            </span>
          )}
          <Link
            to="/notifications"
            aria-label={`Notifications (${unread} non lues)`}
            className="relative rounded-md p-2 hover:bg-secondary"
          >
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-primary-foreground">
                {unread}
              </span>
            )}
          </Link>
          <Link
            to="/profile"
            aria-label="Profil"
            className="rounded-md p-2 hover:bg-secondary md:hidden"
          >
            <User className="size-5" />
          </Link>
        </header>
        {db.error && (
          <div role="alert" className="bg-bad-soft px-4 py-2 text-sm text-bad">
            Connexion à la base impossible : {db.error}. Vérifiez que les migrations SQL ont été
            appliquées.{" "}
            <button
              className="underline"
              onClick={() => {
                void reload();
              }}
            >
              Réessayer
            </button>
          </div>
        )}
        {!online && (
          <div className="flex items-center gap-2 bg-warn-soft px-4 py-2 text-sm text-warn">
            <WifiOff className="size-4" /> Hors ligne — les actions seront refusées jusqu'au retour
            du réseau.
          </div>
        )}
        {me.is_blocked && (
          <div className="bg-bad-soft px-4 py-2 text-sm text-bad">
            Compte bloqué : {me.blocked_reason}.{" "}
            <Link to="/profile" className="underline">
              Contester
            </Link>
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 p-4 outline-none">
          {children}
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-card md:hidden"
        style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)` }}
      >
        {items.slice(0, 5).map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-[11px]",
              path === n.to ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {n.to === "/scan" ? (
              <span className="-mt-5 grid size-12 place-items-center rounded-full bg-accent text-accent-foreground shadow">
                <n.icon className="size-6" />
              </span>
            ) : (
              <n.icon className="size-5" />
            )}
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
