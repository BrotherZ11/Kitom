import { ANALYSIS_COLUMNS, toEntitlement, type Analysis, type Entitlement } from '@/features/ai-analysis/ai-analysis-model';
import { buildPetPhotoPath, PET_PHOTOS_BUCKET, type PreparedPetPhoto } from '@/features/pets/pet-photo';
import type { Locale } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Enums } from '@/types/database.types';

/**
 * Orientación con IA. El cliente nunca escribe en `ai_analysis_requests`: pide con
 * `request_ai_analysis`, invoca `ai-analysis-process` (que se autoriza de nuevo) y lee las columnas
 * públicas. RLS (`is_pet_member`) decide qué análisis se ven; el feedback solo lo puede dar quien pidió.
 */

export async function fetchEntitlement(): Promise<Entitlement> {
  const { data, error } = await supabase.rpc('get_ai_analysis_entitlement');
  if (error) throw error;
  return toEntitlement(data?.[0]);
}

export type Symptom = { id: string; code: string; label: string };

/** Señales compatibles con la especie (`symptom_species`) con su nombre traducido. */
export async function fetchSymptoms(speciesId: string, locale: Locale): Promise<Symptom[]> {
  const [links, labels] = await Promise.all([
    supabase.from('symptom_species').select('symptom:symptom_id(id, code)').eq('species_id', speciesId),
    supabase
      .from('catalog_translations')
      .select('entity_id, value')
      .eq('entity_type', 'symptom')
      .eq('field', 'label')
      .eq('locale', locale),
  ]);
  if (links.error) throw links.error;
  if (labels.error) throw labels.error;
  const names = new Map(labels.data.map((row) => [row.entity_id, row.value]));
  return links.data
    .map((row) => row.symptom)
    .filter((symptom): symptom is { id: string; code: string } => symptom !== null)
    .map((symptom) => ({ ...symptom, label: names.get(symptom.id) ?? symptom.code }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** Sube la foto de la consulta (`pet-photos/{pet_id}/{uuid}.jpg`; Storage exige `can_edit_pet`). */
export async function uploadConsultPhoto(petId: string, photo: PreparedPetPhoto): Promise<string> {
  const path = buildPetPhotoPath(petId);
  const { error } = await supabase.storage
    .from(PET_PHOTOS_BUCKET)
    .upload(path, photo.bytes, { contentType: photo.mimeType, upsert: false });
  if (error) throw error;
  return path;
}

/** Crea la solicitud (valida acceso, especie, señales y cupo en el servidor). Devuelve su id. */
export async function requestAnalysis(petId: string, photoPath: string | null, symptomIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('request_ai_analysis', {
    target_pet_id: petId,
    // La foto es opcional: la función acepta NULL, pero el tipo generado no expresa argumentos nulos
    // (y omitirlo no vale: el parámetro no tiene valor por defecto).
    p_photo_path: photoPath as string,
    symptom_ids: symptomIds,
  });
  if (error) throw error;
  return data;
}

export type ProcessResult = 'completed' | 'failed' | 'already_processing_or_done';

/**
 * Invoca la Edge Function. Puede responder 403/404 aunque la RPC anterior fuera bien (se autoriza de
 * nuevo): es el contrato. `already_processing_or_done` no es un error.
 */
export async function processAnalysis(analysisId: string): Promise<ProcessResult> {
  const { data, error } = await supabase.functions.invoke<{ status?: ProcessResult }>('ai-analysis-process', {
    body: { analysis_id: analysisId },
  });
  if (error) throw error;
  return data?.status ?? 'failed';
}

export async function fetchAnalysis(analysisId: string): Promise<Analysis | null> {
  const { data, error } = await supabase.from('ai_analysis_requests').select(ANALYSIS_COLUMNS).eq('id', analysisId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Señales elegidas en un análisis (para mostrarlas y para repetir uno fallido). */
export async function fetchAnalysisSymptomIds(analysisId: string): Promise<string[]> {
  const { data, error } = await supabase.from('ai_analysis_symptoms').select('symptom_id').eq('analysis_id', analysisId);
  if (error) throw error;
  return data.map((row) => row.symptom_id);
}

export async function fetchPetAnalyses(petId: string): Promise<Analysis[]> {
  const { data, error } = await supabase
    .from('ai_analysis_requests')
    .select(ANALYSIS_COLUMNS)
    .eq('pet_id', petId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function submitFeedback(analysisId: string, feedback: Enums<'feedback_value'>): Promise<void> {
  const { error } = await supabase.rpc('submit_ai_feedback', {
    target_analysis_id: analysisId,
    new_feedback: feedback,
  });
  if (error) throw error;
}
