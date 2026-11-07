import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getDB,
  resetPassword,
  signIn,
  signOut,
  signUp,
  updatePassword,
  useDB,
} from "@/lib/data";
import { DATA_MODE } from "@/lib/supabase";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — ISMAC-FLT" },
      { name: "description", content: "Connexion au parc matériel ISMAC." },
      { property: "og:title", content: "Connexion — ISMAC-FLT" },
      { property: "og:description", content: "Connexion au parc matériel ISMAC." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [asAdmin, setAsAdmin] = useState(false);
  const go = () => {
    const me = getDB().profiles.find((p) => p.id === getDB().sessionUserId);
    nav({ to: me?.role === "student" ? "/" : "/tech", replace: true });
  };
  const db = useDB();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r === "confirm")
        toast.success("Compte créé. Confirmez votre email (lien reçu) puis connectez-vous.");
      else if (r !== "reset" && r !== "pw") go();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-5">
      <div>
        <div className="font-mono text-2xl font-semibold tracking-tight">ISMAC‑FLT</div>
        <p className="text-sm text-muted-foreground">
          Parc audiovisuel — réservation et traçabilité
        </p>
      </div>
      {db.error && (
        <div role="alert" className="rounded-md border border-bad bg-bad-soft p-3 text-xs text-bad">
          Base injoignable : {db.error}
        </div>
      )}
      {DATA_MODE === "demo" && (
        <div className="rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn">
          <b>MODE DEMO</b> — données locales fictives, base non connectée. Comptes :
          étudiant : etudiant@ismac.ma · administrateur : tech@ismac.ma (mot de passe{" "}
          <span className="font-mono">demo1234</span>).
        </div>
      )}
      {db.recovery ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const pw = String(f.get("npw"));
            if (pw.length < 8) {
              toast.error("Mot de passe : 8 caractères minimum.");
              return;
            }
            void run(async () => {
              await updatePassword(pw);
              toast.success("Mot de passe modifié.");
              return "pw";
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="npw">Nouveau mot de passe</Label>
            <Input
              id="npw"
              name="npw"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button className="h-12 w-full" disabled={busy}>
            Enregistrer
          </Button>
        </form>
      ) : (
        <Tabs defaultValue="login">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="login">Connexion</TabsTrigger>
            <TabsTrigger value="signup">Inscription</TabsTrigger>
            <TabsTrigger value="reset">Oubli</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <div
              role="radiogroup"
              aria-label="Type de compte"
              className="mt-3 grid grid-cols-2 gap-1 rounded-md border p-1"
            >
              {[
                [false, "Étudiant"],
                [true, "Administrateur"],
              ].map(([v, l]) => (
                <button
                  key={String(l)}
                  type="button"
                  role="radio"
                  aria-checked={asAdmin === v}
                  onClick={() => setAsAdmin(v as boolean)}
                  className={
                    "rounded px-2 py-1.5 text-sm " +
                    (asAdmin === v
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary")
                  }
                >
                  {l}
                </button>
              ))}
            </div>
            <form
              key={asAdmin ? "admin" : "student"}
              className="space-y-3 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await signIn(String(f.get("email")), String(f.get("password")));
                  if (asAdmin) {
                    const me = getDB().profiles.find((p) => p.id === getDB().sessionUserId);
                    if (me?.role === "student") {
                      await signOut();
                      throw new Error("Ce compte n'a pas les droits administrateur.");
                    }
                  }
                });
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  defaultValue={
                    DATA_MODE === "demo" ? (asAdmin ? "tech@ismac.ma" : "etudiant@ismac.ma") : ""
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pw">Mot de passe</Label>
                <Input
                  id="pw"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button className="h-12 w-full" disabled={busy}>
                {asAdmin ? "Connexion administrateur" : "Se connecter"}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form
              className="space-y-3 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const pw = String(f.get("password"));
                if (pw.length < 8) {
                  toast.error("Mot de passe : 8 caractères minimum.");
                  return;
                }
                void run(() =>
                  signUp(
                    String(f.get("name")).trim(),
                    String(f.get("email")),
                    String(f.get("promo")).trim(),
                    pw,
                  ),
                );
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="name">Nom complet</Label>
                <Input id="name" name="name" required minLength={3} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="semail">Email</Label>
                <Input id="semail" name="email" type="email" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="promo">Promo / classe</Label>
                <Input id="promo" name="promo" required placeholder="Réalisation 2A" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spw">Mot de passe</Label>
                <Input
                  id="spw"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tout nouveau compte est créé avec le rôle Étudiant.
              </p>
              <Button className="h-12 w-full" disabled={busy}>
                Créer mon compte
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="reset">
            <form
              className="space-y-3 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await resetPassword(String(f.get("remail")));
                  toast.info(
                    DATA_MODE === "demo"
                      ? "Mode DEMO : aucun email n'est envoyé."
                      : "Si un compte existe, un lien a été envoyé.",
                  );
                  return "reset";
                }).then(() => undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="remail">Email</Label>
                <Input id="remail" name="remail" type="email" required />
              </div>
              <Button variant="outline" className="h-12 w-full">
                Envoyer le lien de réinitialisation
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
