/**
 * DEMO backend: in-browser, localStorage-persisted. Mirrors the RPC contract of
 * docs/sql/001_schema.sql so the UI can switch to Supabase later.
 * Role checks here imitate the server; real enforcement lives in RLS / RPC.
 */
import { useSyncExternalStore } from "react";
import { DATA_MODE } from "./supabase";
import {
  findConflicts,
  shouldBlockBorrower,
  isOverdue,
  validateReservationWindow,
  withinPickupWindow,
} from "./rules";
import {
  DEFAULT_SETTINGS,
  type AppNotification,
  type AppSettings,
  type AuditLog,
  type ConditionCheck,
  type Equipment,
  type Incident,
  type Location,
  type Profile,
  type Reservation,
  type ReservationItem,
  type Role,
} from "./types";

export interface DB {
  profiles: Profile[];
  passwords: Record<string, string>;
  locations: Location[];
  equipment: Equipment[];
  reservations: Reservation[];
  items: ReservationItem[];
  checks: ConditionCheck[];
  incidents: Incident[];
  notifications: AppNotification[];
  audit: AuditLog[];
  settings: AppSettings;
  sessionUserId: string | null;
  /** Supabase mode only */
  ready?: boolean;
  recovery?: boolean;
  error?: string | null;
  board?: Record<string, { due_at: string; holder_name: string | null }>;
  busy?: { equipment_id: string; start_at: string; due_at: string }[];
}

export function emptyDB(): DB {
  return {
    profiles: [],
    passwords: {},
    locations: [],
    equipment: [],
    reservations: [],
    items: [],
    checks: [],
    incidents: [],
    notifications: [],
    audit: [],
    settings: { ...DEFAULT_SETTINGS },
    sessionUserId: null,
    ready: false,
    recovery: false,
    board: {},
    busy: [],
  };
}

const KEY = "ismac-flt-demo-v1";
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

