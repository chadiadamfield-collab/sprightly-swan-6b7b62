-- ISMAC-FLT — schéma initial. ADDITIF : aucun DROP de données. Inspecter la base avant d'exécuter.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ===== Enums =====
do $$ begin create type public.app_role as enum ('student','technician','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.equipment_status as enum ('available','reserved','checked_out','maintenance','out_of_service'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reservation_status as enum ('requested','approved','active','returned','cancelled','overdue','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.item_status as enum ('pending','checked_out','returned','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.incident_status as enum ('open','in_progress','resolved'); exception when duplicate_object then null; end $$;
do $$ begin create type public.check_kind as enum ('checkout','return'); exception when duplicate_object then null; end $$;

-- ===== Tables =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  promo text not null default '',
  role public.app_role not null default 'student',
  is_blocked boolean not null default false,
  blocked_reason text,
  contest_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  room text not null, cabinet text not null default '', shelf text not null default '',
  created_at timestamptz not null default now(),
  unique (room, cabinet, shelf)
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  qr_token uuid not null unique default gen_random_uuid(),  -- opaque, JAMAIS un secret d'autorisation
  name text not null, category text not null,
  brand text not null default '', model text not null default '',
  serial_number text,
  location_id uuid not null references public.locations(id),
  status public.equipment_status not null default 'available',
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists equipment_status_idx on public.equipment(status);
create index if not exists equipment_location_idx on public.equipment(location_id);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.profiles(id),
  start_at timestamptz not null, due_at timestamptz not null,
  purpose text not null check (length(btrim(purpose)) >= 3),
  status public.reservation_status not null default 'requested',
  decision_reason text, decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (due_at > start_at)
);
create index if not exists reservations_borrower_idx on public.reservations(borrower_id, status);
create index if not exists reservations_due_idx on public.reservations(due_at) where status in ('active','overdue');

-- period copiée de la réservation : la contrainte d'exclusion garantit l'absence de double réservation (atomique, sans race condition)
create table if not exists public.reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id),
  status public.item_status not null default 'pending',
  period tstzrange not null,
  checked_out_at timestamptz, returned_at timestamptz,
  unique (reservation_id, equipment_id),
  constraint no_double_booking exclude using gist (equipment_id with =, period with &&)
    where (status in ('pending','checked_out'))
);
create index if not exists items_equipment_idx on public.reservation_items(equipment_id);

create table if not exists public.condition_checks (
  id uuid primary key default gen_random_uuid(),
  reservation_item_id uuid not null references public.reservation_items(id),
  equipment_id uuid not null references public.equipment(id),
  kind public.check_kind not null,
  visual_ok boolean not null, accessories_ok boolean not null, power_ok boolean not null,
  notes text, performed_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists checks_equipment_idx on public.condition_checks(equipment_id, created_at desc);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  reservation_item_id uuid references public.reservation_items(id),
  reported_by uuid not null references public.profiles(id),
  description text not null check (length(btrim(description)) >= 5),
  photo_path text,                -- chemin dans le bucket privé incident-photos
  status public.incident_status not null default 'open',
  resolution text, resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists incidents_open_idx on public.incidents(status, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  for_staff boolean not null default false,
  kind text not null, title text not null, body text not null default '', link text,
  read boolean not null default false, dedupe_key text unique,
  created_at timestamptz not null default now(),
  check (user_id is not null or for_staff)
);
create index if not exists notif_user_idx on public.notifications(user_id, read, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid, action text not null, entity text not null, entity_id text, details text,
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_logs(created_at desc);

create table if not exists public.app_settings (
  id boolean primary key default true check (id),   -- singleton
  timezone text not null default 'Africa/Casablanca',
  max_loan_hours int not null default 72 check (max_loan_hours > 0),
  pickup_window_minutes int not null default 120 check (pickup_window_minutes >= 0),
  reminder_d1 boolean not null default true, reminder_h3 boolean not null default true,
  overdue_grace_minutes int not null default 15 check (overdue_grace_minutes >= 0),
  block_after_overdue_hours int not null default 24 check (block_after_overdue_hours > 0),
  show_holder_to_students boolean not null default false,
  technician_direct_checkout boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;

-- ===== Helpers de rôle (security definer : évite la récursion RLS) =====
create or replace function public.current_role_() returns public.app_role
language sql stable security definer set search_path = public as $$ select role from public.profiles where id = auth.uid() $$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.current_role_() in ('technician','admin'), false) $$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.current_role_() = 'admin', false) $$;

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_details text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs(actor_id, action, entity, entity_id, details) values (auth.uid(), p_action, p_entity, p_entity_id, p_details) $$;

-- ===== Inscription : TOUJOURS étudiant =====
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name, promo, role)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.raw_user_meta_data->>'promo',''), 'student');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Empêche l'auto-promotion / auto-déblocage, même en UPDATE direct
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Ne s'applique qu'aux écritures directes du client (rôle authenticated/anon) ; les RPC security definer s'exécutent en propriétaire.
  if current_user in ('authenticated','anon') and not public.is_admin() then
    if new.role is distinct from old.role then raise exception 'Modification du rôle interdite'; end if;
  end if;
  if current_user in ('authenticated','anon') and not public.is_staff() then
    if new.is_blocked is distinct from old.is_blocked or new.blocked_reason is distinct from old.blocked_reason or new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Modification interdite'; end if;
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles for each row execute function public.guard_profile_update();

