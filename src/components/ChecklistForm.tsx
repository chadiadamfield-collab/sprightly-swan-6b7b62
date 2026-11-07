import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Checklist } from "@/lib/data";

export function useChecklist() {
  return useState<Checklist>({
    visual_ok: false,
    accessories_ok: false,
    power_ok: false,
    notes: "",
  });
}

const ITEMS: [keyof Omit<Checklist, "notes">, string][] = [
  ["visual_ok", "État visuel correct, aucun dommage"],
  ["accessories_ok", "Accessoires complets (batteries, câbles, housse…)"],
  ["power_ok", "Mise sous tension et fonctionnement vérifiés"],
];

export function ChecklistForm({
  value,
  onChange,
  idPrefix,
}: {
  value: Checklist;
  onChange: (c: Checklist) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Contrôle obligatoire</legend>
      {ITEMS.map(([k, label]) => (
        <label
          key={k}
          htmlFor={`${idPrefix}-${k}`}
          className="flex cursor-pointer items-center gap-3 rounded-md border bg-card p-3 text-sm"
        >
          <Checkbox
            id={`${idPrefix}-${k}`}
            checked={value[k]}
            onCheckedChange={(v) => onChange({ ...value, [k]: v === true })}
            className="size-5"
          />
          {label}
        </label>
      ))}
      <Label htmlFor={`${idPrefix}-notes`} className="pt-1">
        Notes
      </Label>
      <Textarea
        id={`${idPrefix}-notes`}
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        rows={2}
      />
    </fieldset>
  );
}

export function readPhoto(file: File | undefined): Promise<string | null> {
  return new Promise((res, rej) => {
    if (!file) return res(null);
    if (file.size > 5 * 1024 * 1024) return rej(new Error("Photo trop lourde (5 Mo max)."));
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Lecture photo impossible."));
    r.readAsDataURL(file);
  });
}
