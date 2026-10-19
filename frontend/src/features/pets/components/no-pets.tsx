import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { t } from '@/i18n';

/**
 * Sin mascotas (tablero 3.10): primer uso o tras borrar la última. Lo comparten las pestañas, que
 * no tienen nada que mostrar sin una mascota.
 */
export function NoPetsScreen() {
  const router = useRouter();

  return (
    <Screen
      edges={['top', 'left', 'right']}
      footer={
        <>
          <Button label={t('home.noPets.add')} icon={Plus} onPress={() => router.push('/pets/new')} />
          <Button variant="ghost" size="md" label={t('home.noPets.account')} onPress={() => router.push('/settings')} />
        </>
      }>
      <EmptyState prominent title={t('home.noPets.title')} description={t('home.noPets.text')} />
    </Screen>
  );
}
