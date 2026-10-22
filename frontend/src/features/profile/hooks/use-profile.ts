import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import {
  completeProfileOnboarding,
  fetchNotificationPreferences,
  fetchProfile,
  fetchSubscription,
  saveNotificationPreferences,
  updateProfile,
  type NotificationPreferences,
  type Profile,
  type ProfileUpdate,
} from '@/features/profile/api/profile-api';
import { ONBOARDING_COLLECTION, ONBOARDING_ID, resolveOnboardingGate } from '@/features/profile/onboarding';
import { profileKeys } from '@/features/profile/query-keys';
import { deviceStorage } from '@/lib/local-store/device-storage';
import { createLocalStore } from '@/lib/local-store/local-store';
import { isNetworkError } from '@/lib/server-errors';

/** Usuario de la zona autenticada y si se puede usar el servidor ahora. */
function useProfileSession() {
  const auth = useAuth();
  const userId = auth.user?.id ?? '';
  return { auth, userId, enabled: auth.canUseServer && userId !== '' };
}

/** Perfil propio (configuración inicial, aviso y consentimientos). */
export function useProfile() {
  const { auth, userId, enabled } = useProfileSession();
  return useQuery({
    queryKey: profileKeys.detail(),
    enabled,
    queryFn: () => auth.serverCall(() => fetchProfile(userId)),
  });
}

/** Cambia columnas editables del perfil y refresca lo que depende de ellas (saludo, zona horaria). */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { auth, userId } = useProfileSession();
  return useMutation({
    mutationFn: (patch: ProfileUpdate) => auth.serverCall(() => updateProfile(userId, patch)),
    onSuccess: (_, patch) => {
      queryClient.setQueryData<Profile | null>(profileKeys.detail(), (current) =>
        current ? { ...current, ...patch } : current
      );
      if ('full_name' in patch) void queryClient.invalidateQueries({ queryKey: profileKeys.name() });
      if ('timezone' in patch) void queryClient.invalidateQueries({ queryKey: profileKeys.timeZone() });
    },
  });
}

function onboardingStore(userId: string) {
  return createLocalStore(deviceStorage, userId);
}

/**
 * ¿Hay que pasar por la configuración inicial? (`onboarding.ts`, `resolveOnboardingGate`). Lee
 * primero la marca del dispositivo; solo sin ella pregunta al servidor.
 */
export function useOnboardingGate() {
  const queryClient = useQueryClient();
  const { auth, userId, enabled } = useProfileSession();
  const local = useQuery({
    queryKey: profileKeys.onboardingLocal(userId),
    enabled: userId !== '',
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const result = await onboardingStore(userId).read(ONBOARDING_COLLECTION, ONBOARDING_ID);
        return result.status === 'found';
      } catch {
        // Sin almacenamiento legible se pregunta al servidor.
        return false;
      }
    },
  });
  const profile = useProfile();
  const needsRemote = enabled && local.data === false;
  const completedAt = profile.data?.onboarding_completed_at ?? null;
  const gate = resolveOnboardingGate({
    canUseServer: auth.canUseServer,
    localDone: local.data,
    remote:
      !needsRemote || profile.isPending
        ? { status: 'pending' }
        : profile.isError
          ? { status: 'error', offline: isNetworkError(profile.error) }
          : { status: 'success', completedAt },
  });

  // Si el servidor ya la da por terminada (p. ej. en otro dispositivo), se recuerda en este.
  const remember = local.data === false && completedAt !== null;
  useEffect(() => {
    if (!remember) return;
    queryClient.setQueryData(profileKeys.onboardingLocal(userId), true);
    void onboardingStore(userId)
      .write(ONBOARDING_COLLECTION, ONBOARDING_ID, { done: true })
      .catch(() => undefined);
  }, [remember, queryClient, userId]);

  return { gate, retry: () => void profile.refetch() };
}

/** Termina la configuración inicial: servidor primero; la marca del dispositivo, después. */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  const { auth, userId } = useProfileSession();
  return useMutation({
    mutationFn: async () => {
      await auth.serverCall(() => completeProfileOnboarding(userId));
      await onboardingStore(userId)
        .write(ONBOARDING_COLLECTION, ONBOARDING_ID, { done: true })
        .catch(() => undefined);
    },
    onSuccess: () => {
      queryClient.setQueryData(profileKeys.onboardingLocal(userId), true);
      queryClient.setQueryData<Profile | null>(profileKeys.detail(), (current) =>
        current ? { ...current, onboarding_completed_at: current.onboarding_completed_at ?? new Date().toISOString() } : current
      );
    },
  });
}

/** Preferencias de avisos (`notification_preferences`). */
export function useNotificationPreferences() {
  const { auth, userId, enabled } = useProfileSession();
  return useQuery({
    queryKey: profileKeys.notificationPreferences(),
    enabled,
    queryFn: () => auth.serverCall(() => fetchNotificationPreferences(userId)),
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();
  const { auth, userId } = useProfileSession();
  return useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      auth.serverCall(() => saveNotificationPreferences(userId, patch)),
    onSuccess: (saved) => queryClient.setQueryData(profileKeys.notificationPreferences(), saved),
  });
}

/** Plan del usuario (solo para mostrarlo; el servidor decide qué puede hacer). */
export function useSubscription() {
  const { auth, userId, enabled } = useProfileSession();
  return useQuery({
    queryKey: profileKeys.subscription(),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => auth.serverCall(() => fetchSubscription(userId)),
  });
}
