-- Historique d'un équipement, filtré selon la politique de confidentialité (le détenteur n'est nommé qu'au staff, à l'intéressé, ou si la politique l'autorise).
create or replace function public.equipment_history(p_equipment uuid)
returns table (event_at timestamptz, kind text, detail text, holder_name text, mine boolean)
language sql stable security definer set search_path = public as $$
  with a as (select public.is_staff() as staff, coalesce((select show_holder_to_students from public.app_settings), false) as show)
  select * from (
    select i.checked_out_at as event_at, 'checkout'::text as kind, null::text as detail,
      case when a.staff or a.show or r.borrower_id = auth.uid() then p.full_name end as holder_name,
      (r.borrower_id = auth.uid()) as mine
    from public.reservation_items i join public.reservations r on r.id = i.reservation_id
      join public.profiles p on p.id = r.borrower_id cross join a
    where i.equipment_id = p_equipment and i.checked_out_at is not null
    union all
    select i.returned_at, 'return'::text, null::text,
      case when a.staff or a.show or r.borrower_id = auth.uid() then p.full_name end,
      (r.borrower_id = auth.uid())
    from public.reservation_items i join public.reservations r on r.id = i.reservation_id
      join public.profiles p on p.id = r.borrower_id cross join a
    where i.equipment_id = p_equipment and i.returned_at is not null
    union all
    select c.created_at, 'check_' || c.kind::text,
      (case when c.visual_ok and c.accessories_ok and c.power_ok then 'OK' else 'Problème' end)
        || (case when a.staff and coalesce(c.notes, '') <> '' then ' — ' || c.notes else '' end),
      null::text, (c.performed_by = auth.uid())
    from public.condition_checks c cross join a where c.equipment_id = p_equipment
    union all
    select n.created_at, 'incident_' || n.status::text,
      case when a.staff then n.description || coalesce(' → ' || n.resolution, '') end,
      null::text, (n.reported_by = auth.uid())
    from public.incidents n cross join a where n.equipment_id = p_equipment
  ) h
  where auth.uid() is not null
  order by event_at desc limit 200 $$;
revoke execute on function public.equipment_history(uuid) from public, anon;
grant execute on function public.equipment_history(uuid) to authenticated;

create or replace function public.take_incident(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Action non autorisée'; end if;
  update public.incidents set status = 'in_progress', updated_at = now() where id = p_id and status = 'open';
  if not found then raise exception 'Incident déjà pris en charge ou introuvable'; end if;
  perform public.write_audit('incident_take', 'incident', p_id::text);
end $$;
revoke execute on function public.take_incident(uuid) from public, anon;
grant execute on function public.take_incident(uuid) to authenticated;