function seed(): DB {
  const locs: Location[] = [
    { id: "L1", room: "Magasin A", cabinet: "Armoire 1", shelf: "Étagère 2" },
    { id: "L2", room: "Magasin A", cabinet: "Armoire 3", shelf: "Étagère 1" },
    { id: "L3", room: "Studio B", cabinet: "Rack son", shelf: "Tiroir 1" },
    { id: "L4", room: "Atelier technique", cabinet: "Établi", shelf: "—" },
  ];
  const mk = (
    code: string,
    name: string,
    category: string,
    brand: string,
    model: string,
    loc: string,
    status: Equipment["status"] = "available",
  ): Equipment => ({
    id: uid(),
    asset_code: code,
    qr_token: uid(),
    name,
    category,
    brand,
    model,
    serial_number: null,
    location_id: loc,
    status,
  });
  const eq = [
    mk("CAM-001", "Caméra Cinéma #1", "Caméra", "Blackmagic", "Pocket 6K Pro", "L1"),
    mk("CAM-002", "Caméra Cinéma #2", "Caméra", "Blackmagic", "Pocket 6K Pro", "L1"),
    mk("CAM-003", "Caméra Cinéma #3", "Caméra", "Sony", "FX3", "L1"),
    mk("OBJ-001", "Objectif 35mm", "Optique", "Sigma", "Art 35 f/1.4", "L2"),
    mk("OBJ-002", "Objectif 50mm", "Optique", "Samyang", "Cine 50 T1.5", "L2"),
    mk("TRP-001", "Trépied vidéo", "Machinerie", "Manfrotto", "504X", "L2"),
    mk("LUM-001", "Panneau LED", "Lumière", "Aputure", "Amaran 200x", "L2"),
    mk("LUM-002", "Panneau LED", "Lumière", "Aputure", "Amaran 200x", "L4", "maintenance"),
    mk("SON-001", "Enregistreur", "Son", "Zoom", "F6", "L3"),
    mk("SON-002", "Micro canon", "Son", "Rode", "NTG5", "L3"),
    mk("SON-003", "Perche", "Son", "K-Tek", "KE-110", "L3", "out_of_service"),
  ];
  const profiles: Profile[] = [
    {
      id: "u-student",
      full_name: "Yasmine El Idrissi",
      email: "etudiant@ismac.ma",
      promo: "Réalisation 2A",
      role: "student",
      is_blocked: false,
      created_at: nowIso(),
    },
    {
      id: "u-student2",
      full_name: "Omar Benali",
      email: "omar@ismac.ma",
      promo: "Image 3A",
      role: "student",
      is_blocked: false,
      created_at: nowIso(),
    },
    {
      id: "u-tech",
      full_name: "Karim Technicien",
      email: "tech@ismac.ma",
      promo: "—",
      role: "technician",
      is_blocked: false,
      created_at: nowIso(),
    },
    {
      id: "u-admin",
      full_name: "Salma Admin",
      email: "admin@ismac.ma",
      promo: "—",
      role: "admin",
      is_blocked: false,
      created_at: nowIso(),
    },
  ];
  const r1: Reservation = {
    id: uid(),
    borrower_id: "u-student2",
    start_at: h(-30),
    due_at: h(-2),
    purpose: "Court-métrage « Sable »",
    status: "active",
    created_at: h(-48),
  };
  const r2: Reservation = {
    id: uid(),
    borrower_id: "u-student",
    start_at: h(1),
    due_at: h(26),
    purpose: "Exercice lumière",
    status: "approved",
    created_at: h(-5),
  };
  const r3: Reservation = {
    id: uid(),
    borrower_id: "u-student",
    start_at: h(48),
    due_at: h(60),
    purpose: "Documentaire",
    status: "requested",
    created_at: h(-1),
  };
  eq[2].status = "checked_out";
  eq[8].status = "checked_out";
  const items: ReservationItem[] = [
    {
      id: uid(),
      reservation_id: r1.id,
      equipment_id: eq[2].id,
      status: "checked_out",
      checked_out_at: h(-30),
    },
    {
      id: uid(),
      reservation_id: r1.id,
      equipment_id: eq[8].id,
      status: "checked_out",
      checked_out_at: h(-30),
    },
    { id: uid(), reservation_id: r2.id, equipment_id: eq[0].id, status: "pending" },
    { id: uid(), reservation_id: r2.id, equipment_id: eq[6].id, status: "pending" },
    { id: uid(), reservation_id: r3.id, equipment_id: eq[5].id, status: "pending" },
  ];
  return {
    profiles,
    passwords: {
      "etudiant@ismac.ma": "demo1234",
      "omar@ismac.ma": "demo1234",
      "tech@ismac.ma": "demo1234",
      "admin@ismac.ma": "demo1234",
    },
    locations: locs,
    equipment: eq,
    reservations: [r1, r2, r3],
    items,
    checks: [],
    incidents: [
      {
        id: uid(),
        equipment_id: eq[7].id,
        reported_by: "u-tech",
        description: "Ventilateur bruyant, à vérifier.",
        status: "open",
        created_at: h(-20),
      },
    ],
    notifications: [],
    audit: [],
    settings: { ...DEFAULT_SETTINGS },
    sessionUserId: null,
  };
}

// En mode Supabase, on ne touche JAMAIS au localStorage de démo.
let db: DB = DATA_MODE === "demo" ? load() : emptyDB();
const listeners = new Set<() => void>();

function load(): DB {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    /* corrupted -> reseed */
  }
  const s = seed();
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
function commit(mut: (d: DB) => void) {
  const next = structuredClone(db);
  mut(next);
  db = next;
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(db));
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getDB() {
  return db;
}
const serverSnap = seed();
export function useDB(): DB {
  return useSyncExternalStore(subscribe, getDB, () => serverSnap);
}
export function resetDemo() {
  commit((d) => Object.assign(d, seed()));
}

if (typeof window !== "undefined" && DATA_MODE === "demo") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      db = load();
      listeners.forEach((l) => l());
    }
  });
}

