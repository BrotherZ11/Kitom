// =====================================================================
// KITOM · Edge Function ai-analysis-process
// =====================================================================
// Procesa un análisis creado con request_ai_analysis(): llama al proveedor
// de IA y guarda el resultado. Contrato: docs/README.md §8–§11 y
// docs/FRONTEND_ARCHITECTURE.md «AIAnalysisScreen».
//
// Orden de seguridad obligatorio (no confía en la RPC anterior):
//  1. Valida el JWT de la cabecera Authorization.
//  2. Toma el usuario de ESE JWT (nunca del body).
//  3. Valida los parámetros (analysis_id).
//  4. Reautoriza contra la BD: requested_by = usuario.
//  5. Solo entonces usa service_role: reclama el análisis de forma atómica
//     (claim_ai_analysis_for_processing), lee el contexto, llama a la IA y
//     guarda el resultado. Un fallo deja status = 'failed' (no gasta cupo).
//  Toda escritura de estado exige status = 'processing' (SEC-16): con dos
//  invocaciones solapadas, ninguna pisa el resultado de la otra. La
//  caducidad de 'processing' se cuenta desde el reclamo
//  (processing_started_at, migración 20261030090318: desplegar la función
//  después de aplicarla, porque la lee).
//
// Cuerpo: { analysis_id, locale? } (locale 'es' | 'en': idioma de la respuesta;
// por defecto, español). Lee las columnas de *_ai_guidance_v2.sql (contexto del
// tutor y resultado ampliado): desplegarla después de aplicar esa migración.
//
// Variables (supabase secrets set, las pone el usuario): GEMINI_API_KEY y,
// opcionales, GEMINI_MODEL (por defecto DEFAULT_GEMINI_MODEL),
// GEMINI_FALLBACK_MODEL (modelo de respaldo ante 429/503 del plan gratuito), AI_PROVIDER
// (gemini | openai | mock; mock solo en local; openai usa OPENAI_API_KEY y
// OPENAI_MODEL), AI_INPUT_USD_PER_MTOK y AI_OUTPUT_USD_PER_MTOK (para
// cost_usd). SUPABASE_URL,
// SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las da la plataforma.
// =====================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import {
  ageInMonths,
  buildSystemPrompt,
  buildUserPrompt,
  daysBetween,
  describeSpeciesData,
  estimateCostUsd,
  finalizeGuidance,
  isStaleProcessing,
  isSymptomOnset,
  isSymptomTrend,
  isUuid,
  minimumUrgency,
  parseGuidance,
  PROMPT_VERSION,
  toGuidanceLocale,
  URGENCY_LEVELS,
  type DailyLogContext,
  type GuidanceLocale,
  type HealthReminderContext,
  type PreviousConsultContext,
  type SpeciesFieldMeta,
  type UrgencyLevel,
} from './guidance.ts';

/** Nombre en español de cada especie del catálogo (`species.code`) para el contexto del modelo. */
const SPECIES_NAMES_ES: Record<string, string> = {
  dog: 'perro',
  cat: 'gato',
  rabbit: 'conejo',
  guinea_pig: 'cobaya',
  hamster: 'hámster',
  horse: 'caballo',
  bird_other: 'ave',
  reptile_other: 'reptil',
  other: 'otra especie',
};
import { ProviderError, providerFromEnv } from './providers.ts';

const PHOTO_BUCKET = 'pet-photos';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const BASIC_LOG_DAYS = 7;
const FULL_HISTORY_LOG_DAYS = 30;
/** Recordatorios de salud de los últimos 30 días y los próximos 14 (vacunas, medicación…). */
const REMINDER_PAST_DAYS = 30;
const REMINDER_NEXT_DAYS = 14;
const MAX_REMINDERS = 8;
/** Consultas anteriores de la mascota que se dan como contexto. */
const PREVIOUS_CONSULT_DAYS = 90;
const MAX_PREVIOUS_CONSULTS = 3;
const HEALTH_REMINDER_TYPES = ['vaccine', 'medication', 'deworming', 'appointment'] as const;
const DAY_MS = 86_400_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

