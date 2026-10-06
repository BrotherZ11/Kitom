SET local check_function_bodies = off;

CREATE EXTENSION "pg_trgm" SCHEMA "public";

CREATE TABLE "public"."achievements_catalog" (
  "id"         uuid    NOT NULL DEFAULT gen_random_uuid(),
  "code"       text    NOT NULL,
  "icon"       text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "criteria"   jsonb   NOT NULL,
  CONSTRAINT "achievements_catalog_code_key" UNIQUE (code),
  CONSTRAINT "achievements_catalog_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."achievements_catalog"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ai_analysis_requests" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "pet_id"            uuid                     NOT NULL,
  "requested_by"      uuid,
  "photo_path"        text,
  "used_full_history" boolean                  NOT NULL DEFAULT false,
  "error_message"     text,
  "ai_provider"       text,
  "ai_model"          text,
  "prompt_version"    text,
  "response_raw"      jsonb,
  "possible_causes"   text[],
  "recommendations"   text[],
  "feedback_comment"  text,
  "cost_usd"          numeric(10,6),
  "latency_ms"        integer,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_analysis_requests_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ai_analysis_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ai_analysis_symptoms" (
  "analysis_id" uuid NOT NULL,
  "symptom_id"  uuid NOT NULL,
  CONSTRAINT "ai_analysis_symptoms_pkey" PRIMARY KEY (analysis_id, symptom_id)
);

ALTER TABLE "public"."ai_analysis_symptoms"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."analytics_events" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid,
  "event_name" text                     NOT NULL,
  "properties" jsonb                    DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."analytics_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."catalog_translations" (
  "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
  "entity_type" text NOT NULL,
  "entity_id"   uuid NOT NULL,
  "locale"      text NOT NULL,
  "field"       text NOT NULL,
  "value"       text NOT NULL,
  CONSTRAINT "catalog_translations_entity_type_check" CHECK ((entity_type = ANY (ARRAY['species'::text, 'symptom'::text, 'achievement'::text]))),
  CONSTRAINT "catalog_translations_entity_type_entity_id_locale_field_key" UNIQUE (entity_type, entity_id, LOCALE, field),
  CONSTRAINT "catalog_translations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."catalog_translations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."clinic_referrals" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "clinic_id"   uuid                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "source"      text,
  "campaign"    text,
  "referred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "clinic_referrals_clinic_id_user_id_key" UNIQUE (clinic_id, user_id),
  CONSTRAINT "clinic_referrals_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."clinic_referrals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."daily_logs" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "pet_id"                   uuid                     NOT NULL,
  "logged_by"                uuid,
  "last_edited_by"           uuid,
  "log_date"                 date                     NOT NULL,
  "energy_level"             smallint,
  "appetite_level"           smallint,
  "mood_level"               smallint,
  "activity_level"           smallint,
  "sleep_quality"            smallint,
  "vocalization_level"       smallint,
  "social_interaction_level" smallint,
  "unusual_behavior"         boolean                  NOT NULL DEFAULT false,
  "unusual_behavior_notes"   text,
  "notes"                    text,
  "tags"                     text[]                   DEFAULT '{}'::text[],
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "daily_logs_activity_level_check" CHECK (((activity_level >= 1) AND (activity_level <= 5))),
  CONSTRAINT "daily_logs_appetite_level_check" CHECK (((appetite_level >= 1) AND (appetite_level <= 5))),
  CONSTRAINT "daily_logs_energy_level_check" CHECK (((energy_level >= 1) AND (energy_level <= 5))),
  CONSTRAINT "daily_logs_mood_level_check" CHECK (((mood_level >= 1) AND (mood_level <= 5))),
  CONSTRAINT "daily_logs_pet_id_log_date_key" UNIQUE (pet_id, log_date),
  CONSTRAINT "daily_logs_pkey" PRIMARY KEY (id),
  CONSTRAINT "daily_logs_sleep_quality_check" CHECK (((sleep_quality >= 1) AND (sleep_quality <= 5))),
  CONSTRAINT "daily_logs_social_interaction_level_check" CHECK (((social_interaction_level >= 1) AND (social_interaction_level <= 5))),
  CONSTRAINT "daily_logs_vocalization_level_check" CHECK (((vocalization_level >= 1) AND (vocalization_level <= 5)))
);

ALTER TABLE "public"."daily_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."notification_preferences" (
  "user_id"                         uuid                     NOT NULL,
  "daily_reminder_enabled"          boolean                  NOT NULL DEFAULT true,
  "daily_reminder_time"             time without time zone   NOT NULL DEFAULT '20:00:00'::time WITHOUT time zone,
  "alert_notifications_enabled"     boolean                  NOT NULL DEFAULT true,
  "marketing_notifications_enabled" boolean                  NOT NULL DEFAULT false,
  "updated_at"                      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."notification_preferences"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."pet_achievements" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "pet_id"         uuid                     NOT NULL,
  "achievement_id" uuid                     NOT NULL,
  "earned_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pet_achievements_pet_id_achievement_id_key" UNIQUE (pet_id, achievement_id),
  CONSTRAINT "pet_achievements_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."pet_achievements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."pet_co_owners" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "pet_id"      uuid                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "invited_by"  uuid,
  "invited_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "accepted_at" timestamp with time zone,
  CONSTRAINT "pet_co_owners_pet_id_user_id_key" UNIQUE (pet_id, user_id),
  CONSTRAINT "pet_co_owners_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."pet_co_owners"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."pet_shared_reports" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "pet_id"           uuid                     NOT NULL,
  "generated_by"     uuid,
  "file_path"        text                     NOT NULL,
  "date_range_start" date                     NOT NULL,
  "date_range_end"   date                     NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pet_shared_reports_check" CHECK ((date_range_end >= date_range_start)),
  CONSTRAINT "pet_shared_reports_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."pet_shared_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."pet_streaks" (
  "pet_id"         uuid                     NOT NULL,
  "current_streak" integer                  NOT NULL DEFAULT 0,
  "longest_streak" integer                  NOT NULL DEFAULT 0,
  "last_log_date"  date,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pet_streaks_pkey" PRIMARY KEY (pet_id)
);

ALTER TABLE "public"."pet_streaks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."pets" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "owner_id"          uuid                     NOT NULL,
  "name"              text                     NOT NULL,
  "species_id"        uuid                     NOT NULL,
  "breed"             text,
  "birth_date"        date,
  "weight_kg"         numeric(9,3),
  "sterilized"        boolean,
  "known_conditions"  text[]                   DEFAULT '{}'::text[],
  "allergies"         text[]                   DEFAULT '{}'::text[],
  "temperament_notes" text,
  "photo_path"        text,
  "is_active"         boolean                  NOT NULL DEFAULT true,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pets_pkey" PRIMARY KEY (id),
  CONSTRAINT "pets_weight_kg_check" CHECK ((weight_kg > (0)::numeric))
);

ALTER TABLE "public"."pets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"                      uuid                     NOT NULL,
  "full_name"               text,
  "avatar_path"             text,
  "external_avatar_url"     text,
  "phone"                   text,
  "locale"                  text                     NOT NULL DEFAULT 'es'::text,
  "timezone"                text                     NOT NULL DEFAULT 'UTC'::text,
  "disclaimer_accepted_at"  timestamp with time zone,
  "disclaimer_version"      text,
  "onboarding_completed_at" timestamp with time zone,
  "marketing_opt_in"        boolean                  NOT NULL DEFAULT false,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_phone_key" UNIQUE (phone),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."push_tokens" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      uuid                     NOT NULL,
  "token"        text                     NOT NULL,
  "device_id"    text,
  "app_version"  text,
  "os_version"   text,
  "is_active"    boolean                  NOT NULL DEFAULT true,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "push_tokens_pkey" PRIMARY KEY (id),
  CONSTRAINT "push_tokens_token_key" UNIQUE (token)
);

