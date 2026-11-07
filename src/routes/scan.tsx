import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { AppShell, useMe } from "@/components/AppShell";
import { ChecklistForm, readPhoto, useChecklist } from "@/components/ChecklistForm";
import { Scanner } from "@/components/Scanner";
import { EqStatus } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmCheckout,
  confirmReturn,
  findCheckoutItem,
  findReturnItem,
  reportIncident,
  resolveToken,
  useDB,
} from "@/lib/data";
import { formatDate } from "@/lib/rules";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Scanner — ISMAC-FLT" },
      { name: "description", content: "Retrait et retour de matériel par QR code." },
      { property: "og:title", content: "Scanner — ISMAC-FLT" },
      { property: "og:description", content: "Retrait et retour de matériel par QR code." },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  const db = useDB();
  const me = useMe();
  const [eqId, setEqId] = useState<string | null>(null);
  const [check, setCheck] = useChecklist();
  const [condOk, setCondOk] = useState(false);
  const [incident, setIncident] = useState(false);
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEqId(null);
    setCheck({ visual_ok: false, accessories_ok: false, power_ok: false, notes: "" });
    setCondOk(false);
    setIncident(false);
    setDesc("");
    setFile(undefined);
  };
  const onCode = useCallback((c: string) => {
    const e = resolveToken(c);
    if (!e) {
      toast.error("Code inconnu.");
      return;
    }
    reset();
    setEqId(e.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const e = eqId ? db.equipment.find((x) => x.id === eqId) : undefined;
  const mode = e?.status === "checked_out" ? "return" : "checkout";
  const ctx = e ? (mode === "return" ? findReturnItem(e.id) : findCheckoutItem(e.id)) : null;
  const staff = me?.role !== "student";

  const act = async (fn: () => void | Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      reset();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Scanner">
      {!e ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scannez l'étiquette QR de l'objet au retrait ou au retour.
          </p>
          <Scanner onCode={onCode} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xs text-muted-foreground">{e.asset_code}</div>
                <div className="font-semibold">{e.name}</div>
              </div>
              <EqStatus s={e.status} />
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {mode === "return" ? "Retour" : "Retrait"}
            </div>
          </div>

          {ctx && "error" in ctx ? (
            <div role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad">
              {ctx.error}
            </div>
          ) : ctx && !incident ? (
            <>
              <p className="text-sm">
                Réservation « {ctx.res.purpose} » · échéance{" "}
                <b>{formatDate(ctx.res.due_at, db.settings.timezone)}</b>
              </p>
              <ChecklistForm value={check} onChange={setCheck} idPrefix="ck" />
              {mode === "return" ? (
                staff ? (
                  <>
                    <label className="flex items-center gap-3 rounded-md border bg-card p-3 text-sm">
                      <Checkbox
                        checked={condOk}
                        onCheckedChange={(v) => setCondOk(v === true)}
                        className="size-5"
                      />
                      État global OK — remettre en disponibilité
                    </label>
                    <div className="space-y-1">
                      <Label htmlFor="rp">Photo (si problème)</Label>
                      <Input
                        id="rp"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(x) => setFile(x.target.files?.[0])}
                      />
                    </div>
                    <Button
                      size="lg"
                      className="h-14 w-full"
                      disabled={busy}
                      onClick={() =>
                        act(
                          async () =>
                            confirmReturn(
                              ctx.item.id,
                              { ...check, condition_ok: condOk },
                              await readPhoto(file),
                            ),
                          "Retour enregistré.",
                        )
                      }
                    >
                      Confirmer la restitution physique
                    </Button>
                  </>
                ) : (
                  <p className="rounded-md bg-warn-soft p-3 text-sm text-warn">
                    Présentez l'objet au technicien : il confirme la restitution physique.
                  </p>
                )
              ) : (
                <Button
                  size="lg"
                  className="h-14 w-full"
                  disabled={busy || !check.visual_ok || !check.accessories_ok || !check.power_ok}
                  onClick={() =>
                    act(() => confirmCheckout(ctx.item.id, check), "Retrait confirmé.")
                  }
                >
                  Confirmer la prise
                </Button>
              )}
              <Button
                variant="outline"
                className="h-12 w-full border-warn text-warn"
                onClick={() => setIncident(true)}
              >
                <AlertTriangle /> Signaler une anomalie
              </Button>
            </>
          ) : null}

          {incident && ctx && !("error" in ctx) && (
            <div className="space-y-3 rounded-lg border border-warn bg-warn-soft p-4">
              <h3 className="font-semibold">Signaler une anomalie</h3>
              <p className="text-xs text-muted-foreground">
                L'objet sera mis en maintenance. Le signalement n'engage pas votre responsabilité :
                il conserve la preuve de l'état constaté.
              </p>
              <div className="space-y-1">
                <Label htmlFor="d">Description *</Label>
                <Textarea id="d" value={desc} onChange={(x) => setDesc(x.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ph">Photo</Label>
                <Input
                  id="ph"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(x) => setFile(x.target.files?.[0])}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" onClick={() => setIncident(false)}>
                  Annuler
                </Button>
                <Button
                  disabled={busy || desc.trim().length < 5}
                  onClick={() =>
                    act(
                      async () => reportIncident(e.id, desc, await readPhoto(file), ctx.item.id),
                      "Incident créé, technicien notifié.",
                    )
                  }
                >
                  Envoyer
                </Button>
              </div>
            </div>
          )}
          <Button variant="ghost" className="w-full" onClick={reset}>
            Scanner un autre objet
          </Button>
        </div>
      )}
    </AppShell>
  );
}
