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
//
// Variables (supabase secrets set, las pone el usuario): GEMINI_API_KEY y,
// opcionales, GEMINI_MODEL (por defecto DEFAULT_GEMINI_MODEL), AI_PROVIDER
// (gemini | openai | mock; mock solo en local; openai usa OPENAI_API_KEY y
// OPENAI_MODEL), AI_INPUT_USD_PER_MTOK y AI_OUTPUT_USD_PER_MTOK (para
// cost_usd). SUPABASE_URL,
// SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las da la plataforma.
// =====================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import {
  ageInMonths,
  buildUserPrompt,
  estimateCostUsd,
  finalizeGuidance,
  isUuid,
  minimumUrgency,
  parseGuidance,
  PROMPT_VERSION,
  STALE_PROCESSING_MS,
  SYSTEM_PROMPT,
  type DailyLogContext,
} from './guidance.ts';
import { ProviderError, providerFromEnv } from './providers.ts';

const PHOTO_BUCKET = 'pet-photos';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const BASIC_LOG_DAYS = 7;
const FULL_HISTORY_LOG_DAYS = 30;

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
};

async function markFailed(admin: SupabaseClient, analysisId: string, code: string) {
  await admin.from('ai_analysis_requests').update({ status: 'failed', error_message: code }).eq('id', analysisId);
}

/** Contexto para el modelo: perfil sin nombres, señales, registros recientes y la foto (si la hay). */
async function loadContext(admin: SupabaseClient, analysis: AnalysisRow) {
  const { data: pet, error: petError } = await admin
    .from('pets')
    .select('birth_date, sex, sterilized, weight_kg, breed, breed_id, species_id, known_conditions, allergies')
    .eq('id', analysis.pet_id)
    .single();
  if (petError || !pet) throw new Error('context_pet');
  // Especie y raza por separado: breed_id forma parte de una FK compuesta (breed_id, species_id),
  // que PostgREST no puede embeber por una sola columna.
  const { data: speciesRow } = await admin.from('species').select('code').eq('id', pet.species_id).maybeSingle();
  const { data: breedRow } = pet.breed_id
    ? await admin.from('breeds').select('code').eq('id', pet.breed_id).maybeSingle()
    : { data: null };

  const { data: symptoms, error: symptomsError } = await admin
    .from('ai_analysis_symptoms')
    .select('symptom:symptom_id(id, code)')
    .eq('analysis_id', analysis.id);
  if (symptomsError) throw new Error('context_symptoms');
  const symptomRows = (symptoms ?? [])
    .map((row) => (row as unknown as { symptom: { id: string; code: string } | null }).symptom)
    .filter((symptom): symptom is { id: string; code: string } => symptom !== null);

  const { data: labels } = await admin
    .from('catalog_translations')
    .select('entity_id, value')
    .eq('entity_type', 'symptom')
    .eq('field', 'label')
    .eq('locale', 'es')
    .in('entity_id', symptomRows.length ? symptomRows.map((s) => s.id) : ['00000000-0000-0000-0000-000000000000']);
  const labelById = new Map((labels ?? []).map((row) => [row.entity_id as string, row.value as string]));

  const days = analysis.used_full_history ? FULL_HISTORY_LOG_DAYS : BASIC_LOG_DAYS;
  const { data: logs, error: logsError } = await admin
    .from('daily_logs')
    .select('log_date, energy_level, appetite_level, mood_level, activity_level, unusual_behavior, unusual_behavior_notes, tags')
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

  const species = (speciesRow?.code as string | undefined) ?? 'desconocida';
  const breedCode = (breedRow?.code as string | undefined) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const dailyLogs: DailyLogContext[] = (logs ?? []).map((log) => ({
    date: log.log_date as string,
    energy: log.energy_level as number | null,
    appetite: log.appetite_level as number | null,
    mood: log.mood_level as number | null,
    activity: log.activity_level as number | null,
    unusualBehavior: Boolean(log.unusual_behavior),
    unusualNotes: (log.unusual_behavior_notes as string | null) ?? null,
    tags: (log.tags as string[] | null) ?? [],
  }));

  return {
    symptomCodes: symptomRows.map((s) => s.code),
    imageDataUrl,
    user: buildUserPrompt({
      pet: {
        species: species === 'dog' ? 'perro' : species === 'cat' ? 'gato' : species,
        ageMonths: ageInMonths(pet.birth_date as string | null, today),
        sex: (pet.sex as string | null) ?? null,
        sterilized: (pet.sterilized as boolean | null) ?? null,
        weightKg: pet.weight_kg === null ? null : Number(pet.weight_kg),
        breed: breedCode ? breedCode.replace(/_/g, ' ') : ((pet.breed as string | null) ?? null),
        knownConditions: (pet.known_conditions as string[] | null) ?? [],
        allergies: (pet.allergies as string[] | null) ?? [],
      },
      symptoms: symptomRows.map((s) => labelById.get(s.id) ?? s.code),
      logs: dailyLogs.reverse(),
      hasPhoto: imageDataUrl !== null,
      minimumLevel: minimumUrgency(symptomRows.map((s) => s.code)),
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
  try {
    analysisId = (await req.json())?.analysis_id;
  } catch {
    analysisId = null;
  }
  if (!isUuid(analysisId)) return json(400, { error: 'invalid_request' });

  // 4. Reautorización: solo quien lo pidió.
  const { data: row, error: rowError } = await admin
    .from('ai_analysis_requests')
    .select('id, pet_id, requested_by, photo_path, used_full_history, status, created_at')
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
    if (Date.now() - new Date(analysis.created_at).getTime() > STALE_PROCESSING_MS) {
      await markFailed(admin, analysis.id, 'timeout');
      return json(200, { status: 'failed', error: 'timeout' });
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
    const context = await loadContext(admin, analysis);
    const response = await provider({
      system: SYSTEM_PROMPT,
      user: context.user,
      imageDataUrl: context.imageDataUrl,
      symptomCodes: context.symptomCodes,
    });
    const parsed = parseGuidance(response.output);
    if (!parsed.ok) {
      await admin
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
        .eq('id', analysis.id);
      return json(200, { status: 'failed', error: 'ai_unavailable' });
    }
    const guidance = finalizeGuidance(parsed.guidance, context.symptomCodes);
    const { error: saveError } = await admin
      .from('ai_analysis_requests')
      .update({
        status: 'completed',
        urgency_level: guidance.urgencyLevel,
        possible_causes: guidance.possibleCauses,
        recommendations: guidance.recommendations,
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
      .eq('id', analysis.id);
    if (saveError) throw new Error('save_failed');
    return json(200, { status: 'completed' });
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'ai_unavailable';
    // Detalle solo en los logs de la función (sin datos de la mascota ni la clave).
    console.error('[ai-analysis-process]', analysis.id, error instanceof Error ? error.message : 'unknown');
    await markFailed(admin, analysis.id, code === 'ai_misconfigured' ? 'ai_misconfigured' : 'ai_unavailable');
    return json(200, { status: 'failed', error: 'ai_unavailable' });
  }
});
