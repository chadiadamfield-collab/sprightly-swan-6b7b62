# Project notes

- Stack: React 19, TypeScript, TanStack Start (SSR) + Nitro, Tailwind 4 / shadcn, Supabase.
- Dev: `bun run dev` · Test: `bun run test` · Build: `bun run build` · Run build: `bun run start`.
- Database changes: add a new file under `supabase/migrations/` (never edit an applied one).
- Never put `service_role` / secret keys in the repo or in `VITE_*` variables.