export class AppError extends Error {}
function me(d: DB): Profile {
  const p = d.profiles.find((x) => x.id === d.sessionUserId);
  if (!p) throw new AppError("Session expirée. Reconnectez-vous.");
  return p;
}
function requireRole(p: Profile, roles: Role[]) {
  if (!roles.includes(p.role)) throw new AppError("Action non autorisée pour votre rôle.");
}
const isStaff = (p: Profile) => p.role === "technician" || p.role === "admin";
function audit(
  d: DB,
  actor: string | null,
  action: string,
  entity: string,
  entity_id: string,
  details?: string,
) {
  d.audit.unshift({
    id: uid(),
    actor_id: actor,
    action,
    entity,
    entity_id,
    details,
    created_at: nowIso(),
  });
}
function notify(
  d: DB,
  user_id: string,
  kind: AppNotification["kind"],
  title: string,
  body: string,
  link?: string,
  dedupe_key?: string,
) {
  if (dedupe_key && d.notifications.some((n) => n.dedupe_key === dedupe_key)) return;
  d.notifications.unshift({
    id: uid(),
    user_id,
    kind,
    title,
    body,
    link,
    read: false,
    created_at: nowIso(),
    dedupe_key,
  });
}

/* ---------- AUTH ---------- */
export function signIn(email: string, password: string) {
  commit((d) => {
    const e = email.trim().toLowerCase();
    if (d.passwords[e] !== password) throw new AppError("Email ou mot de passe incorrect.");
    d.sessionUserId = d.profiles.find((p) => p.email === e)!.id;
  });
}
export function signUp(full_name: string, email: string, promo: string, password: string) {
  commit((d) => {
    const e = email.trim().toLowerCase();
    if (d.passwords[e]) throw new AppError("Un compte existe déjà avec cet email.");
    const id = uid();
    // Public signup ALWAYS creates a student.
    d.profiles.push({
      id,
      full_name,
      email: e,
      promo,
      role: "student",
      is_blocked: false,
      created_at: nowIso(),
    });
    d.passwords[e] = password;
    d.sessionUserId = id;
    audit(d, id, "signup", "profile", id);
  });
}
export function signOut() {
  commit((d) => {
    d.sessionUserId = null;
  });
}
export function updateOwnProfile(full_name: string, promo: string) {
  commit((d) => {
    const p = me(d);
    p.full_name = full_name;
    p.promo = promo;
  });
}
export function contestBlock(note: string) {
  commit((d) => {
    const p = me(d);
    p.contest_note = note;
    notify(
      d,
      "role:technician",
      "info",
      "Contestation de blocage",
      `${p.full_name} : ${note}`,
      "/tech",
    );
    audit(d, p.id, "contest_block", "profile", p.id, note);
  });
}

/* ---------- RESERVATIONS ---------- */
export function createReservation(equipmentIds: string[], start: Date, end: Date, purpose: string) {
  let createdId = "";
  commit((d) => {
    const p = me(d);
    if (p.is_blocked)
      throw new AppError("Compte bloqué : réservation impossible. Contactez un technicien.");
    if (!equipmentIds.length) throw new AppError("Sélectionnez au moins un équipement.");
    if (purpose.trim().length < 3) throw new AppError("Motif / projet obligatoire.");
    const err = validateReservationWindow(start, end, d.settings);
    if (err) throw new AppError(err);
    for (const id of equipmentIds) {
      const e = d.equipment.find((x) => x.id === id);
      if (!e || e.status === "maintenance" || e.status === "out_of_service")
        throw new AppError(`${e?.asset_code ?? id} indisponible (maintenance / hors service).`);
    }
    const c = findConflicts({
      equipmentIds,
      start,
      end,
      reservations: d.reservations,
      items: d.items,
    });
    if (c.length)
      throw new AppError(
        "Conflit : " +
          c.map((id) => d.equipment.find((e) => e.id === id)?.asset_code).join(", ") +
          " déjà réservé(s) sur ce créneau.",
      );
    const r: Reservation = {
      id: uid(),
      borrower_id: p.id,
      start_at: start.toISOString(),
      due_at: end.toISOString(),
      purpose: purpose.trim(),
      status: "requested",
      created_at: nowIso(),
    };
    d.reservations.unshift(r);
    equipmentIds.forEach((eid) =>
      d.items.push({ id: uid(), reservation_id: r.id, equipment_id: eid, status: "pending" }),
    );
    notify(
      d,
      "role:technician",
      "info",
      "Nouvelle demande",
      `${p.full_name} — ${equipmentIds.length} objet(s)`,
      "/tech",
    );
    audit(d, p.id, "reservation_create", "reservation", r.id);
    createdId = r.id;
  });
  return createdId;
}
export function cancelReservation(id: string) {
  commit((d) => {
    const p = me(d);
    const r = d.reservations.find((x) => x.id === id);
    if (!r) throw new AppError("Réservation introuvable.");
    if (r.borrower_id !== p.id && !isStaff(p)) throw new AppError("Non autorisé.");
    if (!["requested", "approved"].includes(r.status))
      throw new AppError("Seules les demandes non retirées peuvent être annulées.");
    r.status = "cancelled";
    d.items.filter((i) => i.reservation_id === id).forEach((i) => (i.status = "cancelled"));
    audit(d, p.id, "reservation_cancel", "reservation", id);
  });
}
export function decideReservation(id: string, approve: boolean, reason: string) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    const r = d.reservations.find((x) => x.id === id);
    if (!r || r.status !== "requested") throw new AppError("Demande non en attente.");
    if (!approve && reason.trim().length < 3) throw new AppError("Motif de refus obligatoire.");
    r.status = approve ? "approved" : "rejected";
    r.decision_reason = reason || null;
    r.decided_by = p.id;
    if (!approve)
      d.items.filter((i) => i.reservation_id === id).forEach((i) => (i.status = "cancelled"));
    notify(
      d,
      r.borrower_id,
      "decision",
      approve ? "Réservation approuvée" : "Réservation refusée",
      reason || r.purpose,
      "/loans",
    );
    audit(
      d,
      p.id,
      approve ? "reservation_approve" : "reservation_reject",
      "reservation",
      id,
      reason,
    );
  });
}

