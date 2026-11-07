import { useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Download, Pencil, Printer } from "lucide-react";
import { EqStatus } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addLocation, setEquipmentStatus, upsertEquipment, useDB } from "@/lib/data";
import type { Equipment } from "@/lib/types";

type QrItem = { asset_code: string; name: string; qr_token: string };

/** Étiquettes imprimables (le QR ne contient qu'un jeton opaque : il n'autorise rien en soi). */
export async function printQR(items: QrItem[]) {
  const imgs = await Promise.all(
    items.map(
      async (e) =>
        `<div style="display:inline-block;width:45mm;margin:2mm;text-align:center;font:10px monospace"><img src="${await QRCode.toDataURL(e.qr_token, { margin: 1, width: 200 })}" style="width:40mm"/><br/>${e.asset_code}<br/>${e.name.replace(/</g, "&lt;")}</div>`,
    ),
  );
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Autorisez les fenêtres pop-up pour imprimer.");
    return;
  }
  w.document.write(
    `<title>QR ISMAC-FLT</title>${imgs.join("")}<script>onload=()=>print()</script>`,
  );
  w.document.close();
}
async function downloadQR(e: QrItem) {
  const a = document.createElement("a");
  a.href = await QRCode.toDataURL(e.qr_token, { margin: 2, width: 512 });
  a.download = `${e.asset_code}.png`;
  a.click();
}

async function run(fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
    toast.success(ok);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

export function EquipmentManager() {
  const db = useDB();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Equipment | null>(null);
  const t = q.toLowerCase();
  const list = db.equipment.filter(
    (e) =>
      !t ||
      `${e.asset_code} ${e.name} ${e.category} ${e.brand} ${e.model} ${e.serial_number ?? ""}`
        .toLowerCase()
        .includes(t),
  );
  const locLabel = (id: string) => {
    const l = db.locations.find((x) => x.id === id);
    return l ? `${l.room} › ${l.cabinet} › ${l.shelf}` : "—";
  };
  const locSelect = (def?: string) => (
    <select
      name="l"
      required
      defaultValue={def ?? ""}
      aria-label="Emplacement"
      className="h-9 rounded border bg-background px-2 text-sm"
    >
      <option value="">Emplacement…</option>
      {db.locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.room} › {l.cabinet} › {l.shelf}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void printQR(list)}>
          <Printer /> Imprimer {t ? "la sélection" : "tout"} ({list.length})
        </Button>
        <Input
          aria-label="Rechercher du matériel"
          placeholder="Rechercher code, nom, série…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <form
        key={editing?.id ?? "new"}
        className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3"
        onSubmit={async (ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          const form = ev.currentTarget;
          const ok = await run(
            () =>
              upsertEquipment({
                ...(editing ? { id: editing.id } : {}),
                asset_code: String(f.get("c")).trim(),
                name: String(f.get("n")).trim(),
                category: String(f.get("k")).trim(),
                brand: String(f.get("b")).trim(),
                model: String(f.get("m")).trim(),
                serial_number: String(f.get("sn")).trim() || null,
                notes: String(f.get("no")).trim() || null,
                location_id: String(f.get("l")),
              }),
            editing ? "Équipement modifié." : "Équipement ajouté.",
          );
          if (ok) {
            form.reset();
            setEditing(null);
          }
        }}
      >
        <h3 className="col-span-2 text-sm font-semibold">
          {editing ? `Modifier ${editing.asset_code}` : "Nouvel équipement"}
        </h3>
        <Input
          name="c"
          placeholder="Code (CAM-010)"
          required
          defaultValue={editing?.asset_code}
          aria-label="Code inventaire"
        />
        <Input name="n" placeholder="Nom" required defaultValue={editing?.name} aria-label="Nom" />
        <Input
          name="k"
          placeholder="Catégorie"
          required
          defaultValue={editing?.category}
          aria-label="Catégorie"
        />
        <Input name="b" placeholder="Marque" defaultValue={editing?.brand} aria-label="Marque" />
        <Input name="m" placeholder="Modèle" defaultValue={editing?.model} aria-label="Modèle" />
        <Input
          name="sn"
          placeholder="N° de série (facultatif)"
          defaultValue={editing?.serial_number ?? ""}
          aria-label="Numéro de série"
        />
        {locSelect(editing?.location_id)}
        <Input
          name="no"
          placeholder="Notes"
          defaultValue={editing?.notes ?? ""}
          aria-label="Notes"
        />
        <Button className={editing ? "" : "col-span-2"}>
          {editing ? "Enregistrer" : "Ajouter"}
        </Button>
        {editing && (
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            Annuler
          </Button>
        )}
      </form>

      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          if (
            await run(
              () => addLocation(String(f.get("r")), String(f.get("a")), String(f.get("s"))),
              "Emplacement ajouté.",
            )
          )
            form.reset();
        }}
      >
        <Input name="r" placeholder="Local" aria-label="Local" required />
        <Input name="a" placeholder="Armoire" aria-label="Armoire" />
        <Input name="s" placeholder="Étagère" aria-label="Étagère" />
        <Button variant="outline">+ Lieu</Button>
      </form>

      {!list.length ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun équipement ne correspond. Ajoutez-en un ci-dessus.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-mono text-xs">{e.asset_code}</span> {e.name}
                <span className="block truncate text-xs text-muted-foreground">
                  {locLabel(e.location_id)}
                </span>
              </span>
              <EqStatus s={e.status} />
              <select
                aria-label={`Statut de ${e.asset_code}`}
                className="rounded border bg-background px-1 py-1 text-xs"
                value={e.status}
                onChange={(x) =>
                  void run(
                    () => setEquipmentStatus(e.id, x.target.value as Equipment["status"]),
                    "Statut modifié.",
                  )
                }
              >
                <option value="available">Disponible</option>
                <option value="maintenance">Maintenance</option>
                <option value="out_of_service">Hors service</option>
                <option value="checked_out" disabled>
                  Emprunté
                </option>
                <option value="reserved" disabled>
                  Réservé
                </option>
              </select>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Modifier ${e.asset_code}`}
                onClick={() => setEditing(e)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Imprimer le QR de ${e.asset_code}`}
                onClick={() => void printQR([e])}
              >
                <Printer />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Télécharger le QR de ${e.asset_code} (PNG)`}
                onClick={() => void downloadQR(e)}
              >
                <Download />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