ALTER TABLE "public"."push_tokens"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reminders" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "pet_id"          uuid                     NOT NULL,
  "created_by"      uuid,
  "title"           text                     NOT NULL,
  "description"     text,
  "due_at"          timestamp with time zone NOT NULL,
  "snooze_until"    timestamp with time zone,
  "attachment_path" text,
  "recurrence_rule" text,
  "completed_at"    timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reminders_pkey" PRIMARY KEY (id),
  CONSTRAINT "reminders_recurrence_rule_check" CHECK (((recurrence_rule IS NULL) OR (recurrence_rule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)'::text)))
);

ALTER TABLE "public"."reminders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."species" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"              text                     NOT NULL,
  "scientific_name"   text,
  "category"          text,
  "parent_species_id" uuid,
  "is_active"         boolean                  NOT NULL DEFAULT false,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "species_code_key" UNIQUE (code),
  CONSTRAINT "species_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."species"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."subscription_events" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id"   uuid                     NOT NULL,
  "provider_event_id" text                     NOT NULL,
  "event_type"        text                     NOT NULL,
  "raw_payload"       jsonb,
  "occurred_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "subscription_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "subscription_events_provider_event_id_key" UNIQUE (provider_event_id)
);

ALTER TABLE "public"."subscription_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."subscriptions" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"                  uuid                     NOT NULL,
  "provider"                 text,
  "provider_subscription_id" text,
  "trial_end"                timestamp with time zone,
  "current_period_start"     timestamp with time zone,
  "current_period_end"       timestamp with time zone,
  "cancel_at_period_end"     boolean                  NOT NULL DEFAULT false,
  "raw_provider_payload"     jsonb,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."subscriptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."symptom_species" (
  "symptom_id" uuid NOT NULL,
  "species_id" uuid NOT NULL,
  CONSTRAINT "symptom_species_pkey" PRIMARY KEY (symptom_id, species_id)
);

ALTER TABLE "public"."symptom_species"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."symptoms_catalog" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"       text                     NOT NULL,
  "category"   text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "symptoms_catalog_code_key" UNIQUE (code),
  CONSTRAINT "symptoms_catalog_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."symptoms_catalog"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."vet_clinics" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"          text                     NOT NULL,
  "city"          text,
  "country"       text,
  "contact_email" text,
  "contact_phone" text,
  "referral_code" text                     NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "vet_clinics_pkey" PRIMARY KEY (id),
  CONSTRAINT "vet_clinics_referral_code_key" UNIQUE (referral_code)
);

ALTER TABLE "public"."vet_clinics"
  ENABLE ROW LEVEL SECURITY;

CREATE TYPE "public"."ai_request_status" AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

ALTER TABLE "public"."ai_analysis_requests"
  ADD COLUMN "status" public.ai_request_status NOT NULL DEFAULT 'pending'::public.ai_request_status;

CREATE TYPE "public"."co_owner_role" AS ENUM (
  'editor',
  'viewer'
);

ALTER TABLE "public"."pet_co_owners"
  ADD COLUMN "role" public.co_owner_role NOT NULL DEFAULT 'viewer'::public.co_owner_role;

CREATE TYPE "public"."co_owner_status" AS ENUM (
  'pending',
  'accepted',
  'declined',
  'revoked'
);

ALTER TABLE "public"."pet_co_owners"
  ADD COLUMN "status" public.co_owner_status NOT NULL DEFAULT 'pending'::public.co_owner_status;

CREATE TYPE "public"."feedback_value" AS ENUM (
  'useful',
  'not_useful'
);

ALTER TABLE "public"."ai_analysis_requests"
  ADD COLUMN "feedback" public.feedback_value;

CREATE TYPE "public"."org_member_role" AS ENUM (
  'owner',
  'admin',
  'member'
);

CREATE TYPE "public"."org_type" AS ENUM (
  'individual',
  'shelter',
  'breeder',
  'veterinary_clinic',
  'zoo'
);

CREATE TYPE "public"."pet_sex" AS ENUM (
  'male',
  'female',
  'unknown'
);

ALTER TABLE "public"."pets"
  ADD COLUMN "sex" public.pet_sex DEFAULT 'unknown'::public.pet_sex;

CREATE TYPE "public"."push_platform" AS ENUM (
  'ios',
  'android'
);

ALTER TABLE "public"."push_tokens"
  ADD COLUMN "platform" public.push_platform NOT NULL;

CREATE TYPE "public"."reminder_status" AS ENUM (
  'pending',
  'completed',
  'skipped'
);

ALTER TABLE "public"."reminders"
  ADD COLUMN "status" public.reminder_status NOT NULL DEFAULT 'pending'::public.reminder_status;

CREATE TYPE "public"."reminder_type" AS ENUM (
  'vaccine',
  'medication',
  'appointment',
  'bath',
  'deworming',
  'other'
);

ALTER TABLE "public"."reminders"
  ADD COLUMN "type" public.reminder_type NOT NULL;

CREATE TYPE "public"."subscription_plan" AS ENUM (
  'free',
  'premium'
);

ALTER TABLE "public"."subscription_events"
  ADD COLUMN "previous_plan" public.subscription_plan;

ALTER TABLE "public"."subscription_events"
  ADD COLUMN "new_plan" public.subscription_plan;

ALTER TABLE "public"."subscriptions"
  ADD COLUMN "plan" public.subscription_plan NOT NULL DEFAULT 'free'::public.subscription_plan;

CREATE TYPE "public"."subscription_status" AS ENUM (
  'active',
  'trialing',
  'past_due',
  'canceled',
  'expired'
);

ALTER TABLE "public"."subscription_events"
  ADD COLUMN "previous_status" public.subscription_status;

ALTER TABLE "public"."subscription_events"
  ADD COLUMN "new_status" public.subscription_status;

ALTER TABLE "public"."subscriptions"
  ADD COLUMN "status" public.subscription_status NOT NULL DEFAULT 'active'::public.subscription_status;

CREATE TYPE "public"."urgency_level" AS ENUM (
  'observe',
  'routine_change',
  'consult_soon',
  'urgent'
);

ALTER TABLE "public"."ai_analysis_requests"
  ADD COLUMN "urgency_level" public.urgency_level;