/* ---------- QR / CHECKOUT / RETURN ---------- */
export function resolveToken(code: string): Equipment | undefined {
  const c = code.trim();
  return db.equipment.find(
    (e) => e.qr_token === c || e.asset_code.toLowerCase() === c.toLowerCase(),
  );
}

/** Find the reservation item the current user may check out for this equipment. */
export function findCheckoutItem(
  equipmentId: string,
): { item: ReservationItem; res: Reservation } | { error: string } {
  const d = db;
  const p = d.profiles.find((x) => x.id === d.sessionUserId);
  if (!p) return { error: "Session expirée." };
  const e = d.equipment.find((x) => x.id === equipmentId)!;
  const now = new Date();
  for (const it of d.items.filter(
    (i) => i.equipment_id === equipmentId && i.status === "pending",
  )) {
    const r = d.reservations.find((x) => x.id === it.reservation_id)!;
    if (!["approved", "active"].includes(r.status)) continue;
    if (r.borrower_id !== p.id && !isStaff(p)) continue;
    if (
      !withinPickupWindow(
        new Date(r.start_at),
        new Date(r.due_at),
        now,
        d.settings.pickup_window_minutes,
      )
    )
      return {
        error: `Hors fenêtre de retrait (ouvre ${d.settings.pickup_window_minutes} min avant le début).`,
      };
    if (e.status !== "available" && e.status !== "reserved")
      return { error: `Objet non disponible (${e.status}).` };
    return { item: it, res: r };
  }
  return { error: "Aucune réservation approuvée à votre nom pour cet objet." };
}
export function findReturnItem(
  equipmentId: string,
): { item: ReservationItem; res: Reservation } | { error: string } {
  const d = db;
  const p = d.profiles.find((x) => x.id === d.sessionUserId);
  if (!p) return { error: "Session expirée." };
  const it = d.items.find((i) => i.equipment_id === equipmentId && i.status === "checked_out");
  if (!it) return { error: "Cet objet n'est pas sorti." };
  const r = d.reservations.find((x) => x.id === it.reservation_id)!;
  if (r.borrower_id !== p.id && !isStaff(p))
    return { error: "Cet objet n'est pas lié à votre emprunt." };
  return { item: it, res: r };
}

export interface Checklist {
  visual_ok: boolean;
  accessories_ok: boolean;
  power_ok: boolean;
  notes: string;
}

