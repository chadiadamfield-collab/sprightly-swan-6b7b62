-- Réservations demandées/approuvées jamais retirées : elles ne doivent pas bloquer le matériel après leur échéance.
create or replace function public.expire_unclaimed() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, borrower_id, purpose from public.reservations
           where status in ('requested','approved') and due_at < now() for update loop
    update public.reservations set status = 'cancelled',
      decision_reason = coalesce(decision_reason || ' — ', '') || 'Expirée : non retirée avant l''échéance', updated_at = now() where id = r.id;
    update public.reservation_items set status = 'cancelled' where reservation_id = r.id and status = 'pending';
    insert into public.notifications(user_id, kind, title, body, link, dedupe_key)
      values (r.borrower_id, 'info', 'Réservation expirée', '« ' || r.purpose || ' » n''a pas été retirée avant l''échéance.', '/loans', 'exp-' || r.id)
      on conflict (dedupe_key) do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id) values (null, 'reservation_expired', 'reservation', r.id::text);
  end loop;
end $$;
revoke execute on function public.expire_unclaimed() from public, anon, authenticated;

create or replace function public.tick_scheduler() returns void
language plpgsql security definer set search_path = public as $$
declare ran timestamptz;
begin
  if auth.uid() is null then return; end if;
  update public.app_settings set last_scheduler_run = now()
   where id and (last_scheduler_run is null or last_scheduler_run < now() - interval '1 minute')
   returning last_scheduler_run into ran;
  if ran is not null then perform public.expire_unclaimed(); perform public.run_scheduler(); end if;
end $$;
revoke execute on function public.tick_scheduler() from public, anon;
grant execute on function public.tick_scheduler() to authenticated;
