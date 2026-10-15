import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { HistoryListItem } from '@/features/daily-logs/components/history-list-item';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { useDailyLogHistory } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import { t } from '@/i18n';

/**
 * Historial de registros diarios de una mascota, del más reciente al más antiguo, por páginas, con
 * los cambios pendientes del dispositivo encima. Sin conexión muestra lo guardado en el dispositivo.
 */
export default function DailyLogHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const history = useDailyLogHistory(id);
  const canEdit = useCanEditPet(id);
  // Solo para marcar «Hoy» y decidir si mostrar el año; las fechas mostradas son las guardadas.
  const today = useTodayLogDate();

  const errorMessage = (error: unknown) => t(`dailyLogs.errors.${toDailyLogError(error).code}`);
  const openLog = (date: string) =>
    router.push({ pathname: '/pets/[id]/daily-logs/[date]', params: { id, date } });

  const content = () => {
    const { view } = history;
    if (view.state === 'loading') return <LoadingState />;
    // Sin datos del servidor ni del dispositivo: error (nunca una lista vacía engañosa). Con datos,
    // el error es de "cargar más" (abajo).
    if (view.state === 'error') {
      return <ErrorState message={errorMessage(view.error)} onRetry={history.refetch} />;
    }

    const { items } = view;
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('dailyLogs.history.emptyTitle')}
          description={t('dailyLogs.history.emptyDescription')}
          actionLabel={canEdit.data ? t('dailyLogs.history.logToday') : undefined}
          onAction={() => router.push({ pathname: '/pets/[id]/daily-log', params: { id } })}
        />
      );
    }

    const currentYear = today?.slice(0, 4);
    return (
      <>
        {view.offline ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('dailyLogs.sync.offline')}
          </ThemedText>
        ) : null}
        {items.map(({ log, syncStatus }) => (
          <HistoryListItem
            key={log.log_date}
            log={log}
            syncStatus={syncStatus}
            isToday={log.log_date === today}
            withYear={currentYear !== undefined && !log.log_date.startsWith(currentYear)}
            onPress={() => openLog(log.log_date)}
          />
        ))}
        <FormMessage message={history.isFetchNextPageError ? errorMessage(history.error) : null} />
        {view.offline ? null : history.hasNextPage ? (
          <Button
            variant="secondary"
            label={t('dailyLogs.history.loadMore')}
            loading={history.isFetchingNextPage}
            onPress={() => {
              if (!history.isFetchingNextPage) void history.fetchNextPage();
            }}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('dailyLogs.history.end')}
          </ThemedText>
        )}
      </>
    );
  };

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      {content()}
    </Screen>
  );
}