CREATE OR REPLACE FUNCTION public.accept_pet_invitation (
  invitation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  inv public.pet_co_owners%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;
  if inv.user_id <> auth.uid() then
    raise exception 'No tienes permiso para aceptar esta invitación';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Esta invitación ya no está pendiente (estado actual: %)', inv.status;
  end if;

  update public.pet_co_owners
  set status = 'accepted', accepted_at = now()
  where id = invitation_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."accept_pet_invitation"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.award_pet_achievement (
  target_pet_id    uuid,
  achievement_code text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  ach_id uuid;
begin
  select id into ach_id from public.achievements_catalog where code = achievement_code;
  if ach_id is null then
    return; -- código desconocido: no-op silencioso, no debe romper quien la llama
  end if;

  insert into public.pet_achievements (pet_id, achievement_id)
  values (target_pet_id, ach_id)
  on conflict (pet_id, achievement_id) do nothing;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."award_pet_achievement"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.can_edit_pet (
  target_pet_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.pets p
    where p.id = target_pet_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.pet_co_owners co
    where co.pet_id = target_pet_id and co.user_id = auth.uid()
      and co.role = 'editor' and co.status = 'accepted'
  );
$function$;

REVOKE ALL ON FUNCTION "public"."can_edit_pet"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.change_pet_member_role (
  invitation_id uuid,
  new_role      public.co_owner_role
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  inv public.pet_co_owners%rowtype;
  is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;

  select exists (select 1 from public.pets where id = inv.pet_id and owner_id = auth.uid()) into is_owner;
  if not is_owner then
    raise exception 'Solo el propietario principal puede cambiar el rol de un miembro';
  end if;
  if inv.status <> 'accepted' then
    raise exception 'Solo se puede cambiar el rol de un miembro activo (estado: accepted)';
  end if;

  update public.pet_co_owners set role = new_role where id = invitation_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."change_pet_member_role"(uuid, public.co_owner_role) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.claim_ai_analysis_for_processing (
  target_analysis_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  affected integer;
begin
  update public.ai_analysis_requests
  set status = 'processing'
  where id = target_analysis_id and status = 'pending';

  get diagnostics affected = row_count;
  return affected > 0;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_ai_analysis_for_processing"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.create_clinic_referral (
  clinic_referral_code text,
  ref_source           text DEFAULT NULL::text,
  ref_campaign         text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  target_clinic_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select id into target_clinic_id from public.vet_clinics where referral_code = clinic_referral_code;
  if not found then
    raise exception 'Código de referido no válido';
  end if;

  insert into public.clinic_referrals (clinic_id, user_id, source, campaign)
  values (target_clinic_id, auth.uid(), ref_source, ref_campaign)
  on conflict (clinic_id, user_id) do nothing;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_clinic_referral"(text, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.decline_pet_invitation (
  invitation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  inv public.pet_co_owners%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;
  if inv.user_id <> auth.uid() then
    raise exception 'No tienes permiso para rechazar esta invitación';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Esta invitación ya no está pendiente (estado actual: %)', inv.status;
  end if;

  update public.pet_co_owners set status = 'declined' where id = invitation_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."decline_pet_invitation"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_ai_analysis_entitlement()
  RETURNS TABLE (
    can_request            boolean,
    would_use_full_history boolean,
    monthly_used           integer,
    monthly_limit          integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  requester_plan subscription_plan;
  used_count integer;
  limit_count integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select plan into requester_plan from public.subscriptions where user_id = auth.uid();

  select count(*) into used_count
  from public.ai_analysis_requests r
  where r.requested_by = auth.uid()
    and r.status <> 'failed'
    and r.created_at >= date_trunc('month', now());

  limit_count := case when requester_plan = 'premium' then null else 3 end;

  return query select
    (limit_count is null or used_count < limit_count),
    (requester_plan = 'premium'),
    used_count,
    limit_count;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_ai_analysis_entitlement"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into public.profiles (id, full_name, external_avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.invite_pet_member (
  target_pet_id   uuid,
  invitee_user_id uuid,
  initial_role    public.co_owner_role DEFAULT 'viewer'::public.co_owner_role
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  pet_row public.pets%rowtype;
  existing public.pet_co_owners%rowtype;
  invitee_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into pet_row from public.pets where id = target_pet_id;
  if not found then
    raise exception 'Mascota no encontrada';
  end if;
  if pet_row.owner_id <> auth.uid() then
    raise exception 'Solo el propietario principal puede invitar co-tutores';
  end if;
  if not pet_row.is_active then
    raise exception 'No se puede invitar sobre una mascota archivada';
  end if;
  if invitee_user_id = auth.uid() then
    raise exception 'No puedes invitarte a ti mismo';
  end if;

  select exists(select 1 from public.profiles where id = invitee_user_id) into invitee_exists;
  if not invitee_exists then
    raise exception 'El usuario invitado no existe';
  end if;

  select * into existing from public.pet_co_owners
  where pet_id = target_pet_id and user_id = invitee_user_id;

  if found then
    if existing.status in ('pending','accepted') then
      raise exception 'Ya existe una invitación activa para este usuario (estado: %)', existing.status;
    end if;
    update public.pet_co_owners
    set status = 'pending',
        role = initial_role,
        invited_by = auth.uid(),
        invited_at = now(),
        accepted_at = null
    where pet_id = target_pet_id and user_id = invitee_user_id;
  else
    insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by)
    values (target_pet_id, invitee_user_id, initial_role, 'pending', auth.uid());
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."invite_pet_member"(uuid, uuid, public.co_owner_role) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_pet_member (
  target_pet_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.pets p
    where p.id = target_pet_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.pet_co_owners co
    where co.pet_id = target_pet_id and co.user_id = auth.uid() and co.status = 'accepted'
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_pet_member"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.owner_has_pets()
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (select 1 from public.pets where owner_id = auth.uid());
$function$;

REVOKE ALL ON FUNCTION "public"."owner_has_pets"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.process_revenuecat_event (
  p_provider_event_id        text,
  p_user_id                  uuid,
  p_event_type               text,
  p_new_plan                 public.subscription_plan,
  p_new_status               public.subscription_status,
  p_current_period_start     timestamp with time zone,
  p_current_period_end       timestamp with time zone,
  p_trial_end                timestamp with time zone,
  p_cancel_at_period_end     boolean,
  p_provider                 text,
  p_provider_subscription_id text,
  p_raw_payload              jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  sub_row public.subscriptions%rowtype;
  event_inserted uuid;
begin
  select * into sub_row from public.subscriptions where user_id = p_user_id for update;
  if not found then
    raise exception 'No existe suscripción para el usuario %', p_user_id;
  end if;

  insert into public.subscription_events (
    subscription_id, provider_event_id, event_type,
    previous_plan, new_plan, previous_status, new_status, raw_payload
  )
  values (
    sub_row.id, p_provider_event_id, p_event_type,
    sub_row.plan, p_new_plan, sub_row.status, p_new_status, p_raw_payload
  )
  on conflict (provider_event_id) do nothing
  returning id into event_inserted;

  if event_inserted is null then
    return; -- evento ya procesado antes: no-op idempotente
  end if;

  update public.subscriptions
  set plan = p_new_plan,
      status = p_new_status,
      provider = coalesce(p_provider, provider),
      provider_subscription_id = coalesce(p_provider_subscription_id, provider_subscription_id),
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      trial_end = p_trial_end,
      cancel_at_period_end = p_cancel_at_period_end,
      raw_provider_payload = p_raw_payload
  where user_id = p_user_id;
end;
$function$;

REVOKE ALL
  ON FUNCTION "public"."process_revenuecat_event"(text, uuid, text, public.subscription_plan, public.subscription_status, timestamp WITH time zone, timestamp
    WITH time zone, timestamp WITH time zone, boolean, text, text, jsonb)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.protect_daily_log_audit_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.pet_id is distinct from old.pet_id then
    raise exception 'No se puede modificar pet_id de un registro existente';
  end if;
  if new.logged_by is distinct from old.logged_by then
    raise exception 'No se puede modificar quién creó originalmente el registro';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'No se puede modificar created_at';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."protect_daily_log_audit_fields"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.protect_pet_structural_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- owner_id: bloqueado salvo que transfer_pet_ownership() haya
  -- autorizado explícitamente esta transacción concreta. El GRANT ya
  -- impide que 'authenticated' llegue aquí con owner_id modificado,
  -- pero esta comprobación cubre cualquier otro camino interno.
  if new.owner_id is distinct from old.owner_id then
    if coalesce(current_setting('kitom.ownership_transfer_in_progress', true), 'false') <> 'true' then
      raise exception 'owner_id solo puede modificarse mediante transfer_pet_ownership()';
    end if;
  end if;

  -- is_active: solo el propietario actual (sin cambios vs v2.1).
  if auth.uid() is distinct from old.owner_id then
    if new.is_active is distinct from old.is_active then
      raise exception 'Solo el propietario principal puede archivar/reactivar la mascota';
    end if;
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."protect_pet_structural_fields"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.protect_reminder_audit_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."protect_reminder_audit_fields"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.recompute_pet_streak (
  target_pet_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  calc record;
  owner_tz text;
  owner_local_today date;
begin
  perform pg_advisory_xact_lock(hashtext(target_pet_id::text)::bigint);

  select p.timezone into owner_tz
  from public.pets pt
  join public.profiles p on p.id = pt.owner_id
  where pt.id = target_pet_id;

  owner_local_today := (now() at time zone coalesce(owner_tz, 'UTC'))::date;

  with dates as (
    select distinct log_date
    from public.daily_logs
    where pet_id = target_pet_id
  ),
  numbered as (
    select log_date, row_number() over (order by log_date desc) as rn
    from dates
  ),
  grouped as (
    select log_date, log_date + rn as grp
    from numbered
  ),
  all_runs as (
    select grp, count(*) as len, max(log_date) as run_end
    from grouped
    group by grp
  ),
  current_run as (
    select len from all_runs order by run_end desc limit 1
  )
  select
    coalesce((select len from current_run), 0) as current_len,
    coalesce((select max(len) from all_runs), 0) as longest_len,
    (select max(log_date) from dates) as last_date
  into calc;

  insert into public.pet_streaks (pet_id, current_streak, longest_streak, last_log_date, updated_at)
  values (
    target_pet_id,
    case when calc.last_date >= owner_local_today - 1 then calc.current_len else 0 end,
    calc.longest_len,
    calc.last_date,
    now()
  )
  on conflict (pet_id) do update
  set current_streak = excluded.current_streak,
      -- longest_streak nunca decrece: se conserva el máximo histórico
      -- aunque el recálculo actual dé un valor más bajo (p. ej. tras
      -- borrar logs antiguos).
      longest_streak  = greatest(public.pet_streaks.longest_streak, excluded.longest_streak),
      last_log_date   = excluded.last_log_date,
      updated_at      = now();

  if calc.current_len >= 1 then
    perform public.award_pet_achievement(target_pet_id, 'first_log');
  end if;
  if calc.current_len >= 7 then
    perform public.award_pet_achievement(target_pet_id, 'streak_7');
  end if;
  if calc.current_len >= 30 then
    perform public.award_pet_achievement(target_pet_id, 'streak_30');
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."recompute_pet_streak"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.register_push_token (
  p_token       text,
  p_platform    public.push_platform,
  p_device_id   text                 DEFAULT NULL::text,
  p_app_version text                 DEFAULT NULL::text,
  p_os_version  text                 DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."register_push_token"(text, public.push_platform, text, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.request_ai_analysis (
  target_pet_id uuid,
  p_photo_path  text,
  symptom_ids   uuid[] DEFAULT '{}'::uuid[]
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  pet_row public.pets%rowtype;
  entitlement record;
  sid uuid;
  compatible boolean;
  new_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  -- 1) Acceso a la mascota
  if not public.can_edit_pet(target_pet_id) then
    raise exception 'No tienes acceso de edición sobre esta mascota';
  end if;

  select * into pet_row from public.pets where id = target_pet_id;
  if not found or not pet_row.is_active then
    raise exception 'Mascota no encontrada o archivada';
  end if;

  -- 2) La foto (si la hay) debe pertenecer a esta mascota
  if p_photo_path is not null then
    if public.safe_pet_id_from_path(p_photo_path) is distinct from target_pet_id then
      raise exception 'photo_path no corresponde a esta mascota';
    end if;
  end if;

  -- 3) Cada síntoma debe ser compatible con la especie del animal
  --    (misma comprobación que hace después el trigger de la tabla
  --    puente; se repite aquí para poder dar un mensaje de error claro
  --    antes de crear ninguna fila, no a mitad de una inserción).
  foreach sid in array symptom_ids loop
    select exists (
      select 1 from public.symptom_species ss
      where ss.symptom_id = sid and ss.species_id = pet_row.species_id
    ) into compatible;
    if not compatible then
      raise exception 'El síntoma % no es compatible con la especie de esta mascota', sid;
    end if;
  end loop;

  -- 4) Entitlement del SOLICITANTE (auth.uid()), nunca del owner de
  --    la mascota (punto 6). Advisory lock por usuario para que dos
  --    dispositivos del mismo usuario no gasten el mismo cupo a la vez
  --    (punto 7): la segunda llamada concurrente espera a que la
  --    primera confirme (o falle) antes de volver a contar cuántas
  --    solicitudes lleva este mes.
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || auth.uid()::text)::bigint);

  select * into entitlement from public.get_ai_analysis_entitlement();

  if not entitlement.can_request then
    raise exception 'Has alcanzado tu límite mensual de análisis de IA (% de %)', entitlement.monthly_used, entitlement.monthly_limit;
  end if;

  -- 5) Crear la solicitud. used_full_history lo decide el backend
  --    (entitlement.would_use_full_history), nunca un parámetro del cliente.
  insert into public.ai_analysis_requests (pet_id, requested_by, photo_path, used_full_history, status)
  values (target_pet_id, auth.uid(), p_photo_path, entitlement.would_use_full_history, 'pending')
  returning id into new_request_id;

  foreach sid in array symptom_ids loop
    insert into public.ai_analysis_symptoms (analysis_id, symptom_id) values (new_request_id, sid);
  end loop;

  -- 6) Logro "primer análisis con IA" (backend-owned, ver 15).
  perform public.award_pet_achievement(target_pet_id, 'first_photo_scan');

  return new_request_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."request_ai_analysis"(uuid, text, uuid[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.request_generate_report (
  target_pet_id uuid,
  range_start   date,
  range_end     date
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if not public.can_edit_pet(target_pet_id) then
    raise exception 'No tienes acceso a esta mascota';
  end if;
  if range_end < range_start then
    raise exception 'El rango de fechas no es válido';
  end if;
  if range_end > current_date then
    raise exception 'El rango de fechas no puede terminar en el futuro';
  end if;
  -- Validación superada. El cliente debe invocar ahora la Edge
  -- Function "generate-pet-report" con los mismos parámetros.
end;
$function$;

REVOKE ALL ON FUNCTION "public"."request_generate_report"(uuid, date, date) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revoke_pet_invitation (
  invitation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  inv public.pet_co_owners%rowtype;
  is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into inv from public.pet_co_owners where id = invitation_id;
  if not found then
    raise exception 'Invitación no encontrada';
  end if;

  select exists (select 1 from public.pets where id = inv.pet_id and owner_id = auth.uid()) into is_owner;
  if not is_owner then
    raise exception 'Solo el propietario principal puede revocar el acceso';
  end if;
  if inv.status not in ('pending','accepted') then
    raise exception 'No se puede revocar una invitación en estado %', inv.status;
  end if;

  update public.pet_co_owners set status = 'revoked' where id = invitation_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."revoke_pet_invitation"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.safe_pet_id_from_path (
  object_name text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  first_segment text;
begin
  first_segment := (storage.foldername(object_name))[1];
  if first_segment is null
     or first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
exception when others then
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."safe_pet_id_from_path"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.set_last_edited_by()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  new.last_edited_by = auth.uid();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_last_edited_by"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.submit_ai_feedback (
  target_analysis_id   uuid,
  new_feedback         public.feedback_value,
  new_feedback_comment text                  DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  req public.ai_analysis_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into req from public.ai_analysis_requests where id = target_analysis_id;
  if not found then
    raise exception 'Análisis no encontrado';
  end if;

  -- Punto 3: el feedback pertenece a quien SOLICITÓ el análisis, no a
  -- cualquier miembro con acceso a la mascota.
  if req.requested_by is distinct from auth.uid() then
    raise exception 'Solo el usuario que solicitó el análisis puede enviar o modificar su feedback';
  end if;

  update public.ai_analysis_requests
  set feedback = new_feedback,
      feedback_comment = new_feedback_comment
  where id = target_analysis_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."submit_ai_feedback"(uuid, public.feedback_value, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.sync_reminder_completion()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."sync_reminder_completion"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.transfer_pet_ownership (
  target_pet_id uuid,
  new_owner_id  uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  pet_row public.pets%rowtype;
  new_owner_is_member boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into pet_row from public.pets where id = target_pet_id for update;
  if not found then
    raise exception 'Mascota no encontrada';
  end if;

  if pet_row.owner_id <> auth.uid() then
    raise exception 'Solo el propietario principal puede transferir la mascota';
  end if;

  if new_owner_id is null then
    raise exception 'Debes indicar el nuevo propietario';
  end if;

  if new_owner_id = auth.uid() then
    raise exception 'La mascota ya pertenece a este usuario';
  end if;

  if not exists (select 1 from public.profiles where id = new_owner_id) then
    raise exception 'El nuevo propietario no existe';
  end if;

  select exists (
    select 1 from public.pet_co_owners
    where pet_id = target_pet_id and user_id = new_owner_id and status = 'accepted'
  ) into new_owner_is_member;

  if not new_owner_is_member then
    raise exception 'El nuevo propietario debe ser un co-tutor con invitación aceptada';
  end if;

  perform set_config('kitom.ownership_transfer_in_progress', 'true', true);

  update public.pets set owner_id = new_owner_id where id = target_pet_id;

  delete from public.pet_co_owners where pet_id = target_pet_id and user_id = new_owner_id;

  insert into public.pet_co_owners (pet_id, user_id, role, status, invited_by, accepted_at)
  values (target_pet_id, pet_row.owner_id, 'editor', 'accepted', new_owner_id, now())
  on conflict (pet_id, user_id) do update set role = 'editor', status = 'accepted', accepted_at = now();
end;
$function$;

REVOKE ALL ON FUNCTION "public"."transfer_pet_ownership"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.trg_recompute_pet_streak_fn()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_pet_streak(old.pet_id);
    return old;
  else
    perform public.recompute_pet_streak(new.pet_id);
    return new;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."trg_recompute_pet_streak_fn"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."trigger_set_timestamp"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_ai_request_photo_path()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  path_pet_id uuid;
begin
  if new.photo_path is null then
    return new;
  end if;
  path_pet_id := public.safe_pet_id_from_path(new.photo_path);
  if path_pet_id is null or path_pet_id <> new.pet_id then
    raise exception 'photo_path no corresponde a la mascota de esta solicitud';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_ai_request_photo_path"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_daily_log_date()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  owner_tz text;
  owner_local_today date;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select p.timezone into owner_tz
  from public.pets pt
  join public.profiles p on p.id = pt.owner_id
  where pt.id = new.pet_id;

  owner_local_today := (now() at time zone coalesce(owner_tz, 'UTC'))::date;

  if new.log_date > owner_local_today then
    raise exception 'No se pueden crear registros con fecha futura (hoy es % en la zona horaria del propietario)', owner_local_today;
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_daily_log_date"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_pet_birth_date()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'La fecha de nacimiento no puede ser futura';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_pet_birth_date"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.timezone is null then
    new.timezone := 'UTC';
    return new;
  end if;

  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Zona horaria no válida: % (debe ser un nombre IANA, p. ej. Europe/Madrid)', new.timezone;
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_profile_timezone"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_reminder_attachment_path()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."validate_reminder_attachment_path"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_symptom_species_compat()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  pet_species_id uuid;
  compatible boolean;
begin
  select p.species_id into pet_species_id
  from public.ai_analysis_requests r
  join public.pets p on p.id = r.pet_id
  where r.id = new.analysis_id;

  select exists (
    select 1 from public.symptom_species ss
    where ss.symptom_id = new.symptom_id and ss.species_id = pet_species_id
  ) into compatible;

  if not compatible then
    raise exception 'El síntoma % no está registrado como compatible con la especie de esta mascota', new.symptom_id;
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_symptom_species_compat"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."ai_analysis_symptoms"
  ADD CONSTRAINT "ai_analysis_symptoms_analysis_id_fkey" FOREIGN KEY (analysis_id) REFERENCES public.ai_analysis_requests(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_achievements"
  ADD CONSTRAINT "pet_achievements_achievement_id_fkey" FOREIGN KEY (achievement_id) REFERENCES public.achievements_catalog(id);

ALTER TABLE "public"."ai_analysis_requests"
  ADD CONSTRAINT "ai_analysis_requests_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."daily_logs"
  ADD CONSTRAINT "daily_logs_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_achievements"
  ADD CONSTRAINT "pet_achievements_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_co_owners"
  ADD CONSTRAINT "pet_co_owners_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_shared_reports"
  ADD CONSTRAINT "pet_shared_reports_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_streaks"
  ADD CONSTRAINT "pet_streaks_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."ai_analysis_requests"
  ADD CONSTRAINT "ai_analysis_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."analytics_events"
  ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."clinic_referrals"
  ADD CONSTRAINT "clinic_referrals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."daily_logs"
  ADD CONSTRAINT "daily_logs_last_edited_by_fkey" FOREIGN KEY (last_edited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."daily_logs"
  ADD CONSTRAINT "daily_logs_logged_by_fkey" FOREIGN KEY (logged_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."notification_preferences"
  ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_co_owners"
  ADD CONSTRAINT "pet_co_owners_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."pet_co_owners"
  ADD CONSTRAINT "pet_co_owners_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."pet_shared_reports"
  ADD CONSTRAINT "pet_shared_reports_generated_by_fkey" FOREIGN KEY (generated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."pets"
  ADD CONSTRAINT "pets_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."push_tokens"
  ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."reminders"
  ADD CONSTRAINT "reminders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."reminders"
  ADD CONSTRAINT "reminders_pet_id_fkey" FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE;

ALTER TABLE "public"."pets"
  ADD CONSTRAINT "pets_species_id_fkey" FOREIGN KEY (species_id) REFERENCES public.species(id);

ALTER TABLE "public"."species"
  ADD CONSTRAINT "species_parent_species_id_fkey" FOREIGN KEY (parent_species_id) REFERENCES public.species(id);

ALTER TABLE "public"."subscription_events"
  ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;

ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."symptom_species"
  ADD CONSTRAINT "symptom_species_species_id_fkey" FOREIGN KEY (species_id) REFERENCES public.species(id) ON DELETE CASCADE;

ALTER TABLE "public"."ai_analysis_symptoms"
  ADD CONSTRAINT "ai_analysis_symptoms_symptom_id_fkey" FOREIGN KEY (symptom_id) REFERENCES public.symptoms_catalog(id);

ALTER TABLE "public"."symptom_species"
  ADD CONSTRAINT "symptom_species_symptom_id_fkey" FOREIGN KEY (symptom_id) REFERENCES public.symptoms_catalog(id) ON DELETE CASCADE;

ALTER TABLE "public"."clinic_referrals"
  ADD CONSTRAINT "clinic_referrals_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES public.vet_clinics(id) ON DELETE CASCADE;

CREATE INDEX idx_ai_requests_by_user ON public.ai_analysis_requests USING btree (requested_by, created_at DESC);

CREATE INDEX idx_ai_requests_pet ON public.ai_analysis_requests USING btree (pet_id, created_at DESC);

CREATE INDEX idx_analytics_events_name ON public.analytics_events USING btree (event_name, created_at DESC);

CREATE INDEX idx_catalog_translations_lookup ON public.catalog_translations USING btree (entity_type, entity_id, LOCALE);

CREATE INDEX idx_co_owners_pet ON public.pet_co_owners USING btree (pet_id);

CREATE INDEX idx_co_owners_user ON public.pet_co_owners USING btree (user_id);

CREATE INDEX idx_daily_logs_logged_by ON public.daily_logs USING btree (logged_by);

CREATE INDEX idx_daily_logs_pet_date ON public.daily_logs USING btree (pet_id, log_date DESC);

CREATE INDEX idx_pets_owner ON public.pets USING btree (owner_id);

CREATE INDEX idx_pets_species ON public.pets USING btree (species_id);

CREATE INDEX idx_reminders_pet_due ON public.reminders USING btree (pet_id, due_at);

CREATE INDEX idx_reminders_status ON public.reminders USING btree (status);

CREATE INDEX idx_species_active ON public.species USING btree (is_active);

CREATE INDEX idx_species_parent ON public.species USING btree (parent_species_id);

CREATE INDEX idx_subscription_events_subscription ON public.subscription_events USING btree (subscription_id, occurred_at DESC);

CREATE UNIQUE INDEX idx_subscriptions_provider_sub_id ON public.subscriptions USING btree (provider_subscription_id)
  WHERE (provider_subscription_id IS NOT NULL);

CREATE UNIQUE INDEX idx_subscriptions_user ON public.subscriptions USING btree (user_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_validate_ai_request_photo_path
  BEFORE INSERT OR UPDATE ON public.ai_analysis_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_ai_request_photo_path();

CREATE TRIGGER trg_validate_symptom_species
  BEFORE INSERT ON public.ai_analysis_symptoms
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_symptom_species_compat();

CREATE TRIGGER set_timestamp_daily_logs
  BEFORE UPDATE ON public.daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER trg_daily_logs_last_edited_by
  BEFORE UPDATE ON public.daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_last_edited_by();

CREATE TRIGGER trg_daily_logs_streak
  AFTER INSERT OR DELETE OR UPDATE ON public.daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recompute_pet_streak_fn();

CREATE TRIGGER trg_protect_daily_log_audit
  BEFORE UPDATE ON public.daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_daily_log_audit_fields();

CREATE TRIGGER trg_validate_daily_log_date
  BEFORE INSERT OR UPDATE ON public.daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_daily_log_date();

CREATE TRIGGER set_timestamp_notification_preferences
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_pets
  BEFORE UPDATE ON public.pets
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER trg_protect_pet_structural_fields
  BEFORE UPDATE ON public.pets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_pet_structural_fields();

CREATE TRIGGER trg_validate_pet_birth_date
  BEFORE INSERT OR UPDATE ON public.pets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_pet_birth_date();

CREATE TRIGGER set_timestamp_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER trg_validate_profile_timezone
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_timezone();

CREATE TRIGGER set_timestamp_reminders
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER trg_protect_reminder_audit
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_reminder_audit_fields();

CREATE TRIGGER trg_sync_reminder_completion
  BEFORE INSERT OR UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_reminder_completion();

CREATE TRIGGER trg_validate_reminder_attachment_path
  BEFORE INSERT OR UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_reminder_attachment_path();

CREATE TRIGGER set_timestamp_species
  BEFORE UPDATE ON public.species
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_subscriptions
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE POLICY "achievements_catalog: select authenticated" ON "public"."achievements_catalog"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "ai_requests: select members" ON "public"."ai_analysis_requests"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(pet_id));

CREATE POLICY "ai_symptoms: select members" ON "public"."ai_analysis_symptoms"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.ai_analysis_requests r
  WHERE ((r.id = ai_analysis_symptoms.analysis_id) AND public.is_pet_member(r.pet_id)))));

CREATE POLICY "analytics_events: insert own" ON "public"."analytics_events"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "catalog_translations: select authenticated" ON "public"."catalog_translations"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "clinic_referrals: select own" ON "public"."clinic_referrals"
  FOR SELECT
  TO PUBLIC
  USING ((user_id = auth.uid()));

CREATE POLICY "daily_logs: delete editors" ON "public"."daily_logs"
  FOR DELETE
  TO PUBLIC
  USING (public.can_edit_pet(pet_id));

CREATE POLICY "daily_logs: insert editors" ON "public"."daily_logs"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.can_edit_pet(pet_id) AND (logged_by = auth.uid())));

CREATE POLICY "daily_logs: select members" ON "public"."daily_logs"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(pet_id));

CREATE POLICY "daily_logs: update editors" ON "public"."daily_logs"
  FOR UPDATE
  TO PUBLIC
  USING (public.can_edit_pet(pet_id));

CREATE POLICY "notif_prefs: manage own" ON "public"."notification_preferences"
  FOR ALL
  TO PUBLIC
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "pet_achievements: select members" ON "public"."pet_achievements"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(pet_id));

CREATE POLICY "co_owners: select members or self" ON "public"."pet_co_owners"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_pet_member(pet_id) OR (user_id = auth.uid())));

CREATE POLICY "shared_reports: select members" ON "public"."pet_shared_reports"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(pet_id));

CREATE POLICY "pet_streaks: select members" ON "public"."pet_streaks"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(pet_id));

CREATE POLICY "pets: delete owner" ON "public"."pets"
  FOR DELETE
  TO PUBLIC
  USING ((owner_id = auth.uid()));

CREATE POLICY "pets: insert own" ON "public"."pets"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((owner_id = auth.uid()));

CREATE POLICY "pets: select members" ON "public"."pets"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(id));

CREATE POLICY "pets: update editors" ON "public"."pets"
  FOR UPDATE
  TO PUBLIC
  USING (public.can_edit_pet(id));

CREATE POLICY "profiles: insert own" ON "public"."profiles"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "profiles: select own" ON "public"."profiles"
  FOR SELECT
  TO PUBLIC
  USING ((id = auth.uid()));

CREATE POLICY "profiles: update own" ON "public"."profiles"
  FOR UPDATE
  TO PUBLIC
  USING ((id = auth.uid()));

CREATE POLICY "push_tokens: manage own" ON "public"."push_tokens"
  FOR ALL
  TO PUBLIC
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "reminders: delete editors" ON "public"."reminders"
  FOR DELETE
  TO PUBLIC
  USING (public.can_edit_pet(pet_id));

CREATE POLICY "reminders: insert editors" ON "public"."reminders"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.can_edit_pet(pet_id) AND (created_by = auth.uid())));

