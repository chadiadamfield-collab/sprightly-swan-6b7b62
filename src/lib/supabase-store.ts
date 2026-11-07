/**
 * Backend Supabase : même contrat que demo-store, mais asynchrone.
 * Un instantané (DB) est rechargé depuis Postgres (soumis à la RLS) après chaque action et sur événement Realtime.
 * Toute règle métier sensible est appliquée côté serveur (RPC) ; ce fichier ne fait que les appeler.
 */
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { AppError, emptyDB, type Checklist, type DB } from "./demo-store";
import { findCheckoutItemIn, findReturnItemIn, resolveTokenIn, type HistoryEvent } from "./lookup";
import type { AppSettings, Equipment, Incident, Role } from "./types";
import { DEFAULT_SETTINGS } from "./types";

type Err = { message: string } | null;
type Res<T = unknown> = { data: T; error: Err };
function ok<T>(r: Res<T>): T {
  if (r.error) throw new AppError(r.error.message);
  return r.data;
}

let db: DB = emptyDB();
const listeners = new Set<() => void>();
const serverSnap = emptyDB();
function set(next: DB) {
  db = next;
  listeners.forEach((l) => l());
}
function patch(p: Partial<DB>) {
  set({ ...db, ...p });
}
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const getDB = () => db;
export const useDB = (): DB => useSyncExternalStore(subscribe, getDB, () => serverSnap);

const uid = () => db.sessionUserId;

/* ---------- chargement ---------- */
let loading: Promise<void> | null = null;
let again = false;
export function loadAll(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    try {
      await doLoad();
      if (db.error) patch({ error: null });
    } catch (e) {
      patch({ ready: true, error: (e as Error).message || "Erreur inconnue" });
    } finally {
      loading = null;
    }
    if (again) {
      again = false;
      await loadAll();
    }
  })();
  return loading;
}

async function doLoad() {
  const me = uid();
  if (!me) {
    set({ ...emptyDB(), ready: true, recovery: db.recovery ?? false });
    return;
  }
  const sel = (t: string) => supabase.from(t).select("*");
  const [
    profiles,
    locations,
    equipment,
    reservations,
    items,
    checks,
    incidents,
    notifs,
    settings,
    audit,
    board,
  ] = await Promise.all([
    sel("profiles"),
    sel("locations"),
    sel("equipment"),
    sel("reservations").order("created_at", { ascending: false }),
    sel("reservation_items"),
    sel("condition_checks").order("created_at", { ascending: false }).limit(500),
    sel("incidents").order("created_at", { ascending: false }),
    sel("notifications").order("created_at", { ascending: false }).limit(200),
    supabase.from("app_settings").select("*").maybeSingle(),
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.rpc("equipment_board"),
  ]);
  const eqRows = ok(equipment as Res<Equipment[] | null>) ?? [];
  const from = new Date().toISOString(),
    to = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const busyRes = eqRows.length
    ? await supabase.rpc("equipment_busy_slots", {
        p_ids: eqRows.map((e) => e.id),
        p_from: from,
        p_to: to,
      })
    : { data: [], error: null };

  const incRows = ok(incidents as Res<(Incident & { photo_path?: string | null })[] | null>) ?? [];
  const paths = incRows.map((i) => i.photo_path).filter((x): x is string => !!x);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from("incident-photos").createSignedUrls(paths, 3600);
    data?.forEach((d) => {
      if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
    });
  }
  const s = ok(settings as Res<Partial<AppSettings> | null>);
  const boardMap: NonNullable<DB["board"]> = {};
  for (const b of ok(
    board as Res<
      { equipment_id: string; next_due_at: string; holder_name: string | null }[] | null
    >,
  ) ?? [])
    boardMap[b.equipment_id] = { due_at: b.next_due_at, holder_name: b.holder_name };

  set({
    ...db,
    ready: true,
    profiles: ok(profiles as Res<DB["profiles"] | null>) ?? [],
    locations: ok(locations as Res<DB["locations"] | null>) ?? [],
    equipment: eqRows,
    reservations: ok(reservations as Res<DB["reservations"] | null>) ?? [],
    items: ok(items as Res<DB["items"] | null>) ?? [],
    checks: ok(checks as Res<DB["checks"] | null>) ?? [],
    incidents: incRows.map((i) => ({
      ...i,
      photo_url: i.photo_path ? (signed.get(i.photo_path) ?? null) : null,
    })),
    notifications: (
      ok(
        notifs as Res<
          (Omit<DB["notifications"][number], "user_id"> & { user_id: string | null })[] | null
        >,
      ) ?? []
    ).map((n) => ({ ...n, user_id: n.user_id ?? "role:technician", link: n.link ?? undefined })),
    audit: audit.error ? [] : ((audit.data as DB["audit"] | null) ?? []),
    settings: { ...DEFAULT_SETTINGS, ...(s ?? {}) },
    board: boardMap,
    busy: (busyRes.data as DB["busy"]) ?? [],
  });
}

