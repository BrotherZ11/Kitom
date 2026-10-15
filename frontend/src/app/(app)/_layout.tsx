import { Stack } from 'expo-router';

import { DailyLogSyncProvider } from '@/features/daily-logs/sync/daily-log-sync-provider';
import { useProfileTimeZoneSync } from '@/features/profile/hooks/use-profile-timezone-sync';
import { t } from '@/i18n';

export default function AppLayout() {
  // Solo se monta con sesión activa (Stack.Protected en el layout raíz).
  useProfileTimeZoneSync();

  return (
    <DailyLogSyncProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pets/index" options={{ title: t('pets.list.title') }} />
        <Stack.Screen name="pets/new" options={{ title: t('pets.new.title') }} />
        <Stack.Screen name="pets/[id]/index" options={{ title: t('pets.detail.title') }} />
        <Stack.Screen name="pets/[id]/edit" options={{ title: t('pets.edit.title') }} />
        <Stack.Screen name="pets/[id]/daily-log" options={{ title: t('dailyLogs.screenTitle') }} />
        <Stack.Screen name="pets/[id]/daily-logs/index" options={{ title: t('dailyLogs.history.title') }} />
        <Stack.Screen name="pets/[id]/daily-logs/[date]" options={{ title: t('dailyLogs.entry.title') }} />
        <Stack.Screen
          name="pets/[id]/daily-logs/resolve/[date]"
          options={{ title: t('dailyLogs.resolve.title') }}
        />
        <Stack.Screen name="daily-logs/unsynced" options={{ title: t('dailyLogs.unsynced.title') }} />
      </Stack>
    </DailyLogSyncProvider>
  );
}