CREATE POLICY "reminders: select members" ON "public"."reminders"
  FOR SELECT
  TO PUBLIC
  USING (public.is_pet_member(pet_id));

CREATE POLICY "reminders: update editors" ON "public"."reminders"
  FOR UPDATE
  TO PUBLIC
  USING (public.can_edit_pet(pet_id));

CREATE POLICY "species: select authenticated" ON "public"."species"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "subscription_events: select own" ON "public"."subscription_events"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.subscriptions s
  WHERE ((s.id = subscription_events.subscription_id) AND (s.user_id = auth.uid())))));

CREATE POLICY "subscriptions: select own" ON "public"."subscriptions"
  FOR SELECT
  TO PUBLIC
  USING ((user_id = auth.uid()));

CREATE POLICY "symptom_species: select authenticated" ON "public"."symptom_species"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "symptoms: select authenticated" ON "public"."symptoms_catalog"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "vet_clinics: select authenticated" ON "public"."vet_clinics"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "avatars: owner delete" ON "storage"."objects"
  FOR DELETE
  TO PUBLIC
  USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "avatars: owner insert" ON "storage"."objects"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "avatars: owner read" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "pet-photos: delete editors" ON "storage"."objects"
  FOR DELETE
  TO PUBLIC
  USING (((bucket_id = 'pet-photos'::text) AND public.can_edit_pet(public.safe_pet_id_from_path(name))));

