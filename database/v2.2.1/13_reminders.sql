-- ============================================================
-- KITOM v2.2 · 13 · REMINDERS
-- CAMBIOS vs v2.1:
--   - Punto 13 (nuevo): validate_reminder_attachment_path — igual que
--     ai_analysis_requests.photo_path, un adjunto de recordatorio
--     debe pertenecer a la MISMA mascota que el propio recordatorio.
--     En v2.1 esto quedó documentado como limitación aceptada; en
--     v2.2 se implementa (mismo mecanismo, safe_pet_id_from_path()).
--   - GRANT por columna (consistencia con pets/daily_logs): refuerza,
--     además del trigger ya existente, que pet_id/created_by/
--     created_at son inmutables tras la creación.
-- ============================================================
create table public.reminders (
  id               uuid primary key default gen_random_uuid(),
  pet_id           uuid not null references public.pets(id) on delete cascade,
  created_by       uuid references public.profiles(id) on delete set null,
  type             reminder_type not null,
  title            text not null,
  description      text,
  due_at           timestamptz not null,
  snooze_until     timestamptz,
  attachment_path  text,
  status           reminder_status not null default 'pending',
  recurrence_rule  text check (recurrence_rule is null or recurrence_rule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)'),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- "Vencido" sigue sin ser un estado almacenado: se calcula en consulta
-- como status='pending' AND due_at < now().
-- recurrence_rule: el CHECK de arriba es solo una validación de
-- formato básica, no un parser RRULE (RFC 5545) completo — eso es
-- responsabilidad del backend.

create index idx_reminders_pet_due on public.reminders(pet_id, due_at);
create index idx_reminders_status  on public.reminders(status);

create trigger set_timestamp_reminders
before update on public.reminders
for each row execute procedure public.trigger_set_timestamp();

create or replace function public.sync_reminder_completion()
returns trigger as $$
begin
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.sync_reminder_completion() from public, anon, authenticated;

create trigger trg_sync_reminder_completion
before insert or update on public.reminders
for each row execute procedure public.sync_reminder_completion();

create or replace function public.protect_reminder_audit_fields()
returns trigger as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.pet_id is distinct from old.pet_id then
    raise exception 'No se puede modificar pet_id de un recordatorio existente';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'No se puede modificar quién creó el recordatorio';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'No se puede modificar created_at';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.protect_reminder_audit_fields() from public, anon, authenticated;

create trigger trg_protect_reminder_audit
before update on public.reminders
for each row execute procedure public.protect_reminder_audit_fields();

create or replace function public.validate_reminder_attachment_path()
returns trigger as $$
declare
  path_pet_id uuid;
begin
  if new.attachment_path is null then
    return new;
  end if;
  path_pet_id := public.safe_pet_id_from_path(new.attachment_path);
  if path_pet_id is null or path_pet_id <> new.pet_id then
    raise exception 'attachment_path no corresponde a la mascota de este recordatorio';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.validate_reminder_attachment_path() from public, anon, authenticated;

create trigger trg_validate_reminder_attachment_path
before insert or update on public.reminders
for each row execute procedure public.validate_reminder_attachment_path();

alter table public.reminders enable row level security;

create policy "reminders: select members" on public.reminders for select using (public.is_pet_member(pet_id));
create policy "reminders: insert editors" on public.reminders for insert with check (
  public.can_edit_pet(pet_id) and created_by = auth.uid()
);
create policy "reminders: update editors" on public.reminders for update using (public.can_edit_pet(pet_id));
create policy "reminders: delete editors" on public.reminders for delete using (public.can_edit_pet(pet_id));

revoke insert, update on public.reminders from authenticated;
grant insert (pet_id, created_by, type, title, description, due_at, snooze_until,
  attachment_path, status, recurrence_rule, completed_at) on public.reminders to authenticated;
grant update (type, title, description, due_at, snooze_until, attachment_path,
  status, recurrence_rule, completed_at) on public.reminders to authenticated;
-- pet_id, created_by, created_at: ausentes del grant de update.
