-- ============================================================
-- KITOM v2.2.1 · 01 · TIPOS ENUM
-- CAMBIO vs v2.2 (punto 5): se añade 'processing' a ai_request_status
-- para poder reclamar un análisis de forma atómica (pending ->
-- processing) antes de llamar al proveedor de IA, y así evitar que
-- dos invocaciones concurrentes de la Edge Function procesen el mismo
-- análisis dos veces. Encaja limpiamente: un valor más en un enum ya
-- existente, sin tocar ninguna tabla ni relación.
-- ============================================================
create type pet_sex             as enum ('male','female','unknown');
create type co_owner_role       as enum ('editor','viewer');
create type co_owner_status     as enum ('pending','accepted','declined','revoked');
create type subscription_plan   as enum ('free','premium');
create type subscription_status as enum ('active','trialing','past_due','canceled','expired');
create type reminder_type       as enum ('vaccine','medication','appointment','bath','deworming','other');
create type reminder_status     as enum ('pending','completed','skipped');
create type urgency_level       as enum ('observe','routine_change','consult_soon','urgent');
create type feedback_value      as enum ('useful','not_useful');
create type push_platform       as enum ('ios','android');
create type ai_request_status   as enum ('pending','processing','completed','failed');
create type org_type            as enum ('individual','shelter','breeder','veterinary_clinic','zoo');
create type org_member_role     as enum ('owner','admin','member');
