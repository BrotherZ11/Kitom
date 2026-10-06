-- ============================================================
-- KITOM v2.2.1 · 19 · PUSH_TOKENS
-- CAMBIO vs v2.2 (punto 10): nueva register_push_token(). Resuelve el
-- caso "usuario A cierra sesión, usuario B inicia sesión en el mismo
-- dispositivo y su push token físico ya existe en la tabla, asignado
-- a A". Con la policy "manage own" normal, B no puede modificar esa
-- fila (user_id ya no es el suyo) y un INSERT chocaría con
-- UNIQUE(token). La función es SECURITY DEFINER: hace un upsert que
-- SIEMPRE reasigna el token al auth.uid() que la invoca, sin importar
-- quién lo tuviera antes. Esto es seguro porque un token de push es
-- un identificador de DISPOSITIVO/instalación emitido por el sistema
-- operativo o el servicio de push — no es un secreto de otro usuario
-- que se pueda robar, así que reasignarlo a quien esté autenticado
-- ahora mismo en ese dispositivo es el comportamiento correcto, no
-- una vulnerabilidad. No se crea ninguna tabla nueva.
--
-- Recomendación documentada en FRONTEND_ARCHITECTURE.md: además de
-- esta función, el cliente debería desregistrar (borrar) el token al
-- cerrar sesión explícitamente, como buena práctica adicional — pero
-- la función por sí sola ya cubre el caso aunque eso falle (cierre de
-- sesión sin red, cierre forzado de la app, etc.).
-- ============================================================
create table public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  token         text not null unique,
  platform      push_platform not null,
  device_id     text,
  app_version   text,
  os_version    text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

create policy "push_tokens: manage own" on public.push_tokens for all
using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.register_push_token(
  p_token text,
  p_platform push_platform,
  p_device_id text default null,
  p_app_version text default null,
  p_os_version text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  insert into public.push_tokens (user_id, token, platform, device_id, app_version, os_version, is_active, last_seen_at)
  values (auth.uid(), p_token, p_platform, p_device_id, p_app_version, p_os_version, true, now())
  on conflict (token) do update
  set user_id      = auth.uid(),
      platform     = excluded.platform,
      device_id    = excluded.device_id,
      app_version  = excluded.app_version,
      os_version   = excluded.os_version,
      is_active    = true,
      last_seen_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, push_platform, text, text, text) from public, anon;
grant execute on function public.register_push_token(text, push_platform, text, text, text) to authenticated;