function numberEnv(name: string): number | null {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

type AnalysisRow = {
  id: string;
  pet_id: string;
  requested_by: string | null;
  photo_path: string | null;
  used_full_history: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  processing_started_at: string | null;
  user_context: string | null;
  symptom_onset: string | null;
  symptom_trend: string | null;
};

/**
 * Pasa a `failed` solo si sigue en `processing` (nunca pisa un resultado ya guardado ni un fallo
 * anterior). Devuelve si lo cambió.
 */
async function markFailed(admin: SupabaseClient, analysisId: string, code: string): Promise<boolean> {
  const { data, error } = await admin
    .from('ai_analysis_requests')
    .update({ status: 'failed', error_message: code })
    .eq('id', analysisId)
    .eq('status', 'processing')
    .select('id');
  return !error && (data?.length ?? 0) > 0;
}

/** Contexto para el modelo: perfil sin nombres, señales, registros recientes y la foto (si la hay). */
async function loadContext(admin: SupabaseClient, analysis: AnalysisRow, locale: GuidanceLocale) {
  const { data: pet, error: petError } = await admin
    .from('pets')
    .select('birth_date, sex, sterilized, weight_kg, breed, breed_id, species_id, known_conditions, allergies, temperament_notes, species_data')
    .eq('id', analysis.pet_id)
    .single();
  if (petError || !pet) throw new Error('context_pet');
  // Especie y raza por separado: breed_id forma parte de una FK compuesta (breed_id, species_id),
  // que PostgREST no puede embeber por una sola columna.
  const { data: speciesRow } = await admin.from('species').select('code').eq('id', pet.species_id).maybeSingle();
  const { data: breedRow } = pet.breed_id
    ? await admin.from('breeds').select('code').eq('id', pet.breed_id).maybeSingle()
    : { data: null };
  // Tipo y unidad de los campos de su especie (`species_fields`), para escribir sus datos propios.
  const { data: fieldRows } = await admin
    .from('species_fields')
    .select('code, scope, kind, unit, position')
    .eq('species_id', pet.species_id)
    .neq('kind', 'core')
    .order('position');
  const metaFor = (scope: 'profile' | 'daily'): SpeciesFieldMeta =>
    Object.fromEntries(
      (fieldRows ?? [])
        .filter((row) => row.scope === scope)
        .map((row) => [row.code as string, { kind: row.kind as string, unit: (row.unit as string | null) ?? null }])
    );
  const profileMeta = metaFor('profile');
  const dailyMeta = metaFor('daily');

  const { data: symptoms, error: symptomsError } = await admin
    .from('ai_analysis_symptoms')
    .select('symptom:symptom_id(id, code)')
    .eq('analysis_id', analysis.id);
  if (symptomsError) throw new Error('context_symptoms');
  const symptomRows = (symptoms ?? [])
    .map((row) => (row as unknown as { symptom: { id: string; code: string } | null }).symptom)
    .filter((symptom): symptom is { id: string; code: string } => symptom !== null);

  // Nombres de las señales en el idioma de la respuesta (también los de las consultas anteriores).
  const { data: labels } = await admin
    .from('catalog_translations')
    .select('entity_id, value')
    .eq('entity_type', 'symptom')
    .eq('field', 'label')
    .eq('locale', locale);
  const labelById = new Map((labels ?? []).map((row) => [row.entity_id as string, row.value as string]));

  const days = analysis.used_full_history ? FULL_HISTORY_LOG_DAYS : BASIC_LOG_DAYS;
  const { data: logs, error: logsError } = await admin
    .from('daily_logs')
    .select(
      'log_date, energy_level, appetite_level, mood_level, activity_level, sleep_quality, vocalization_level, social_interaction_level, unusual_behavior, unusual_behavior_notes, notes, tags, species_data'
    )
    .eq('pet_id', analysis.pet_id)
    .order('log_date', { ascending: false })
    .limit(days);
  if (logsError) throw new Error('context_logs');

  let imageDataUrl: string | null = null;
  if (analysis.photo_path) {
    const { data: blob, error: photoError } = await admin.storage.from(PHOTO_BUCKET).download(analysis.photo_path);
    if (photoError || !blob) throw new Error('context_photo');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('context_photo_size');
    imageDataUrl = `data:image/jpeg;base64,${encodeBase64(bytes)}`;
  }

  const today = new Date().toISOString().slice(0, 10);

  // Recordatorios de salud recientes o próximos: una vacuna de hace dos días o una medicación activa
  // cambian la orientación. Solo tipo, título, cuándo y si se hizo. Un fallo aquí no para la consulta.
  const { data: reminderRows } = await admin
    .from('reminders')
    .select('type, title, due_at, status, recurrence_rule')
    .eq('pet_id', analysis.pet_id)
    .eq('is_active', true)
    .in('type', [...HEALTH_REMINDER_TYPES])
    .gte('due_at', new Date(Date.now() - REMINDER_PAST_DAYS * DAY_MS).toISOString())
    .lte('due_at', new Date(Date.now() + REMINDER_NEXT_DAYS * DAY_MS).toISOString())
    .order('due_at', { ascending: false })
    .limit(MAX_REMINDERS);
  const reminders: HealthReminderContext[] = (reminderRows ?? []).flatMap((row) => {
    const days = daysBetween(today, String(row.due_at));
    if (days === null || row.status === 'skipped') return [];
    return [
      {
        type: row.type as HealthReminderContext['type'],
        title: String(row.title ?? ''),
        daysFromToday: days,
        completed: row.status === 'completed',
        recurring: Boolean(row.recurrence_rule),
      },
    ];
  });

  // Consultas anteriores completadas de la mascota (continuidad: «la semana pasada ya cojeaba»).
  const { data: previousRows } = await admin
    .from('ai_analysis_requests')
    .select('id, created_at, urgency_level, summary')
    .eq('pet_id', analysis.pet_id)
    .eq('status', 'completed')
    .neq('id', analysis.id)
    .gte('created_at', new Date(Date.now() - PREVIOUS_CONSULT_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(MAX_PREVIOUS_CONSULTS);
  const previousIds = (previousRows ?? []).map((row) => row.id as string);
  const { data: previousSymptoms } = previousIds.length
    ? await admin.from('ai_analysis_symptoms').select('analysis_id, symptom_id').in('analysis_id', previousIds)
    : { data: [] as { analysis_id: string; symptom_id: string }[] };
  const previousConsults: PreviousConsultContext[] = (previousRows ?? [])
    .filter((row) => (URGENCY_LEVELS as readonly string[]).includes(String(row.urgency_level)))
    .map((row) => ({
      date: String(row.created_at).slice(0, 10),
      urgency: row.urgency_level as UrgencyLevel,
      symptoms: (previousSymptoms ?? [])
        .filter((item) => item.analysis_id === row.id)
        .map((item) => labelById.get(item.symptom_id as string))
        .filter((label): label is string => Boolean(label)),
      summary: (row.summary as string | null) ?? null,
    }));

  const species = (speciesRow?.code as string | undefined) ?? 'other';
  const breedCode = (breedRow?.code as string | undefined) ?? null;
  const dailyLogs: DailyLogContext[] = (logs ?? []).map((log) => ({
    date: log.log_date as string,
    energy: log.energy_level as number | null,
    appetite: log.appetite_level as number | null,
    mood: log.mood_level as number | null,
    activity: log.activity_level as number | null,
    sleep: log.sleep_quality as number | null,
    vocalization: log.vocalization_level as number | null,
    social: log.social_interaction_level as number | null,
    unusualBehavior: Boolean(log.unusual_behavior),
    unusualNotes: (log.unusual_behavior_notes as string | null) ?? null,
    notes: (log.notes as string | null) ?? null,
    tags: (log.tags as string[] | null) ?? [],
    speciesDetails: describeSpeciesData(log.species_data, dailyMeta),
  }));
  const symptomCodes = symptomRows.map((s) => s.code);

  return {
    speciesCode: species,
    symptomCodes,
    imageDataUrl,
    system: buildSystemPrompt(locale, species),
    user: buildUserPrompt({
      pet: {
        species: SPECIES_NAMES_ES[species] ?? species,
        ageMonths: ageInMonths(pet.birth_date as string | null, today),
        sex: (pet.sex as string | null) ?? null,
        sterilized: (pet.sterilized as boolean | null) ?? null,
        weightKg: pet.weight_kg === null ? null : Number(pet.weight_kg),
        breed: breedCode ? breedCode.replace(/_/g, ' ') : ((pet.breed as string | null) ?? null),
        knownConditions: (pet.known_conditions as string[] | null) ?? [],
        allergies: (pet.allergies as string[] | null) ?? [],
        temperament: (pet.temperament_notes as string | null) ?? null,
        speciesDetails: describeSpeciesData(pet.species_data, profileMeta),
      },
      symptoms: symptomRows.map((s) => labelById.get(s.id) ?? s.code),
      logs: dailyLogs.reverse(),
      hasPhoto: imageDataUrl !== null,
      minimumLevel: minimumUrgency(symptomCodes, species),
      userContext: analysis.user_context,
      onset: isSymptomOnset(analysis.symptom_onset) ? analysis.symptom_onset : null,
      trend: isSymptomTrend(analysis.symptom_trend) ? analysis.symptom_trend : null,
      reminders,
      previousConsults,
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // 1–2. JWT y usuario (de la cabecera, nunca del body).
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  if (!token) return json(401, { error: 'not_authenticated' });

  let supabaseUrl: string;
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  try {
    supabaseUrl = env('SUPABASE_URL');
    anon = createClient(supabaseUrl, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
    admin = createClient(supabaseUrl, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  } catch {
    return json(500, { error: 'server_misconfigured' });
  }
  const { data: userData, error: userError } = await anon.auth.getUser(token);
  if (userError || !userData?.user) return json(401, { error: 'not_authenticated' });
  const userId = userData.user.id;

  // 3. Parámetros.
  let analysisId: unknown;
  let locale: GuidanceLocale = 'es';
  try {
    const body = await req.json();
    analysisId = body?.analysis_id;
    // Idioma de la respuesta (el de la app); cualquier otro valor, español.
    locale = toGuidanceLocale(body?.locale);
  } catch {
    analysisId = null;
  }
  if (!isUuid(analysisId)) return json(400, { error: 'invalid_request' });

  // 4. Reautorización: solo quien lo pidió.
  const { data: row, error: rowError } = await admin
    .from('ai_analysis_requests')
    .select(
      'id, pet_id, requested_by, photo_path, used_full_history, status, created_at, processing_started_at, user_context, symptom_onset, symptom_trend'
    )
    .eq('id', analysisId)
    .maybeSingle();
  if (rowError) return json(500, { error: 'server_error' });
  if (!row) return json(404, { error: 'not_found' });
  const analysis = row as AnalysisRow;
  if (analysis.requested_by !== userId) return json(403, { error: 'not_authorized' });

  if (analysis.status === 'completed' || analysis.status === 'failed') {
    return json(200, { status: 'already_processing_or_done' });
  }
  if (analysis.status === 'processing') {
    // Una invocación anterior se cortó a medias: se da por fallido (no gasta cupo) para poder repetir.
    // Si entretanto terminó (la escritura condicionada no cambia nada), no se toca.
    if (isStaleProcessing(analysis, Date.now())) {
      const failed = await markFailed(admin, analysis.id, 'timeout');
      return failed
        ? json(200, { status: 'failed', error: 'timeout' })
        : json(200, { status: 'already_processing_or_done' });
    }
    return json(200, { status: 'already_processing_or_done' });
  }

  // 5. Reclamar de forma atómica (pending -> processing): como mucho una invocación sigue.
  const { data: claimed, error: claimError } = await admin.rpc('claim_ai_analysis_for_processing', {
    target_analysis_id: analysis.id,
  });
  if (claimError) return json(500, { error: 'server_error' });
  if (!claimed) return json(200, { status: 'already_processing_or_done' });

  const started = Date.now();
  try {
    const provider = providerFromEnv(Deno.env);
    const context = await loadContext(admin, analysis, locale);
    const response = await provider({
      system: context.system,
      user: context.user,
      imageDataUrl: context.imageDataUrl,
      symptomCodes: context.symptomCodes,
    });
    const parsed = parseGuidance(response.output, { hasPhoto: context.imageDataUrl !== null });
    if (!parsed.ok) {
      const { data: failedRows } = await admin
        .from('ai_analysis_requests')
        .update({
          status: 'failed',
          error_message: parsed.reason,
          ai_provider: response.provider,
          ai_model: response.model,
          prompt_version: PROMPT_VERSION,
          response_raw: response.raw,
          latency_ms: Date.now() - started,
        })
        .eq('id', analysis.id)
        .eq('status', 'processing')
        .select('id');
      return (failedRows?.length ?? 0) > 0
        ? json(200, { status: 'failed', error: 'ai_unavailable' })
        : json(200, { status: 'already_processing_or_done' });
    }
    const guidance = finalizeGuidance(parsed.guidance, context.symptomCodes, context.speciesCode, locale);
    const { data: savedRows, error: saveError } = await admin
      .from('ai_analysis_requests')
      .update({
        status: 'completed',
        urgency_level: guidance.urgencyLevel,
        summary: guidance.summary,
        possible_causes: guidance.possibleCauses,
        recommendations: guidance.recommendations,
        warning_signs: guidance.warningSigns,
        vet_questions: guidance.vetQuestions,
        photo_observations: guidance.photoObservations,
        response_raw: response.raw,
        ai_provider: response.provider,
        ai_model: response.model,
        prompt_version: PROMPT_VERSION,
        cost_usd: estimateCostUsd(response.usage, {
          inputPerMillion: numberEnv('AI_INPUT_USD_PER_MTOK'),
          outputPerMillion: numberEnv('AI_OUTPUT_USD_PER_MTOK'),
        }),
        latency_ms: Date.now() - started,
        error_message: null,
      })
      .eq('id', analysis.id)
      .eq('status', 'processing')
      .select('id');
    if (saveError) throw new Error('save_failed');
    // Otra invocación lo dio por caducado mientras tanto: su estado se respeta (la app lo vuelve a leer).
    if ((savedRows?.length ?? 0) === 0) return json(200, { status: 'already_processing_or_done' });
    return json(200, { status: 'completed' });
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'ai_unavailable';
    // Detalle solo en los logs de la función (sin datos de la mascota ni la clave).
    console.error('[ai-analysis-process]', analysis.id, error instanceof Error ? error.message : 'unknown');
    const failed = await markFailed(admin, analysis.id, code === 'ai_misconfigured' ? 'ai_misconfigured' : 'ai_unavailable');
    return failed
      ? json(200, { status: 'failed', error: 'ai_unavailable' })
      : json(200, { status: 'already_processing_or_done' });
  }
});
