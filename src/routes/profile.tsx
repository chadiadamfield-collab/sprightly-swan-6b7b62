import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, useMe } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contestBlock, signOut, updateOwnProfile } from "@/lib/data";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profil — ISMAC-FLT" },
      { name: "description", content: "Votre compte ISMAC-FLT." },
      { property: "og:title", content: "Profil — ISMAC-FLT" },
      { property: "og:description", content: "Votre compte ISMAC-FLT." },
    ],
  }),
  component: ProfilePage,
});

const ROLE = { student: "Étudiant", technician: "Technicien", admin: "Administrateur" };

function ProfilePage() {
  const me = useMe();
  const [note, setNote] = useState("");
  return (
    <AppShell title="Profil">
      {me && (
        <div className="space-y-4">
          <form
            className="space-y-3 rounded-lg border bg-card p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await updateOwnProfile(String(f.get("n")), String(f.get("p")));
                toast.success("Profil mis à jour.");
              } catch (x) {
                toast.error((x as Error).message);
              }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="n">Nom complet</Label>
              <Input id="n" name="n" defaultValue={me.full_name} required />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={me.email} disabled />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p">Promo / classe</Label>
              <Input id="p" name="p" defaultValue={me.promo} />
            </div>
            <p className="text-sm">
              Rôle : <b>{ROLE[me.role]}</b> · Statut :{" "}
              <b className={me.is_blocked ? "text-bad" : "text-ok"}>
                {me.is_blocked ? "Bloqué" : "Actif"}
              </b>
            </p>
            <Button>Enregistrer</Button>
          </form>
          {me.is_blocked && (
            <div className="space-y-2 rounded-lg border border-bad bg-bad-soft p-4">
              <p className="text-sm text-bad">{me.blocked_reason}</p>
              {me.contest_note ? (
                <p className="text-sm">Contestation envoyée : « {me.contest_note} »</p>
              ) : (
                <>
                  <Label htmlFor="c">Contester le blocage</Label>
                  <Textarea id="c" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button
                    disabled={note.trim().length < 5}
                    onClick={async () => {
                      try {
                        await contestBlock(note);
                        toast.success("Contestation transmise.");
                      } catch (x) {
                        toast.error((x as Error).message);
                      }
                    }}
                  >
                    Envoyer
                  </Button>
                </>
              )}
            </div>
          )}
          <Button
            variant="outline"
            className="w-full md:hidden"
            onClick={() => {
              void signOut();
            }}
          >
            Déconnexion
          </Button>
        </div>
      )}
    </AppShell>
  );
}