/* ---------- session & temps réel ---------- */
let channel: ReturnType<typeof supabase.channel> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void loadAll().catch(() => undefined);
  }, 400);
};
function subscribeRealtime() {
  if (channel) return;
  channel = supabase.channel("ismac-flt");
  for (const table of [
    "equipment",
    "reservations",
    "reservation_items",
    "notifications",
    "incidents",
    "profiles",
  ]) {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
  }
  channel.subscribe();
}
function unsubscribeRealtime() {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}

if (typeof window !== "undefined") {
  supabase.auth
    .getSession()
    .then(({ data }) => {
      db = { ...db, sessionUserId: data.session?.user.id ?? null };
      if (db.sessionUserId) subscribeRealtime();
      return loadAll();
    })
    .catch(() => patch({ ready: true }));
  supabase.auth.onAuthStateChange((event, session) => {
    // Ne pas appeler Supabase directement dans ce callback (risque de blocage) : on diffère.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") patch({ recovery: true });
      const id = session?.user.id ?? null;
      if (id !== db.sessionUserId) {
        db = { ...db, sessionUserId: id };
        if (id) subscribeRealtime();
        else unsubscribeRealtime();
        void loadAll().catch(() => patch({ ready: true }));
      }
    }, 0);
  });
}

/* ---------- AUTH ---------- */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error)
    throw new AppError(
      error.message === "Invalid login credentials"
        ? "Email ou mot de passe incorrect."
        : error.message,
    );
  db = { ...db, sessionUserId: data.user.id };
  subscribeRealtime();
  await loadAll();
}
/** Retourne "confirm" si un email de confirmation doit être validé avant connexion. */
export async function signUp(
  full_name: string,
  email: string,
  promo: string,
  password: string,
): Promise<"ok" | "confirm"> {
  // Le rôle n'est jamais envoyé : le trigger serveur crée TOUJOURS un étudiant.
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { full_name, promo }, emailRedirectTo: window.location.origin + "/auth" },
  });
  if (error) throw new AppError(error.message);
  if (!data.session) return "confirm";
  db = { ...db, sessionUserId: data.user?.id ?? null };
  subscribeRealtime();
  await loadAll();
  return "ok";
}
export async function signOut() {
  await supabase.auth.signOut();
  unsubscribeRealtime();
  set({ ...emptyDB(), ready: true });
}
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: window.location.origin + "/auth",
  });
  if (error) throw new AppError(error.message);
}
export async function updatePassword(pw: string) {
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) throw new AppError(error.message);
  patch({ recovery: false });
}
export async function updateOwnProfile(full_name: string, promo: string) {
  const id = uid();
  if (!id) throw new AppError("Session expirée. Reconnectez-vous.");
  ok(
    await supabase
      .from("profiles")
      .update({ full_name: full_name.trim(), promo: promo.trim() })
      .eq("id", id),
  );
  await loadAll();
}
export async function contestBlock(note: string) {
  ok(await supabase.rpc("contest_block", { p_note: note }));
  await loadAll();
}

/* ---------- Actions métier (RPC) ---------- */
async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await supabase.rpc(fn, args);
  const out = ok(r as Res<T>);
  await loadAll();
  return out;
}
export async function createReservation(
  equipmentIds: string[],
  start: Date,
  end: Date,
  purpose: string,
) {
  return rpc<string>("create_reservation", {
    p_equipment_ids: equipmentIds,
    p_start: start.toISOString(),
    p_due: end.toISOString(),
    p_purpose: purpose,
  });
}
export const cancelReservation = (id: string) =>
  rpc("cancel_reservation", { p_id: id }).then(() => undefined);
export const decideReservation = (id: string, approve: boolean, reason: string) =>
  rpc("decide_reservation", { p_id: id, p_approve: approve, p_reason: reason }).then(
    () => undefined,
  );
export const confirmCheckout = (itemId: string, c: Checklist) =>
  rpc("confirm_checkout", {
    p_item: itemId,
    p_visual: c.visual_ok,
    p_acc: c.accessories_ok,
    p_power: c.power_ok,
    p_notes: c.notes || null,
  }).then(() => undefined);