CREATE POLICY "pet-photos: insert editors" ON "storage"."objects"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((bucket_id = 'pet-photos'::text) AND public.can_edit_pet(public.safe_pet_id_from_path(name))));

CREATE POLICY "pet-photos: select members" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'pet-photos'::text) AND public.is_pet_member(public.safe_pet_id_from_path(name))));

CREATE POLICY "reminder-attachments: delete editors" ON "storage"."objects"
  FOR DELETE
  TO PUBLIC
  USING (((bucket_id = 'reminder-attachments'::text) AND public.can_edit_pet(public.safe_pet_id_from_path(name))));

CREATE POLICY "reminder-attachments: insert editors" ON "storage"."objects"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((bucket_id = 'reminder-attachments'::text) AND public.can_edit_pet(public.safe_pet_id_from_path(name))));

CREATE POLICY "reminder-attachments: select members" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'reminder-attachments'::text) AND public.is_pet_member(public.safe_pet_id_from_path(name))));

CREATE POLICY "shared-reports: select members" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING (((bucket_id = 'shared-reports'::text) AND public.is_pet_member(public.safe_pet_id_from_path(name))));

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';

GRANT EXECUTE ON FUNCTION "public"."accept_pet_invitation"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."accept_pet_invitation"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."accept_pet_invitation"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."accept_pet_invitation"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."award_pet_achievement"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."award_pet_achievement"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."award_pet_achievement"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_edit_pet"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."can_edit_pet"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_edit_pet"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_edit_pet"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."change_pet_member_role"(uuid, public.co_owner_role) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."change_pet_member_role"(uuid, public.co_owner_role) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_pet_member_role"(uuid, public.co_owner_role) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_pet_member_role"(uuid, public.co_owner_role) TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_ai_analysis_for_processing"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_ai_analysis_for_processing"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_ai_analysis_for_processing"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_clinic_referral"(text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_clinic_referral"(text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_clinic_referral"(text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_clinic_referral"(text, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."decline_pet_invitation"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."decline_pet_invitation"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."decline_pet_invitation"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."decline_pet_invitation"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_ai_analysis_entitlement"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_ai_analysis_entitlement"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_ai_analysis_entitlement"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_ai_analysis_entitlement"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."invite_pet_member"(uuid, uuid, public.co_owner_role) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."invite_pet_member"(uuid, uuid, public.co_owner_role) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."invite_pet_member"(uuid, uuid, public.co_owner_role) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."invite_pet_member"(uuid, uuid, public.co_owner_role) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_pet_member"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_pet_member"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_pet_member"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_pet_member"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."owner_has_pets"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."owner_has_pets"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."owner_has_pets"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."owner_has_pets"() TO "service_role";

REVOKE ALL
  ON FUNCTION "public"."process_revenuecat_event"(text, uuid, text, public.subscription_plan, public.subscription_status, timestamp WITH time zone, timestamp
    WITH time zone, timestamp WITH time zone, boolean, text, text, jsonb)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."process_revenuecat_event"(text, uuid, text, public.subscription_plan, public.subscription_status, timestamp WITH time zone, timestamp
    WITH time zone, timestamp WITH time zone, boolean, text, text, jsonb)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."process_revenuecat_event"(text, uuid, text, public.subscription_plan, public.subscription_status, timestamp WITH time zone, timestamp
    WITH time zone, timestamp WITH time zone, boolean, text, text, jsonb)
  TO "service_role";

REVOKE ALL ON FUNCTION "public"."protect_daily_log_audit_fields"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_daily_log_audit_fields"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_daily_log_audit_fields"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."protect_pet_structural_fields"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_pet_structural_fields"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_pet_structural_fields"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."protect_reminder_audit_fields"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_reminder_audit_fields"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_reminder_audit_fields"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."recompute_pet_streak"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."recompute_pet_streak"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."recompute_pet_streak"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."register_push_token"(text, public.push_platform, text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."register_push_token"(text, public.push_platform, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."register_push_token"(text, public.push_platform, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."register_push_token"(text, public.push_platform, text, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."request_ai_analysis"(uuid, text, uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."request_ai_analysis"(uuid, text, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_ai_analysis"(uuid, text, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_ai_analysis"(uuid, text, uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."request_generate_report"(uuid, date, date) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."request_generate_report"(uuid, date, date) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_generate_report"(uuid, date, date) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."request_generate_report"(uuid, date, date) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_pet_invitation"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."revoke_pet_invitation"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_pet_invitation"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_pet_invitation"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."safe_pet_id_from_path"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."safe_pet_id_from_path"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."safe_pet_id_from_path"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_last_edited_by"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_last_edited_by"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_last_edited_by"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."submit_ai_feedback"(uuid, public.feedback_value, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_ai_feedback"(uuid, public.feedback_value, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."submit_ai_feedback"(uuid, public.feedback_value, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."submit_ai_feedback"(uuid, public.feedback_value, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."sync_reminder_completion"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_reminder_completion"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_reminder_completion"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."transfer_pet_ownership"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."transfer_pet_ownership"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."transfer_pet_ownership"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."transfer_pet_ownership"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."trg_recompute_pet_streak_fn"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."trg_recompute_pet_streak_fn"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."trg_recompute_pet_streak_fn"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."trigger_set_timestamp"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."trigger_set_timestamp"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."trigger_set_timestamp"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_ai_request_photo_path"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_ai_request_photo_path"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_ai_request_photo_path"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_daily_log_date"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_daily_log_date"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_daily_log_date"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_pet_birth_date"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_pet_birth_date"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_pet_birth_date"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_profile_timezone"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_profile_timezone"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_profile_timezone"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_reminder_attachment_path"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_reminder_attachment_path"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_reminder_attachment_path"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_symptom_species_compat"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_symptom_species_compat"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_symptom_species_compat"() TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."achievements_catalog" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."achievements_catalog" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."achievements_catalog" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."achievements_catalog" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_analysis_requests" TO "anon";

REVOKE ALL ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

REVOKE ALL ("created_at") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("created_at") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("feedback_comment") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("feedback_comment") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("feedback") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("feedback") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("pet_id") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("pet_id") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("photo_path") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("photo_path") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("possible_causes") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("possible_causes") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("recommendations") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("recommendations") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("requested_by") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("requested_by") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("status") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("urgency_level") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("urgency_level") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ("used_full_history") ON TABLE "public"."ai_analysis_requests" FROM "authenticated";

GRANT SELECT ("used_full_history") ON TABLE "public"."ai_analysis_requests" TO "authenticated";

GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."ai_analysis_requests" TO "authenticated";

REVOKE ALL ON TABLE "public"."ai_analysis_requests" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_analysis_requests" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_analysis_requests" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_analysis_symptoms" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."ai_analysis_symptoms" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_analysis_symptoms" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_analysis_symptoms" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."analytics_events" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."analytics_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."analytics_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."analytics_events" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."catalog_translations" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."catalog_translations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."catalog_translations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."catalog_translations" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clinic_referrals" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."clinic_referrals" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clinic_referrals" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clinic_referrals" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."daily_logs" TO "anon";

REVOKE ALL ON TABLE "public"."daily_logs" FROM "authenticated";

REVOKE ALL ("activity_level") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("activity_level"), UPDATE ("activity_level") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("appetite_level") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("appetite_level"), UPDATE ("appetite_level") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("energy_level") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("energy_level"), UPDATE ("energy_level") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("log_date") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("log_date"), UPDATE ("log_date") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("logged_by") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("logged_by") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("mood_level") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("mood_level"), UPDATE ("mood_level") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("notes") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("notes"), UPDATE ("notes") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("pet_id") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("pet_id") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("sleep_quality") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("sleep_quality"), UPDATE ("sleep_quality") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("social_interaction_level") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("social_interaction_level"), UPDATE ("social_interaction_level") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("tags") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("tags"), UPDATE ("tags") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("unusual_behavior_notes") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("unusual_behavior_notes"), UPDATE ("unusual_behavior_notes") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("unusual_behavior") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("unusual_behavior"), UPDATE ("unusual_behavior") ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ("vocalization_level") ON TABLE "public"."daily_logs" FROM "authenticated";

GRANT INSERT ("vocalization_level"), UPDATE ("vocalization_level") ON TABLE "public"."daily_logs" TO "authenticated";

GRANT DELETE, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."daily_logs" TO "authenticated";

REVOKE ALL ON TABLE "public"."daily_logs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."daily_logs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."daily_logs" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_preferences" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."notification_preferences" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_preferences" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_preferences" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_achievements" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."pet_achievements" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_achievements" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_achievements" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_co_owners" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."pet_co_owners" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_co_owners" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_co_owners" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_shared_reports" TO "anon";

REVOKE ALL ON TABLE "public"."pet_shared_reports" FROM "authenticated";

GRANT DELETE, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_shared_reports" TO "authenticated";

REVOKE ALL ON TABLE "public"."pet_shared_reports" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_shared_reports" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_shared_reports" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_streaks" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."pet_streaks" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_streaks" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pet_streaks" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pets" TO "anon";

REVOKE ALL ON TABLE "public"."pets" FROM "authenticated";

REVOKE ALL ("allergies") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("allergies"), UPDATE ("allergies") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("birth_date") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("birth_date"), UPDATE ("birth_date") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("breed") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("breed"), UPDATE ("breed") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("is_active") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("is_active"), UPDATE ("is_active") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("known_conditions") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("known_conditions"), UPDATE ("known_conditions") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("name"), UPDATE ("name") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("owner_id") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("owner_id") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("photo_path") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("photo_path"), UPDATE ("photo_path") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("sex") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("sex"), UPDATE ("sex") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("species_id") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("species_id"), UPDATE ("species_id") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("sterilized") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("sterilized"), UPDATE ("sterilized") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("temperament_notes") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("temperament_notes"), UPDATE ("temperament_notes") ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ("weight_kg") ON TABLE "public"."pets" FROM "authenticated";

GRANT INSERT ("weight_kg"), UPDATE ("weight_kg") ON TABLE "public"."pets" TO "authenticated";

GRANT DELETE, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."pets" TO "authenticated";

REVOKE ALL ON TABLE "public"."pets" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pets" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pets" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

REVOKE ALL ("avatar_path") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("avatar_path") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("disclaimer_accepted_at") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("disclaimer_accepted_at") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("disclaimer_version") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("disclaimer_version") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("external_avatar_url") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("external_avatar_url") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("full_name") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("full_name") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("locale") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("locale") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("marketing_opt_in") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("marketing_opt_in") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("onboarding_completed_at") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("onboarding_completed_at") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("phone") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("phone") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("timezone") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("timezone") ON TABLE "public"."profiles" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_tokens" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."push_tokens" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_tokens" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_tokens" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reminders" TO "anon";

REVOKE ALL ON TABLE "public"."reminders" FROM "authenticated";

REVOKE ALL ("attachment_path") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("attachment_path"), UPDATE ("attachment_path") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("completed_at") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("completed_at"), UPDATE ("completed_at") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("created_by") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("created_by") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("description") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("description"), UPDATE ("description") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("due_at") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("due_at"), UPDATE ("due_at") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("pet_id") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("pet_id") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("recurrence_rule") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("recurrence_rule"), UPDATE ("recurrence_rule") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("snooze_until") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("snooze_until"), UPDATE ("snooze_until") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("status"), UPDATE ("status") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("title") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("title"), UPDATE ("title") ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ("type") ON TABLE "public"."reminders" FROM "authenticated";

GRANT INSERT ("type"), UPDATE ("type") ON TABLE "public"."reminders" TO "authenticated";

GRANT DELETE, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."reminders" TO "authenticated";

REVOKE ALL ON TABLE "public"."reminders" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reminders" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reminders" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."species" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."species" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."species" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."species" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscription_events" TO "anon";

REVOKE ALL ON TABLE "public"."subscription_events" FROM "authenticated";

REVOKE ALL ("event_type") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("event_type") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("new_plan") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("new_plan") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("new_status") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("new_status") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("occurred_at") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("occurred_at") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("previous_plan") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("previous_plan") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("previous_status") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("previous_status") ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ("subscription_id") ON TABLE "public"."subscription_events" FROM "authenticated";

GRANT SELECT ("subscription_id") ON TABLE "public"."subscription_events" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscription_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."subscription_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscription_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscription_events" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscriptions" TO "anon";

REVOKE ALL ON TABLE "public"."subscriptions" FROM "authenticated";

REVOKE ALL ("cancel_at_period_end") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("cancel_at_period_end") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("created_at") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("created_at") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("current_period_end") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("current_period_end") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("current_period_start") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("current_period_start") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("plan") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("plan") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("provider_subscription_id") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("provider_subscription_id") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("provider") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("provider") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("status") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("trial_end") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("trial_end") ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ("user_id") ON TABLE "public"."subscriptions" FROM "authenticated";

GRANT SELECT ("user_id") ON TABLE "public"."subscriptions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscriptions" TO "authenticated";

REVOKE ALL ON TABLE "public"."subscriptions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscriptions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscriptions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptom_species" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."symptom_species" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptom_species" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptom_species" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptoms_catalog" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."symptoms_catalog" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptoms_catalog" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptoms_catalog" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."vet_clinics" TO "anon";

REVOKE ALL ON TABLE "public"."vet_clinics" FROM "authenticated";

REVOKE ALL ("city") ON TABLE "public"."vet_clinics" FROM "authenticated";

GRANT SELECT ("city") ON TABLE "public"."vet_clinics" TO "authenticated";

REVOKE ALL ("country") ON TABLE "public"."vet_clinics" FROM "authenticated";

GRANT SELECT ("country") ON TABLE "public"."vet_clinics" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."vet_clinics" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."vet_clinics" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."vet_clinics" FROM "authenticated";

GRANT SELECT ("name") ON TABLE "public"."vet_clinics" TO "authenticated";

REVOKE ALL ("referral_code") ON TABLE "public"."vet_clinics" FROM "authenticated";

GRANT SELECT ("referral_code") ON TABLE "public"."vet_clinics" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."vet_clinics" TO "authenticated";

REVOKE ALL ON TABLE "public"."vet_clinics" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."vet_clinics" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."vet_clinics" TO "service_role";