-- Audit immuable
create or replace function public.audit_immutable() returns trigger language plpgsql as $$ begin raise exception 'audit_logs est immuable'; end $$;
drop trigger if exists audit_no_change on public.audit_logs;
create trigger audit_no_change before update or delete on public.audit_logs for each row execute function public.audit_immutable();

-- ===== RLS =====
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.equipment enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_items enable row level security;
alter table public.condition_checks enable row level security;
alter table public.incidents enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid() or public.is_staff()) with check (id = auth.uid() or public.is_staff());

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations for select to authenticated using (true);
drop policy if exists locations_staff_write on public.locations;
create policy locations_staff_write on public.locations for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Le parc est visible de tous les connectés (aucune donnée personnelle dans equipment)
drop policy if exists equipment_select on public.equipment;
create policy equipment_select on public.equipment for select to authenticated using (true);
drop policy if exists equipment_staff_write on public.equipment;
create policy equipment_staff_write on public.equipment for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Réservations / items : lecture propriétaire ou staff. AUCUNE écriture directe : RPC uniquement.
drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations for select to authenticated using (borrower_id = auth.uid() or public.is_staff());
drop policy if exists items_select on public.reservation_items;
create policy items_select on public.reservation_items for select to authenticated
  using (public.is_staff() or exists (select 1 from public.reservations r where r.id = reservation_id and r.borrower_id = auth.uid()));
drop policy if exists checks_select on public.condition_checks;
create policy checks_select on public.condition_checks for select to authenticated
  using (public.is_staff() or performed_by = auth.uid());
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents for select to authenticated using (public.is_staff() or reported_by = auth.uid());
drop policy if exists incidents_staff_update on public.incidents;
create policy incidents_staff_update on public.incidents for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid() or (for_staff and public.is_staff()));
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid() or (for_staff and public.is_staff())) with check (user_id = auth.uid() or (for_staff and public.is_staff()));

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (public.is_admin());

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (true);
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_admin_write on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Privilèges de table : retire les écritures directes sensibles
revoke insert, update, delete on public.reservations, public.reservation_items, public.condition_checks, public.audit_logs from authenticated, anon;
revoke insert, delete on public.incidents, public.notifications, public.profiles from authenticated, anon;
revoke all on all tables in schema public from anon;

-- ===== RPC =====
-- Parc avec échéance / détenteur (détenteur masqué aux étudiants selon la politique)
create or replace function public.equipment_board()
returns table (equipment_id uuid, next_due_at timestamptz, holder_name text)
language sql stable security definer set search_path = public as $$
  select i.equipment_id, r.due_at,
    case when public.is_staff() or (select show_holder_to_students from public.app_settings) then p.full_name else null end
  from public.reservation_items i join public.reservations r on r.id = i.reservation_id join public.profiles p on p.id = r.borrower_id
  where i.status = 'checked_out' and auth.uid() is not null $$;

