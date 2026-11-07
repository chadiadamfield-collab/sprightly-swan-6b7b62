import { createClient } from "@supabase/supabase-js";

/**
 * Supabase (projet externe ISMAC). Seule la clé PUBLISHABLE est utilisée ici.
 * Ne jamais placer de clé service_role / secret dans le front.
 * DATA_MODE reste "demo" tant que VITE_DATA_MODE !== "supabase" (migrations non appliquées).
 */
const url = import.meta.env.VITE_SUPABASE_URL ?? "https://wgtporzffnzrbdwmtzaf.supabase.co";
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_5PjX2UCgFiAANNTD8J9hRA_wbeF6DnW";

export const DATA_MODE: "demo" | "supabase" =
  import.meta.env.VITE_DATA_MODE === "supabase" ? "supabase" : "demo";

export const supabase = createClient(url, key, {
  auth: { persistSession: typeof window !== "undefined", autoRefreshToken: true },
});
