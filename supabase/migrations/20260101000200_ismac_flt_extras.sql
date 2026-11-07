-- Compléments : planificateur sans pg_cron, réglages et statuts via RPC (audités), audit des fiches équipement/lieux.
alter table public.app_settings add column if not exists last_scheduler_run timestamptz;

-- Appelable par tout utilisateur connecté, mais limité à 1 exécution / minute et sans effet de bord exploitable.
create or replace function public.tick_scheduler() returns void
language plpgsql security definer set search_path = public as $$
declare ran timestamptz;
begin
  if auth.uid() is null then return; end if;
  update public.app_settings set last_scheduler_run = now()
   where id and (last_scheduler_run is null or last_scheduler_run < now() - interval '1 minute')
   returning last_scheduler_run into ran;
  if ran is not null then perform public.run_scheduler(); end if;
end $$;
revoke execute on function public.tick_scheduler() from public, anon;
grant execute on function public.tick_scheduler() to authenticated;

create or replace function public.update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Action réservée aux administrateurs'; end if;
  perform now() at time zone (p->>'timezone');  -- lève une erreur si le fuseau est invalide
  update public.app_settings set
    timezone = p->>'timezone',
    max_loan_hours = (p->>'max_loan_hours')::int,
    pickup_window_minutes = (p->>'pickup_window_minutes')::int,
    reminder_d1 = (p->>'reminder_d1')::boolean,
    reminder_h3 = (p->>'reminder_h3')::boolean,
    overdue_grace_minutes = (p->>'overdue_grace_minutes')::int,
    block_after_overdue_hours = (p->>'block_after_overdue_hours')::int,
    show_holder_to_students = (p->>'show_holder_to_students')::boolean,
    technician_direct_checkout = (p->>'technician_direct_checkout')::boolean,
    updated_at = now()
  where id;
  perform public.write_audit('settings_update','app_settings','1', p::text);
end $$;
revoke execute on function public.update_settings(jsonb) from public, anon;
grant execute on function public.update_settings(jsonb) to authenticated;

create or replace function public.set_equipment_status(p_id uuid, p_status public.equipment_status) returns void
language plpgsql security definer set search_path = public as $$
declare e public.equipment;
begin
  if not public.is_staff() then raise exception 'Action non autorisée'; end if;
  select * into e from public.equipment where id = p_id for update;
  if e.id is null then raise exception 'Équipement inconnu'; end if;
  if e.status = 'checked_out' then raise exception 'Objet actuellement sorti'; end if;
  if p_status in ('checked_out','reserved') then raise exception 'Statut géré automatiquement'; end if;
  update public.equipment set status = p_status, updated_at = now() where id = p_id;
  perform public.write_audit('equipment_status','equipment', p_id::text, p_status::text);
end $$;
revoke execute on function public.set_equipment_status(uuid, public.equipment_status) from public, anon;
grant execute on function public.set_equipment_status(uuid, public.equipment_status) to authenticated;

-- Audit des créations / suppressions / modifications de fiche (hors changements de statut gérés par RPC)
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit(tg_table_name || '_' || lower(tg_op), tg_table_name, coalesce(new.id::text, old.id::text));
  return coalesce(new, old);
end $$;
drop trigger if exists audit_equipment_ins_del on public.equipment;
create trigger audit_equipment_ins_del after insert or delete on public.equipment for each row execute function public.audit_row();
drop trigger if exists audit_equipment_edit on public.equipment;
create trigger audit_equipment_edit after update on public.equipment for each row
  when (old.status is not distinct from new.status and (old.name, old.category, old.brand, old.model, old.location_id, old.asset_code, old.serial_number, old.notes) is distinct from (new.name, new.category, new.brand, new.model, new.location_id, new.asset_code, new.serial_number, new.notes))
  execute function public.audit_row();
drop trigger if exists audit_locations on public.locations;
create trigger audit_locations after insert or update or delete on public.locations for each row execute function public.audit_row();