export function confirmCheckout(itemId: string, c: Checklist) {
  commit((d) => {
    const p = me(d);
    const it = d.items.find((i) => i.id === itemId);
    if (!it || it.status !== "pending") throw new AppError("Objet déjà sorti ou annulé.");
    const r = d.reservations.find((x) => x.id === it.reservation_id)!;
    if (r.borrower_id !== p.id && !isStaff(p)) throw new AppError("Non autorisé.");
    if (p.is_blocked) throw new AppError("Compte bloqué.");
    if (!c.visual_ok || !c.accessories_ok || !c.power_ok)
      throw new AppError(
        "Toutes les vérifications doivent être cochées, sinon signalez une anomalie.",
      );
    const e = d.equipment.find((x) => x.id === it.equipment_id)!;
    if (e.status !== "available" && e.status !== "reserved")
      throw new AppError("Objet non disponible.");
    const t = nowIso();
    it.status = "checked_out";
    it.checked_out_at = t;
    e.status = "checked_out";
    if (r.status === "approved") r.status = "active";
    d.checks.unshift({
      id: uid(),
      reservation_item_id: it.id,
      equipment_id: e.id,
      kind: "checkout",
      ...c,
      performed_by: p.id,
      created_at: t,
    });
    audit(d, p.id, "checkout", "equipment", e.id, e.asset_code);
  });
}

export function reportIncident(
  equipmentId: string,
  description: string,
  photo: string | null,
  itemId?: string,
) {
  commit((d) => {
    const p = me(d);
    if (description.trim().length < 5)
      throw new AppError("Description obligatoire (5 caractères min.).");
    const e = d.equipment.find((x) => x.id === equipmentId)!;
    if (!isStaff(p)) {
      const linked = d.items.some(
        (i) =>
          i.equipment_id === equipmentId &&
          ["pending", "checked_out"].includes(i.status) &&
          d.reservations.find((r) => r.id === i.reservation_id)?.borrower_id === p.id,
      );
      if (!linked)
        throw new AppError("Vous ne pouvez signaler que les objets liés à vos réservations.");
    }
    const inc: Incident = {
      id: uid(),
      equipment_id: e.id,
      reservation_item_id: itemId ?? null,
      reported_by: p.id,
      description: description.trim(),
      photo_url: photo,
      status: "open",
      created_at: nowIso(),
    };
    d.incidents.unshift(inc);
    if (e.status !== "checked_out") e.status = "maintenance"; // quarantine
    notify(
      d,
      "role:technician",
      "incident",
      `Incident ${e.asset_code}`,
      description.slice(0, 80),
      `/equipment/${e.id}`,
    );
    audit(d, p.id, "incident_open", "incident", inc.id, e.asset_code);
  });
}

export function confirmReturn(
  itemId: string,
  c: Checklist & { condition_ok: boolean },
  photo: string | null,
) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]); // physical return confirmed by staff
    const it = d.items.find((i) => i.id === itemId);
    if (!it || it.status !== "checked_out") throw new AppError("Objet non sorti.");
    const r = d.reservations.find((x) => x.id === it.reservation_id)!;
    const e = d.equipment.find((x) => x.id === it.equipment_id)!;
    const t = nowIso();
    it.status = "returned";
    it.returned_at = t;
    const ok = c.condition_ok && c.visual_ok && c.accessories_ok && c.power_ok;
    d.checks.unshift({
      id: uid(),
      reservation_item_id: it.id,
      equipment_id: e.id,
      kind: "return",
      visual_ok: c.visual_ok,
      accessories_ok: c.accessories_ok,
      power_ok: c.power_ok,
      notes: c.notes,
      performed_by: p.id,
      confirmed_by: p.id,
      created_at: t,
    });
    if (ok) e.status = "available";
    else {
      e.status = "maintenance";
      d.incidents.unshift({
        id: uid(),
        equipment_id: e.id,
        reservation_item_id: it.id,
        reported_by: p.id,
        description: c.notes || "Problème constaté au retour",
        photo_url: photo,
        status: "open",
        created_at: t,
      });
    }
    const remaining = d.items.filter(
      (i) => i.reservation_id === r.id && (i.status === "checked_out" || i.status === "pending"),
    );
    if (!remaining.length) r.status = "returned";
    audit(d, p.id, "return", "equipment", e.id, `${e.asset_code} ${ok ? "OK" : "PROBLÈME"}`);
  });
}

