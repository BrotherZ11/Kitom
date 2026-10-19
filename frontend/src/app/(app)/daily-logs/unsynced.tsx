import { useRouter } from 'expo-router';

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
import { usePets } from '@/features/pets/hooks/use-pets';
import { getLocale, t } from '@/i18n';

/**
 * Registros del dispositivo con cambios sin confirmar por el servidor (pendientes, fallidos o en
 * conflicto), de todas las mascotas del usuario. Sale del almacén local: aparecen aunque la mascota
 * ya no sea visible (sin permiso, ya no miembro o eliminada). Cada uno abre su detalle, donde se
 * pueden ver y copiar los datos y resolver o descartar si el estado lo permite.
 */
export default function UnsyncedDailyLogsScreen() {
  const router = useRouter();
  // Solo para poner nombres; sin conexión o sin acceso, la lista funciona igual.
  const pets = usePets();
  const { view, refetch } = useUnsyncedDailyLogs(pets.data);

  const content = () => {
    if (view.state === 'loading') return <LoadingState />;
    if (view.state === 'error') {
      return <ErrorState message={t('dailyLogs.errors.local_read_failed')} onRetry={refetch} />;
    }
    if (view.items.length === 0) return <EmptyState icon={CloudUpload} title={t('dailyLogs.unsynced.none')} />;

    return (
      <>
        <Text color="inkMuted">{t('dailyLogs.unsynced.description')}</Text>
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