async function uploadPhoto(dataUrl: string | null): Promise<string | null> {
  if (!dataUrl) return null;
  const me = uid();
  if (!me) throw new AppError("Session expirée.");
  const blob = await (await fetch(dataUrl)).blob();
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${me}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("incident-photos")
    .upload(path, blob, { contentType: blob.type });
  if (error)
    throw new AppError(
      "Envoi de la photo impossible : " +
        error.message +
        " (formats acceptés : JPEG, PNG, WebP, 5 Mo max).",
    );
  return path;
}
export async function reportIncident(
  equipmentId: string,
  description: string,
  photo: string | null,
  itemId?: string,
) {
  const path = await uploadPhoto(photo);
  await rpc("report_incident", {
    p_equipment: equipmentId,
    p_description: description,
    p_photo_path: path,
    p_item: itemId ?? null,
  });
}
export async function confirmReturn(
  itemId: string,
  c: Checklist & { condition_ok: boolean },
  photo: string | null,
) {
  const path = await uploadPhoto(photo);
  await rpc("confirm_return", {
    p_item: itemId,
    p_visual: c.visual_ok,
    p_acc: c.accessories_ok,
    p_power: c.power_ok,
    p_condition_ok: c.condition_ok,
    p_notes: c.notes || null,
    p_photo_path: path,
  });
}
export const directCheckout = (equipmentId: string, borrowerId: string, dueAt: Date) =>
  rpc("direct_checkout", {
    p_equipment: equipmentId,
    p_borrower: borrowerId,
    p_due: dueAt.toISOString(),
  }).then(() => undefined);
export const resolveIncident = (id: string, resolution: string, makeAvailable: boolean) =>
  rpc("resolve_incident", {
    p_id: id,
    p_resolution: resolution,
    p_make_available: makeAvailable,
  }).then(() => undefined);
export const setBlocked = (userId: string, blocked: boolean, reason: string) =>
  rpc("set_blocked", { p_user: userId, p_blocked: blocked, p_reason: reason }).then(
    () => undefined,
  );
export const setRole = (userId: string, role: Role) =>
  rpc("set_role", { p_user: userId, p_role: role }).then(() => undefined);
export const setEquipmentStatus = (id: string, status: Equipment["status"]) =>
  rpc("set_equipment_status", { p_id: id, p_status: status }).then(() => undefined);
export const updateSettings = (s: AppSettings) =>
  rpc("update_settings", { p: s }).then(() => undefined);

export async function upsertEquipment(
  input: Partial<Equipment> & {
    asset_code: string;
    name: string;
    category: string;
    location_id: string;
  },
) {
  const row = {
    asset_code: input.asset_code,
    name: input.name,
    category: input.category,
    brand: input.brand ?? "",
    model: input.model ?? "",
    serial_number: input.serial_number ?? null,
    location_id: input.location_id,
    notes: input.notes ?? null,
  };
  const r = input.id
    ? await supabase.from("equipment").update(row).eq("id", input.id)
    : await supabase.from("equipment").insert(row);
  if (r.error)
    throw new AppError(
      r.error.code === "23505" ? "Code inventaire déjà utilisé." : r.error.message,
    );
  await loadAll();
}
export async function addLocation(room: string, cabinet: string, shelf: string) {
  if (!room.trim()) throw new AppError("Local obligatoire.");
  const r = await supabase
    .from("locations")
    .insert({ room: room.trim(), cabinet: cabinet.trim(), shelf: shelf.trim() });
  if (r.error)
    throw new AppError(r.error.code === "23505" ? "Cet emplacement existe déjà." : r.error.message);
  await loadAll();
}
export async function markNotificationsRead() {
  ok(await supabase.from("notifications").update({ read: true }).eq("read", false));
  await loadAll();
}
/** Déclenche le planificateur serveur (limité à 1×/min côté SQL) puis rafraîchit. */
export async function runScheduler() {
  if (!uid()) return;
  await supabase.rpc("tick_scheduler");
  await loadAll();
}

export const resolveToken = (code: string) => resolveTokenIn(db, code);
export const findCheckoutItem = (id: string) => findCheckoutItemIn(db, id);
export const findReturnItem = (id: string) => findReturnItemIn(db, id);
export function resetDemo() {
  /* sans objet en mode Supabase */
}

export const takeIncident = (id: string) =>
  rpc("take_incident", { p_id: id }).then(() => undefined);
export async function getEquipmentHistory(id: string): Promise<HistoryEvent[]> {
  const rows =
    ok(
      (await supabase.rpc("equipment_history", { p_equipment: id })) as Res<
        (Omit<HistoryEvent, "at"> & { event_at: string })[] | null
      >,
    ) ?? [];
  return rows.map(({ event_at, ...h }) => ({ ...h, at: event_at }));
}
