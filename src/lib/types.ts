export type Role = "student" | "technician" | "admin";
export type EquipmentStatus =
  "available" | "reserved" | "checked_out" | "maintenance" | "out_of_service";
export type ReservationStatus =
  "requested" | "approved" | "active" | "returned" | "cancelled" | "overdue" | "rejected";
export type ItemStatus = "pending" | "checked_out" | "returned" | "cancelled";
export type IncidentStatus = "open" | "in_progress" | "resolved";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  promo: string;
  role: Role;
  is_blocked: boolean;
  blocked_reason?: string | null;
  contest_note?: string | null;
  created_at: string;
}

export interface Location {
  id: string;
  room: string;
  cabinet: string;
  shelf: string;
}

export interface Equipment {
  id: string;
  asset_code: string;
  qr_token: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  serial_number?: string | null;
  location_id: string;
  status: EquipmentStatus;
  notes?: string | null;
}

export interface ReservationItem {
  id: string;
  reservation_id: string;
  equipment_id: string;
  status: ItemStatus;
  checked_out_at?: string | null;
  returned_at?: string | null;
}

export interface Reservation {
  id: string;
  borrower_id: string;
  start_at: string;
  due_at: string;
  purpose: string;
  status: ReservationStatus;
  decision_reason?: string | null;
  decided_by?: string | null;
  created_at: string;
}

export interface ConditionCheck {
  id: string;
  reservation_item_id: string;
  equipment_id: string;
  kind: "checkout" | "return";
  visual_ok: boolean;
  accessories_ok: boolean;
  power_ok: boolean;
  notes?: string | null;
  performed_by: string;
  confirmed_by?: string | null;
  created_at: string;
}

export interface Incident {
  id: string;
  equipment_id: string;
  reservation_item_id?: string | null;
  reported_by: string;
  description: string;
  photo_url?: string | null;
  status: IncidentStatus;
  resolution?: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string; // or "role:technician"
  kind: "reminder_d1" | "reminder_h3" | "overdue" | "incident" | "decision" | "info";
  title: string;
  body: string;
  link?: string;
  read: boolean;
  created_at: string;
  dedupe_key?: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  details?: string;
  created_at: string;
}

export interface AppSettings {
  timezone: string;
  max_loan_hours: number;
  pickup_window_minutes: number;
  reminder_d1: boolean;
  reminder_h3: boolean;
  overdue_grace_minutes: number;
  block_after_overdue_hours: number;
  show_holder_to_students: boolean;
  technician_direct_checkout: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: "Africa/Casablanca",
  max_loan_hours: 72,
  pickup_window_minutes: 120,
  reminder_d1: true,
  reminder_h3: true,
  overdue_grace_minutes: 15,
  block_after_overdue_hours: 24,
  show_holder_to_students: false,
  technician_direct_checkout: true,
};
