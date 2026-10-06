-- ============================================================
-- KITOM v2.2 · 04 · CATALOG_TRANSLATIONS — sin cambios vs v2.1
-- Limitación aceptada y documentada (punto 25): al ser una asociación
-- polimórfica (entity_type + entity_id), PostgreSQL no puede
-- garantizar una FK real hacia la tabla correcta según entity_type.
-- Se mantiene así para el MVP; la integridad se garantiza en el
-- seed/backend, no a nivel de constraint de BD.
-- ============================================================
create table public.catalog_translations (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('species','symptom','achievement')),
  entity_id    uuid not null,
  locale       text not null,
  field        text not null,
  value        text not null,
  unique (entity_type, entity_id, locale, field)
);

create index idx_catalog_translations_lookup on public.catalog_translations(entity_type, entity_id, locale);

alter table public.catalog_translations enable row level security;

create policy "catalog_translations: select authenticated" on public.catalog_translations for select using (auth.role() = 'authenticated');