/* ---------- STAFF ---------- */
export function directCheckout(equipmentId: string, borrowerId: string, dueAt: Date) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    if (!d.settings.technician_direct_checkout)
      throw new AppError("Retrait direct désactivé par l'administration.");
    const b = d.profiles.find((x) => x.id === borrowerId);
    if (!b || b.is_blocked) throw new AppError("Emprunteur invalide ou bloqué.");
    const e = d.equipment.find((x) => x.id === equipmentId)!;
    if (e.status !== "available") throw new AppError("Objet non disponible.");
    const start = new Date();
    const c = findConflicts({
      equipmentIds: [equipmentId],
      start,
      end: dueAt,
      reservations: d.reservations,
      items: d.items,
    });
    if (c.length) throw new AppError("Conflit avec une réservation existante.");
    const r: Reservation = {
      id: uid(),
      borrower_id: b.id,
      start_at: start.toISOString(),
      due_at: dueAt.toISOString(),
      purpose: "Retrait direct technicien",
      status: "active",
      decided_by: p.id,
      created_at: nowIso(),
    };
    d.reservations.unshift(r);
    d.items.push({
      id: uid(),
      reservation_id: r.id,
      equipment_id: e.id,
      status: "checked_out",
      checked_out_at: nowIso(),
    });
    e.status = "checked_out";
    audit(d, p.id, "direct_checkout", "equipment", e.id, b.email);
  });
}
export function upsertEquipment(
  input: Partial<Equipment> & {
    asset_code: string;
    name: string;
    category: string;
    location_id: string;
  },
) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    if (d.equipment.some((e) => e.asset_code === input.asset_code && e.id !== input.id))
      throw new AppError("Code inventaire déjà utilisé.");
    if (input.id) {
      Object.assign(
        d.equipment.find((e) => e.id === input.id)!,
        input,
      );
      audit(d, p.id, "equipment_update", "equipment", input.id);
    } else {
      const e: Equipment = {
        brand: "",
        model: "",
        status: "available",
        serial_number: null,
        ...input,
        id: uid(),
        qr_token: uid(),
      };
      d.equipment.push(e);
      audit(d, p.id, "equipment_create", "equipment", e.id);
    }
  });
}
export function setEquipmentStatus(id: string, status: Equipment["status"]) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    const e = d.equipment.find((x) => x.id === id)!;
    if (e.status === "checked_out") throw new AppError("Objet actuellement sorti.");
    e.status = status;
    audit(d, p.id, "equipment_status", "equipment", id, status);
  });
}
export function addLocation(room: string, cabinet: string, shelf: string) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    if (!room.trim()) throw new AppError("Local obligatoire.");
    const l = { id: uid(), room, cabinet, shelf };
    d.locations.push(l);
    audit(d, p.id, "location_create", "location", l.id);
  });
}
export function resolveIncident(id: string, resolution: string, makeAvailable: boolean) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    if (resolution.trim().length < 3) throw new AppError("Résolution obligatoire.");
    const inc = d.incidents.find((x) => x.id === id)!;
    inc.status = "resolved";
    inc.resolution = resolution;
    const e = d.equipment.find((x) => x.id === inc.equipment_id)!;
    if (makeAvailable && e.status === "maintenance") e.status = "available";
    audit(d, p.id, "incident_resolve", "incident", id, resolution);
  });
}
export function setBlocked(userId: string, blocked: boolean, reason: string) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    const u = d.profiles.find((x) => x.id === userId)!;
    u.is_blocked = blocked;
    u.blocked_reason = blocked ? reason : null;
    if (!blocked) u.contest_note = null;
    notify(d, u.id, "info", blocked ? "Compte bloqué" : "Compte débloqué", reason || "");
    audit(d, p.id, blocked ? "user_block" : "user_unblock", "profile", userId, reason);
  });
}
export function setRole(userId: string, role: Role) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["admin"]);
    if (userId === p.id) throw new AppError("Vous ne pouvez pas modifier votre propre rôle.");
    d.profiles.find((x) => x.id === userId)!.role = role;
    audit(d, p.id, "role_change", "profile", userId, role);
  });
}
export function updateSettings(s: AppSettings) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["admin"]);
    d.settings = s;
    audit(d, p.id, "settings_update", "app_settings", "1", JSON.stringify(s));
  });
}
export function markNotificationsRead() {
  commit((d) => {
    const p = me(d);
    d.notifications.forEach((n) => {
      if (n.user_id === p.id || (isStaff(p) && n.user_id === "role:technician")) n.read = true;
    });
  });
}

