import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { CloudUpload } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { SyncStatusTag } from '@/features/daily-logs/components/sync-status';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { capitalizeFirst, formatLogDateLabel } from '@/features/daily-logs/log-date';
import { PetDeleteTag } from '@/features/pets/components/pet-deletion-status';
import { PetSyncTag } from '@/features/pets/components/pet-sync-status';
import { usePetOperations } from '@/features/pets/hooks/use-pet-writes';
import { usePets } from '@/features/pets/hooks/use-pets';
import { unsyncedPetItems } from '@/features/pets/offline/pet-write-view';
import { getLocale, t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Cambios del dispositivo sin confirmar por el servidor, de todo el usuario: altas, ediciones y
 * eliminaciones de mascotas (fase 10) y registros diarios (pendientes, fallidos o en conflicto). Sale
 * de los almacenes locales: aparecen aunque la mascota ya no sea visible (sin permiso, ya no miembro o
 * eliminada). Cada uno abre donde se ve su estado y lo que se puede hacer (reintentar, resolver,
 * descartar o deshacer la eliminación).
 */
export default function UnsyncedDailyLogsScreen() {
  const router = useRouter();
  // Solo para poner nombres; sin conexión o sin acceso, la lista funciona igual.
  const pets = usePets();
  const { view, refetch } = useUnsyncedDailyLogs(pets.data);
  const operations = usePetOperations();
  const petItems = unsyncedPetItems(operations.data, operations.syncingKey);

  const petsSection =
    petItems.length > 0 ? (
      <View style={styles.section}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('dailyLogs.unsynced.petsSection')}
        </Text>
        <Card flush>
          {petItems.map((item, index) => (
            <ListItem
              key={item.key}
              title={item.name}
              trailing={item.deletion ? <PetDeleteTag display={item.deletion} /> : <PetSyncTag display={item.sync} />}
              divider={index < petItems.length - 1}
              onPress={() => router.push({ pathname: '/pets/[id]', params: { id: item.routeId } })}
            />
          ))}
        </Card>
      </View>
    ) : null;
  // Si las operaciones de mascotas no se pueden leer, se dice: no se afirma que no haya.
  const petsError = operations.isError ? (
    <Alert
      tone="warning"
      message={t('pets.sync.operationsReadFailed')}
      action={{ label: t('common.retry'), onPress: () => void operations.refetch() }}
    />
  ) : null;

  const content = () => {
    if (view.state === 'loading' || operations.isPending) return <LoadingState />;
    if (view.state === 'error') {
      return (
        <>
          {petsError}
          {petsSection}
          <ErrorState message={t('dailyLogs.errors.local_read_failed')} onRetry={refetch} />
        </>
      );
    }
    if (view.items.length === 0 && petItems.length === 0 && !operations.isError) {
      return <EmptyState icon={CloudUpload} title={t('dailyLogs.unsynced.none')} />;
    }

    return (
      <>
        <Text color="inkMuted">{t('dailyLogs.unsynced.description')}</Text>
        {petsError}
        {petsSection}
        {view.items.length > 0 ? (
          <View style={styles.section}>
            <Text variant="overline" color="inkMuted" accessibilityRole="header">
              {t('dailyLogs.unsynced.logsSection')}
            </Text>
            <Card flush>
              {view.items.map(({ record, petName, syncStatus }, index) => {
                const name = petName ?? t('dailyLogs.unsynced.unknownPet');
                const date = capitalizeFirst(formatLogDateLabel(record.logDate, getLocale(), { withYear: true }), getLocale());
                return (
                  <ListItem
                    key={`${record.petId}/${record.logDate}`}
                    title={date}
                    subtitle={name}
                    trailing={<SyncStatusTag status={syncStatus} />}
                    divider={index < view.items.length - 1}
                    onPress={() =>
                      router.push({
                        pathname: '/pets/[id]/daily-logs/resolve/[date]',
                        params: { id: record.petId, date: record.logDate },
                      })
                    }
                  />
                );
              })}
            </Card>
          </View>
        ) : null}
      </>
    );
  };

  return (
    <Screen align="top">
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} title={t('dailyLogs.unsynced.title')} />
      {content()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing['2'],
  },
});
