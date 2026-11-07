import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppShell, Empty } from "@/components/AppShell";
import { EqStatus } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { boardOf } from "@/lib/lookup";
import { useDB } from "@/lib/data";
import { useMe } from "@/components/AppShell";
import { formatDate } from "@/lib/rules";
import type { EquipmentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Parc matériel — ISMAC-FLT" },
      {
        name: "description",
        content: "Disponibilité en temps réel du matériel audiovisuel ISMAC.",
      },
      { property: "og:title", content: "Parc matériel — ISMAC-FLT" },
      {
        property: "og:description",
        content: "Disponibilité en temps réel du matériel audiovisuel ISMAC.",
      },
    ],
  }),
  component: Parc,
});

const COUNTERS: { s: EquipmentStatus[]; label: string; cls: string }[] = [
  { s: ["available"], label: "Disponibles", cls: "text-ok" },
  { s: ["checked_out", "reserved"], label: "Empruntés", cls: "text-bad" },
  { s: ["maintenance"], label: "Maintenance", cls: "text-warn" },
  { s: ["out_of_service"], label: "Hors service", cls: "text-idle" },
];

function Parc() {
  const db = useDB();
  const me = useMe();
  const staff = !!me && me.role !== "student";
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [st, setSt] = useState("all");
  const [loc, setLoc] = useState("all");
  const cats = [...new Set(db.equipment.map((e) => e.category))].sort();
  const rooms = [...new Set(db.locations.map((l) => l.room))];

  const list = useMemo(() => {
    const t = q.toLowerCase();
    return db.equipment.filter((e) => {
      const l = db.locations.find((x) => x.id === e.location_id);
      return (
        (!t || `${e.asset_code} ${e.name} ${e.brand} ${e.model}`.toLowerCase().includes(t)) &&
        (cat === "all" || e.category === cat) &&
        (st === "all" || e.status === st) &&
        (loc === "all" || l?.room === loc)
      );
    });
  }, [db, q, cat, st, loc]);

  const dueFor = (eid: string) => boardOf(db, eid, staff).due_at;

  return (
    <AppShell title="Parc matériel">
      <div className="grid grid-cols-4 gap-2">
        {COUNTERS.map((c) => (
          <button
            key={c.label}
            onClick={() => setSt(st === c.s[0] ? "all" : c.s[0])}
            className={cn(
              "rounded-lg border bg-card p-2.5 text-left",
              st === c.s[0] && "ring-2 ring-ring",
            )}
          >
            <div className={cn("font-mono text-2xl font-semibold", c.cls)}>
              {db.equipment.filter((e) => c.s.includes(e.status)).length}
            </div>
            <div className="text-[11px] leading-tight text-muted-foreground">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="relative mt-4">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Rechercher"
          placeholder="Rechercher code, nom, marque…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 pl-9"
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger aria-label="Catégorie">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Catégories</SelectItem>
            {cats.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={st} onValueChange={setSt}>
          <SelectTrigger aria-label="Statut">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Statuts</SelectItem>
            <SelectItem value="available">Disponible</SelectItem>
            <SelectItem value="checked_out">Emprunté</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="out_of_service">Hors service</SelectItem>
          </SelectContent>
        </Select>
        <Select value={loc} onValueChange={setLoc}>
          <SelectTrigger aria-label="Emplacement">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Lieux</SelectItem>
            {rooms.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="mt-4 divide-y overflow-hidden rounded-lg border bg-card">
        {list.map((e) => {
          const l = db.locations.find((x) => x.id === e.location_id);
          const due = dueFor(e.id);
          return (
            <li key={e.id}>
              <Link
                to="/equipment/$id"
                params={{ id: e.id }}
                className="flex items-center gap-3 px-3 py-3 hover:bg-secondary"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{e.asset_code}</span>
                    <span className="truncate text-sm font-medium">{e.name}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.brand} {e.model} · {l?.room} / {l?.cabinet}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <EqStatus s={e.status} />
                  {due && (
                    <span className="text-[11px] text-muted-foreground">
                      retour {formatDate(due, db.settings.timezone)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {!list.length && (
        <div className="mt-4">
          <Empty>Aucun équipement ne correspond à ces filtres.</Empty>
        </div>
      )}
    </AppShell>
  );
}
