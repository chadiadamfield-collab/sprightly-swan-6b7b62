# ISMAC-FLT — gestion et traçabilité du matériel audiovisuel

React + TypeScript + TanStack Start + Tailwind/shadcn. Backend cible : Supabase (Auth, PostgreSQL, Storage, Realtime).

## État actuel

- **Deux modes, même interface** (`src/lib/data.ts`) :
  - `VITE_DATA_MODE=demo` (défaut) : données fictives dans le navigateur, badge **DEMO**, comptes `etudiant@ismac.ma`, `tech@ismac.ma`, `admin@ismac.ma` (mot de passe `demo1234`). Contrôles de rôle côté navigateur : **non sûrs**, uniquement pour essayer l'app.
  - `VITE_DATA_MODE=supabase` : Auth, Postgres (RLS + RPC), Storage privé et Realtime réels. Aucune donnée de démo n'est chargée ni écrite.
- Le code Supabase (`src/lib/supabase-store.ts`) est écrit mais **doit être validé de bout en bout sur votre projet** après application des migrations (voir « Checklist de recette »).

## Variables d'environnement

| Variable                        | Rôle                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | URL du projet (par défaut `https://wgtporzffnzrbdwmtzaf.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé **publishable** uniquement (publique)                             |
| `VITE_DATA_MODE`                | `demo` (défaut) ou `supabase`                                         |

Voir `.env.example`.

**Ne jamais** mettre de clé `service_role` / secrète dans le front ni dans ce dépôt.

## Connexion Supabase

1. Créer un projet sur supabase.com (ou auto-héberger Supabase) et copier l'URL + la clé _publishable_ dans `.env`.
2. Inspecter la base existante (Table Editor / SQL editor) : les migrations sont **additives** (`create ... if not exists`, aucun `DROP` de données), mais vérifiez qu'aucune table `profiles`, `equipment`… incompatible n'existe déjà.
3. Appliquer dans l'ordre (SQL Editor ou `supabase db push`) :
   - `supabase/migrations/20260101000000_ismac_flt_schema.sql` — enums, tables, contraintes, RLS, RPC
   - `supabase/migrations/20260101000100_storage_incident_photos.sql` — bucket privé `incident-photos`
   - `supabase/migrations/20260101000200_ismac_flt_extras.sql` — planificateur sans pg_cron, réglages/statuts audités
   - `supabase/migrations/20260101000300_history_incident_take.sql` — historique filtré par confidentialité, prise en charge des incidents
   - `supabase/migrations/20260101000400_expire_unclaimed.sql` — expiration des réservations jamais retirées (libère le matériel)
4. Créer le premier admin : s'inscrire via l'app (rôle étudiant), puis dans le SQL Editor :
   `update public.profiles set role = 'admin' where email = 'vous@ismac.ma';`
   (le trigger interdit l'auto-promotion depuis l'app ; le SQL Editor tourne sans session utilisateur).
5. Auth → URL Configuration : renseigner l'URL du site et les redirections de réinitialisation de mot de passe.
6. Auth → Providers → Email : pour des tests rapides, désactiver « Confirm email » ; en production, le laisser activé (l'app affiche alors « confirmez votre email »).
7. Créer au moins un emplacement et un équipement depuis la Console technicien (la base démarre vide : aucune donnée fictive).
8. Mettre `VITE_DATA_MODE=supabase` (variable d'environnement de l'hébergeur) et redéployer.

## Checklist de recette (à faire une fois)

1. Inscription → le profil est `student` ; promotion admin via SQL.
2. Admin : créer lieu + 2 équipements ; imprimer un QR.
3. Étudiant : réserver les 2 objets → technicien approuve → l'étudiant scanne/saisit le code, coche la checklist → objet « Emprunté ».
4. Même créneau avec un 2e compte : conflit refusé par la base.
5. Anomalie avec photo → incident ouvert, objet en maintenance, photo visible du technicien uniquement.
6. Retour d'un seul objet : la réservation reste active ; retour du dernier → « Rendue ».
7. Réglages : durée max, fuseau, visibilité du détenteur.

## Garanties côté base

- Inscription → toujours `student` (trigger `handle_new_user`).
- Un non-admin ne peut pas changer `role` ; un non-staff ne peut pas changer `is_blocked` (trigger `guard_profile_update`).
- Double réservation impossible : contrainte d'exclusion `no_double_booking` sur `(equipment_id, period)` — atomique.
- Écritures sensibles uniquement via RPC `security definer` ; pas d'INSERT/UPDATE direct sur réservations, items, contrôles, audit.
- `audit_logs` immuable (trigger bloquant UPDATE/DELETE), lisible par les admins seulement.
- Détenteur d'un objet masqué aux étudiants (`equipment_board()`), créneaux occupés exposés sans identité (`equipment_busy_slots`).
- Photos : bucket privé, chemin `<user_id>/<fichier>`, lecture par l'auteur ou le staff.

## Rappels et retards

`public.tick_scheduler()` (appelée par l'app toutes les minutes, limitée à 1 exécution/min côté SQL) ou `pg_cron` déclenche `public.run_scheduler()`, qui calcule les retards depuis `due_at`, crée les notifications J-1 / H-3 / retard (dédupliquées) et bloque uniquement l'emprunteur responsable. Planifiez-la avec `pg_cron` (ligne commentée en fin de migration) toutes les 5 min. Notifications **in-app seulement** : email/SMS/push demandent un fournisseur (ex. Resend + Edge Function), non configuré.

## Développement

```bash
bun install   # ou npm install
bun run dev
bun run test  # règles de conflit, retards, blocage
bun run build
```

## Déploiement (indépendant de toute plateforme)

Le build utilise TanStack Start + Nitro. La cible se choisit **au build** avec `NITRO_PRESET` ; HTTPS obligatoire (caméra / BarcodeDetector). Les variables `VITE_*` sont intégrées au bundle **au build** : les définir avant `bun run build`.

| Cible                                  | Commande                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VPS / Railway / Render / Fly.io (Node) | `bun run build && bun run start` (port 3000, `PORT`/`HOST` respectés)                                                                                                                      |
| Docker                                 | `docker build --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=... --build-arg VITE_DATA_MODE=supabase -t ismac-flt .` puis `docker run -p 3000:3000 ismac-flt` |
| Vercel                                 | `NITRO_PRESET=vercel bun run build`                                                                                                                                                        |
| Netlify                                | Dépôt Git connecté ; `netlify.toml` fournit la commande, le dossier `dist` et le preset. Définir les 3 variables `VITE_*` dans Netlify                                                     |
| Cloudflare                             | `NITRO_PRESET=cloudflare_module bun run build`                                                                                                                                             |

Migrations : `supabase link --project-ref <ref> && supabase db push` (ou SQL Editor, dans l'ordre).

## Limites connues

- Le calendrier de disponibilités est indicatif (14 jours, fuseau de l'appareil) ; le refus d'un conflit est toujours fait par la base à l'envoi.
- Scan caméra via `BarcodeDetector` (Chrome/Android) ; Safari iOS → saisie manuelle.
- PWA : manifest, icônes placeholders et service worker minimal (production uniquement) avec page hors ligne ; les données ne sont jamais mises en cache, donc pas de mode hors ligne fonctionnel.
- Notifications du staff partagent un seul état « lu ».
