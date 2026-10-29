import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { canDiscardUploadedPhoto, isTerminal } from '@/features/ai-analysis/ai-analysis-model';
import {
  deleteConsultPhoto,
  fetchAnalysis,
  fetchAnalysisSymptomIds,
  fetchEntitlement,
  fetchPetAnalyses,
  fetchSymptoms,
  processAnalysis,
  requestAnalysis,
  submitFeedback,
  uploadConsultPhoto,
} from '@/features/ai-analysis/api/ai-analysis-api';
import { useAuth } from '@/features/auth/auth-context';
import { achievementKeys } from '@/features/achievements/hooks/use-achievements';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import { getLocale } from '@/i18n';

/** Query keys de la orientación (con el usuario: el cupo y los análisis dependen de la cuenta). */
export const aiKeys = {
  all: ['ai-analysis'] as const,
  user: (userId: string) => [...aiKeys.all, userId] as const,
  entitlement: (userId: string) => [...aiKeys.user(userId), 'entitlement'] as const,
  symptoms: (speciesId: string, locale: string) => [...aiKeys.all, 'symptoms', speciesId, locale] as const,
  pet: (userId: string, petId: string) => [...aiKeys.user(userId), 'pet', petId] as const,
  detail: (userId: string, analysisId: string) => [...aiKeys.user(userId), 'detail', analysisId] as const,
  symptomIds: (userId: string, analysisId: string) => [...aiKeys.user(userId), 'symptom-ids', analysisId] as const,
};

/** Polling de un análisis mientras se prepara. */
const POLL_MS = 2_000;

function useAiSession() {
  const auth = useAuth();
  return { auth, userId: auth.user?.id ?? '' };
}

export function useEntitlement() {
  const { auth, userId } = useAiSession();
  return useQuery({
    queryKey: aiKeys.entitlement(userId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(fetchEntitlement),
  });
}

export function useSymptoms(speciesId: string | null) {
  const { auth } = useAiSession();
  const locale = getLocale();
  return useQuery({
    queryKey: aiKeys.symptoms(speciesId ?? '', locale),
    enabled: auth.canUseServer && speciesId !== null,
    staleTime: Infinity,
    queryFn: () => auth.serverCall(() => fetchSymptoms(speciesId as string, locale)),
  });
}

export function usePetAnalyses(petId: string) {
  const { auth, userId } = useAiSession();
  return useQuery({
    queryKey: aiKeys.pet(userId, petId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(() => fetchPetAnalyses(petId)),
  });
}

/** Un análisis; mientras se prepara se vuelve a pedir cada 2 s. */
export function useAnalysis(analysisId: string) {
  const { auth, userId } = useAiSession();
  return useQuery({
    queryKey: aiKeys.detail(userId, analysisId),
    enabled: auth.canUseServer && userId !== '',
    queryFn: () => auth.serverCall(() => fetchAnalysis(analysisId)),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !isTerminal(status) ? POLL_MS : false;
    },
  });
}

export function useAnalysisSymptomIds(analysisId: string) {
  const { auth, userId } = useAiSession();
  return useQuery({
    queryKey: aiKeys.symptomIds(userId, analysisId),
    enabled: auth.canUseServer && userId !== '',
    staleTime: Infinity,
    queryFn: () => auth.serverCall(() => fetchAnalysisSymptomIds(analysisId)),
  });
}

export type NewAnalysis = { photo: PreparedPetPhoto | null; photoPath: string | null; symptomIds: string[] };

/**
 * Pedir una orientación: sube la foto (si hay y aún no está subida), crea la solicitud y la manda a
 * preparar. Si el servidor rechaza la solicitud, la foto subida en este intento se borra (si no,
 * quedaría huérfana y cada reintento subiría otra). Si la invocación falla (red), la pantalla del
 * resultado la vuelve a lanzar: es idempotente.
 */
export function useRequestAnalysis(petId: string) {
  const queryClient = useQueryClient();
  const { auth, userId } = useAiSession();
  return useMutation({
    mutationFn: async ({ photo, photoPath, symptomIds }: NewAnalysis) => {
      const uploaded = photoPath === null && photo ? await auth.serverCall(() => uploadConsultPhoto(petId, photo)) : null;
      const path = photoPath ?? uploaded;
      let analysisId: string;
      try {
        analysisId = await auth.serverCall(() => requestAnalysis(petId, path, symptomIds));
      } catch (error) {
        if (uploaded && canDiscardUploadedPhoto(error)) {
          await auth.serverCall(() => deleteConsultPhoto(uploaded)).catch(() => undefined);
        }
        throw error;
      }
      // Se espera a que la función termine (unos segundos); un fallo aquí no es definitivo.
      await auth.serverCall(() => processAnalysis(analysisId)).catch(() => undefined);
      return analysisId;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.entitlement(userId) });
      void queryClient.invalidateQueries({ queryKey: aiKeys.pet(userId, petId) });
      // La primera consulta otorga una insignia en el servidor.
      void queryClient.invalidateQueries({ queryKey: achievementKeys.all });
    },
  });
}

/** Volver a lanzar la preparación de un análisis que sigue pendiente (idempotente en el servidor). */
export function useProcessAnalysis() {
  const { auth } = useAiSession();
  return useMutation({
    mutationFn: (analysisId: string) => auth.serverCall(() => processAnalysis(analysisId)),
  });
}

export function useSubmitFeedback(analysisId: string) {
  const queryClient = useQueryClient();
  const { auth, userId } = useAiSession();
  return useMutation({
    mutationFn: (feedback: 'useful' | 'not_useful') => auth.serverCall(() => submitFeedback(analysisId, feedback)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeys.detail(userId, analysisId) }),
  });
}
