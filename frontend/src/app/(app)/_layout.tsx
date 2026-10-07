import { Stack } from 'expo-router';

import { t } from '@/i18n';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="pets/index" options={{ title: t('pets.list.title') }} />
      <Stack.Screen name="pets/new" options={{ title: t('pets.new.title') }} />
      <Stack.Screen name="pets/[id]/index" options={{ title: t('pets.detail.title') }} />
      <Stack.Screen name="pets/[id]/edit" options={{ title: t('pets.edit.title') }} />
    </Stack>
  );
}
