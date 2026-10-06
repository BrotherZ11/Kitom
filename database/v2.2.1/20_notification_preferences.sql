-- ============================================================
-- KITOM v2.2 · 20 · NOTIFICATION_PREFERENCES — sin cambios vs v2.1.
-- Auditado (punto 31): solo existen preferencias a nivel de usuario,
-- no por mascota, así que no aplica la comprobación de acceso a
-- mascota que pedía el documento para ese caso.
-- ============================================================
create table public.notification_preferences (
  user_id                           uuid primary key references public.profiles(id) on delete cascade,
  daily_reminder_enabled            boolean not null default true,
  daily_reminder_time               time not null default '20:00',
  alert_notifications_enabled       boolean not null default true,
  marketing_notifications_enabled   boolean not null default false,
  updated_at                        timestamptz not null default now()
);

create trigger set_timestamp_notification_preferences
before update on public.notification_preferences
for each row execute procedure public.trigger_set_timestamp();

alter table public.notification_preferences enable row level security;

create policy "notif_prefs: manage own" on public.notification_preferences for all
using (user_id = auth.uid()) with check (user_id = auth.uid());