/** Scheduled job equivalent (pg_cron in production): overdue status, reminders, blocking. */
export function runScheduler() {
  const d0 = db;
  const now = new Date();
  let changed = false;
  const next = structuredClone(d0);
  // Réservations jamais retirées après leur échéance : libérer le matériel.
  for (const r of next.reservations) {
    if ((r.status === "requested" || r.status === "approved") && new Date(r.due_at) < now) {
      r.status = "cancelled";
      r.decision_reason =
        (r.decision_reason ? r.decision_reason + " — " : "") +
        "Expirée : non retirée avant l'échéance";
      next.items
        .filter((i) => i.reservation_id === r.id && i.status === "pending")
        .forEach((i) => (i.status = "cancelled"));
      notify(
        next,
        r.borrower_id,
        "info",
        "Réservation expirée",
        `« ${r.purpose} » n'a pas été retirée avant l'échéance.`,
        "/loans",
        `exp-${r.id}`,
      );
      audit(next, null, "reservation_expired", "reservation", r.id);
      changed = true;
    }
  }
  for (const r of next.reservations) {
    const due = new Date(r.due_at);
    const hasOut = next.items.some((i) => i.reservation_id === r.id && i.status === "checked_out");
    if (!hasOut) continue;
    const mins = (due.getTime() - now.getTime()) / 60_000;
    const len = next.notifications.length;
    if (next.settings.reminder_d1 && mins > 0 && mins <= 1440)
      notify(
        next,
        r.borrower_id,
        "reminder_d1",
        "Retour demain",
        "Votre emprunt arrive à échéance dans moins de 24 h.",
        "/loans",
        `d1-${r.id}`,
      );
    if (next.settings.reminder_h3 && mins > 0 && mins <= 180)
      notify(
        next,
        r.borrower_id,
        "reminder_h3",
        "Retour dans 3 h",
        "Pensez à rapporter le matériel.",
        "/loans",
        `h3-${r.id}`,
      );
    if (isOverdue(due, now, next.settings.overdue_grace_minutes)) {
      if (r.status !== "overdue") {
        r.status = "overdue";
        changed = true;
        audit(next, null, "reservation_overdue", "reservation", r.id);
      }
      notify(
        next,
        r.borrower_id,
        "overdue",
        "Échéance dépassée",
        "Rapportez le matériel au magasin au plus vite.",
        "/loans",
        `od-${r.id}`,
      );
      notify(
        next,
        "role:technician",
        "overdue",
        "Retour en retard",
        next.profiles.find((p) => p.id === r.borrower_id)?.full_name ?? "",
        "/tech",
        `odt-${r.id}`,
      );
      const b = next.profiles.find((p) => p.id === r.borrower_id);
      if (b && !b.is_blocked && shouldBlockBorrower(due, now, next.settings)) {
        b.is_blocked = true;
        b.blocked_reason = `Retard > ${next.settings.block_after_overdue_hours} h (réservation ${r.id.slice(0, 8)})`;
        notify(
          next,
          b.id,
          "info",
          "Compte bloqué",
          b.blocked_reason + ". Vous pouvez contester depuis votre profil.",
          "/profile",
        );
        audit(next, null, "auto_block", "profile", b.id, b.blocked_reason);
        changed = true;
      }
    }
    if (next.notifications.length !== len) changed = true;
  }
  if (changed) commit((d) => Object.assign(d, next));
}

export function takeIncident(id: string) {
  commit((d) => {
    const p = me(d);
    requireRole(p, ["technician", "admin"]);
    const i = d.incidents.find((x) => x.id === id);
    if (!i || i.status !== "open")
      throw new AppError("Incident déjà pris en charge ou introuvable.");
    i.status = "in_progress";
    audit(d, p.id, "incident_take", "incident", id);
  });
}