-- Créneaux occupés SANS identité (calendrier de réservation)
create or replace function public.equipment_busy_slots(p_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (equipment_id uuid, start_at timestamptz, due_at timestamptz)
language sql stable security definer set search_path = public as $$
  select equipment_id, lower(period), upper(period) from public.reservation_items
  where equipment_id = any(p_ids) and status in ('pending','checked_out') and period && tstzrange(p_from, p_to) and auth.uid() is not null $$;

create or replace function public.create_reservation(p_equipment_ids uuid[], p_start timestamptz, p_due timestamptz, p_purpose text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles; s public.app_settings; rid uuid; eid uuid; ids uuid[];
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Session invalide'; end if;
  if me.is_blocked then raise exception 'Compte bloqué : réservation impossible'; end if;
  select * into s from public.app_settings;
  ids := (select array_agg(distinct x) from unnest(p_equipment_ids) x);
  if ids is null or array_length(ids,1) = 0 then raise exception 'Sélectionnez au moins un équipement'; end if;
  if length(btrim(coalesce(p_purpose,''))) < 3 then raise exception 'Motif obligatoire'; end if;
  if p_due <= p_start then raise exception 'L''échéance doit être après le début'; end if;
  if p_due < now() then raise exception 'L''échéance est déjà passée'; end if;
  if extract(epoch from (p_due - p_start))/3600 > s.max_loan_hours then raise exception 'Durée maximale : % h', s.max_loan_hours; end if;
  if exists (select 1 from public.equipment where id = any(ids) and status in ('maintenance','out_of_service')) then raise exception 'Un équipement est indisponible (maintenance / hors service)'; end if;
  if (select count(*) from public.equipment where id = any(ids)) <> array_length(ids,1) then raise exception 'Équipement inconnu'; end if;
  insert into public.reservations(borrower_id, start_at, due_at, purpose) values (me.id, p_start, p_due, btrim(p_purpose)) returning id into rid;
  foreach eid in array ids loop
    begin
      insert into public.reservation_items(reservation_id, equipment_id, period) values (rid, eid, tstzrange(p_start, p_due));
    exception when exclusion_violation then
      raise exception 'Conflit : % déjà réservé sur ce créneau', (select asset_code from public.equipment where id = eid);
    end;
  end loop;
  insert into public.notifications(for_staff, kind, title, body, link) values (true,'info','Nouvelle demande', me.full_name || ' — ' || array_length(ids,1) || ' objet(s)', '/tech');
  perform public.write_audit('reservation_create','reservation', rid::text);
  return rid;
end $$;

create or replace function public.cancel_reservation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations;
begin
  select * into r from public.reservations where id = p_id for update;
  if r.id is null then raise exception 'Réservation introuvable'; end if;
  if r.borrower_id <> auth.uid() and not public.is_staff() then raise exception 'Non autorisé'; end if;
  if r.status not in ('requested','approved') then raise exception 'Seules les demandes non retirées peuvent être annulées'; end if;
  update public.reservations set status='cancelled', updated_at=now() where id = p_id;
  update public.reservation_items set status='cancelled' where reservation_id = p_id;
  perform public.write_audit('reservation_cancel','reservation', p_id::text);
end $$;

create or replace function public.decide_reservation(p_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations;
begin
  if not public.is_staff() then raise exception 'Action non autorisée'; end if;
  select * into r from public.reservations where id = p_id for update;
  if r.id is null or r.status <> 'requested' then raise exception 'Demande non en attente'; end if;
  if not p_approve and length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Motif de refus obligatoire'; end if;
  update public.reservations set status = case when p_approve then 'approved'::public.reservation_status else 'rejected'::public.reservation_status end,
    decision_reason = nullif(p_reason,''), decided_by = auth.uid(), updated_at = now() where id = p_id;
  if not p_approve then update public.reservation_items set status='cancelled' where reservation_id = p_id; end if;
  insert into public.notifications(user_id, kind, title, body, link) values (r.borrower_id,'decision', case when p_approve then 'Réservation approuvée' else 'Réservation refusée' end, coalesce(nullif(p_reason,''), r.purpose), '/loans');
  perform public.write_audit(case when p_approve then 'reservation_approve' else 'reservation_reject' end,'reservation', p_id::text, p_reason);
end $$;

-- Résolution QR -> équipement (le jeton n'autorise rien en soi)
create or replace function public.resolve_qr(p_code text) returns public.equipment
language sql stable security definer set search_path = public as $$
  select e.* from public.equipment e where auth.uid() is not null and (e.asset_code ilike btrim(p_code) or e.qr_token::text = btrim(p_code)) limit 1 $$;

create or replace function public.confirm_checkout(p_item uuid, p_visual boolean, p_acc boolean, p_power boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare it public.reservation_items; r public.reservations; e public.equipment; s public.app_settings; me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into it from public.reservation_items where id = p_item for update;
  if it.id is null or it.status <> 'pending' then raise exception 'Objet déjà sorti ou annulé'; end if;
  select * into r from public.reservations where id = it.reservation_id for update;
  if r.borrower_id <> me.id and not public.is_staff() then raise exception 'Non autorisé'; end if;
  if me.is_blocked then raise exception 'Compte bloqué'; end if;
  if r.status not in ('approved','active') then raise exception 'Réservation non approuvée'; end if;
  select * into s from public.app_settings;
  if now() < r.start_at - make_interval(mins => s.pickup_window_minutes) or now() >= r.due_at then raise exception 'Hors fenêtre de retrait'; end if;
  if not (p_visual and p_acc and p_power) then raise exception 'Toutes les vérifications doivent être cochées, sinon signalez une anomalie'; end if;
  select * into e from public.equipment where id = it.equipment_id for update;
  if e.status not in ('available','reserved') then raise exception 'Objet non disponible'; end if;
  update public.reservation_items set status='checked_out', checked_out_at = now() where id = it.id;
  update public.equipment set status='checked_out', updated_at=now() where id = e.id;
  if r.status = 'approved' then update public.reservations set status='active', updated_at=now() where id = r.id; end if;
  insert into public.condition_checks(reservation_item_id, equipment_id, kind, visual_ok, accessories_ok, power_ok, notes, performed_by)
  values (it.id, e.id, 'checkout', p_visual, p_acc, p_power, p_notes, me.id);
  perform public.write_audit('checkout','equipment', e.id::text, e.asset_code);
end $$;

create or replace function public.report_incident(p_equipment uuid, p_description text, p_photo_path text default null, p_item uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipment; iid uuid;
begin
  if length(btrim(coalesce(p_description,''))) < 5 then raise exception 'Description obligatoire (5 caractères min.)'; end if;
  select * into e from public.equipment where id = p_equipment for update;
  if e.id is null then raise exception 'Équipement inconnu'; end if;
  if not public.is_staff() and not exists (
    select 1 from public.reservation_items i join public.reservations r on r.id = i.reservation_id
    where i.equipment_id = p_equipment and i.status in ('pending','checked_out') and r.borrower_id = auth.uid()) then
    raise exception 'Vous ne pouvez signaler que les objets liés à vos réservations'; end if;
  if p_photo_path is not null and p_photo_path not like auth.uid()::text || '/%' then raise exception 'Chemin de photo invalide'; end if;
  insert into public.incidents(equipment_id, reservation_item_id, reported_by, description, photo_path) values (p_equipment, p_item, auth.uid(), btrim(p_description), p_photo_path) returning id into iid;
  if e.status <> 'checked_out' then update public.equipment set status='maintenance', updated_at=now() where id = e.id; end if;
  insert into public.notifications(for_staff, kind, title, body, link) values (true,'incident','Incident ' || e.asset_code, left(p_description,80), '/equipment/' || e.id);
  perform public.write_audit('incident_open','incident', iid::text, e.asset_code);
  return iid;
end $$;

create or replace function public.confirm_return(p_item uuid, p_visual boolean, p_acc boolean, p_power boolean, p_condition_ok boolean, p_notes text default null, p_photo_path text default null)
returns void language plpgsql security definer set search_path = public as $$
declare it public.reservation_items; e public.equipment; ok boolean;
begin
  if not public.is_staff() then raise exception 'La restitution est confirmée par un technicien'; end if;
  select * into it from public.reservation_items where id = p_item for update;
  if it.id is null or it.status <> 'checked_out' then raise exception 'Objet non sorti'; end if;
  select * into e from public.equipment where id = it.equipment_id for update;
  ok := p_condition_ok and p_visual and p_acc and p_power;
  update public.reservation_items set status='returned', returned_at = now() where id = it.id;
  insert into public.condition_checks(reservation_item_id, equipment_id, kind, visual_ok, accessories_ok, power_ok, notes, performed_by, confirmed_by)
  values (it.id, e.id, 'return', p_visual, p_acc, p_power, p_notes, auth.uid(), auth.uid());
  if ok then update public.equipment set status='available', updated_at=now() where id = e.id;
  else
    update public.equipment set status='maintenance', updated_at=now() where id = e.id;
    insert into public.incidents(equipment_id, reservation_item_id, reported_by, description, photo_path)
    values (e.id, it.id, auth.uid(), coalesce(nullif(btrim(p_notes),''), 'Problème constaté au retour'), p_photo_path);
  end if;
  if not exists (select 1 from public.reservation_items where reservation_id = it.reservation_id and status in ('pending','checked_out')) then
    update public.reservations set status='returned', updated_at=now() where id = it.reservation_id;
  end if;
  perform public.write_audit('return','equipment', e.id::text, e.asset_code || case when ok then ' OK' else ' PROBLÈME' end);
end $$;

create or replace function public.direct_checkout(p_equipment uuid, p_borrower uuid, p_due timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.equipment; b public.profiles; rid uuid;
begin
  if not public.is_staff() then raise exception 'Action non autorisée'; end if;
  if not (select technician_direct_checkout from public.app_settings) then raise exception 'Retrait direct désactivé par l''administration'; end if;
  select * into b from public.profiles where id = p_borrower;
  if b.id is null or b.is_blocked then raise exception 'Emprunteur invalide ou bloqué'; end if;
  select * into e from public.equipment where id = p_equipment for update;
  if e.status <> 'available' then raise exception 'Objet non disponible'; end if;
  if p_due <= now() then raise exception 'Échéance invalide'; end if;
  insert into public.reservations(borrower_id, start_at, due_at, purpose, status, decided_by) values (b.id, now(), p_due, 'Retrait direct technicien', 'active', auth.uid()) returning id into rid;
  begin
    insert into public.reservation_items(reservation_id, equipment_id, status, period, checked_out_at) values (rid, e.id, 'checked_out', tstzrange(now(), p_due), now());
  exception when exclusion_violation then raise exception 'Conflit avec une réservation existante'; end;
  update public.equipment set status='checked_out', updated_at=now() where id = e.id;
  perform public.write_audit('direct_checkout','equipment', e.id::text, b.email);
  return rid;
end $$;

create or replace function public.resolve_incident(p_id uuid, p_resolution text, p_make_available boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inc public.incidents;
begin
  if not public.is_staff() then raise exception 'Action non autorisée'; end if;
  if length(btrim(coalesce(p_resolution,''))) < 3 then raise exception 'Résolution obligatoire'; end if;
  update public.incidents set status='resolved', resolution=p_resolution, resolved_by=auth.uid(), updated_at=now() where id = p_id returning * into inc;
  if p_make_available then update public.equipment set status='available', updated_at=now() where id = inc.equipment_id and status='maintenance'; end if;
  perform public.write_audit('incident_resolve','incident', p_id::text, p_resolution);
end $$;

create or replace function public.set_blocked(p_user uuid, p_blocked boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Action non autorisée'; end if;
  update public.profiles set is_blocked = p_blocked, blocked_reason = case when p_blocked then p_reason end, contest_note = case when p_blocked then contest_note end where id = p_user;
  insert into public.notifications(user_id, kind, title, body) values (p_user,'info', case when p_blocked then 'Compte bloqué' else 'Compte débloqué' end, coalesce(p_reason,''));
  perform public.write_audit(case when p_blocked then 'user_block' else 'user_unblock' end,'profile', p_user::text, p_reason);
end $$;

create or replace function public.set_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Action réservée aux administrateurs'; end if;
  if p_user = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle'; end if;
  update public.profiles set role = p_role where id = p_user;
  perform public.write_audit('role_change','profile', p_user::text, p_role::text);
end $$;

create or replace function public.contest_block(p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set contest_note = p_note where id = auth.uid() and is_blocked;
  insert into public.notifications(for_staff, kind, title, body, link) values (true,'info','Contestation de blocage', p_note, '/tech');
  perform public.write_audit('contest_block','profile', auth.uid()::text, p_note);
end $$;

-- Tâche planifiée : retards (calculés depuis due_at côté serveur), rappels J-1 / H-3, blocage du seul emprunteur
create or replace function public.run_scheduler() returns void
language plpgsql security definer set search_path = public as $$
declare s public.app_settings; r record; mins numeric; late numeric;
begin
  select * into s from public.app_settings;
  for r in select res.*, p.full_name, p.is_blocked from public.reservations res join public.profiles p on p.id = res.borrower_id
           where res.status in ('active','overdue') and exists (select 1 from public.reservation_items i where i.reservation_id = res.id and i.status='checked_out') loop
    mins := extract(epoch from (r.due_at - now()))/60;
    if s.reminder_d1 and mins > 0 and mins <= 1440 then
      insert into public.notifications(user_id, kind, title, body, link, dedupe_key) values (r.borrower_id,'reminder_d1','Retour demain','Votre emprunt arrive à échéance dans moins de 24 h.','/loans','d1-'||r.id) on conflict (dedupe_key) do nothing; end if;
    if s.reminder_h3 and mins > 0 and mins <= 180 then
      insert into public.notifications(user_id, kind, title, body, link, dedupe_key) values (r.borrower_id,'reminder_h3','Retour dans 3 h','Pensez à rapporter le matériel.','/loans','h3-'||r.id) on conflict (dedupe_key) do nothing; end if;
    late := -mins - s.overdue_grace_minutes;
    if late > 0 then
      if r.status <> 'overdue' then update public.reservations set status='overdue', updated_at=now() where id = r.id;
        insert into public.audit_logs(actor_id, action, entity, entity_id) values (null,'reservation_overdue','reservation', r.id::text); end if;
      insert into public.notifications(user_id, kind, title, body, link, dedupe_key) values (r.borrower_id,'overdue','Échéance dépassée','Rapportez le matériel au magasin au plus vite.','/loans','od-'||r.id) on conflict (dedupe_key) do nothing;
      insert into public.notifications(for_staff, kind, title, body, link, dedupe_key) values (true,'overdue','Retour en retard', r.full_name,'/tech','odt-'||r.id) on conflict (dedupe_key) do nothing;
      if not r.is_blocked and late >= s.block_after_overdue_hours*60 then
        update public.profiles set is_blocked = true, blocked_reason = 'Retard > '||s.block_after_overdue_hours||' h (réservation '||left(r.id::text,8)||')' where id = r.borrower_id;
        insert into public.notifications(user_id, kind, title, body, link) values (r.borrower_id,'info','Compte bloqué','Retard constaté. Vous pouvez contester depuis votre profil.','/profile');
        insert into public.audit_logs(actor_id, action, entity, entity_id, details) values (null,'auto_block','profile', r.borrower_id::text, 'retard');
      end if;
    end if;
  end loop;
end $$;
revoke execute on function public.run_scheduler() from public, anon, authenticated;
-- Planification (extension pg_cron à activer dans Supabase → Database → Extensions) :
-- select cron.schedule('ismac-flt-scheduler', '*/5 * * * *', $$select public.run_scheduler()$$);

-- Droits d'exécution : réservés aux utilisateurs connectés
do $$ declare f text; begin
  foreach f in array array['equipment_board()','equipment_busy_slots(uuid[],timestamptz,timestamptz)','create_reservation(uuid[],timestamptz,timestamptz,text)','cancel_reservation(uuid)','decide_reservation(uuid,boolean,text)','resolve_qr(text)','confirm_checkout(uuid,boolean,boolean,boolean,text)','report_incident(uuid,text,text,uuid)','confirm_return(uuid,boolean,boolean,boolean,boolean,text,text)','direct_checkout(uuid,uuid,timestamptz)','resolve_incident(uuid,text,boolean)','set_blocked(uuid,boolean,text)','set_role(uuid,public.app_role)','contest_block(text)']
  loop execute format('revoke execute on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f); end loop;
end $$;

-- Realtime sur le statut du parc
do $$ begin alter publication supabase_realtime add table public.equipment; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when others then null; end $$;
