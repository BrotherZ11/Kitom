import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { HistoryListItem } from '@/features/daily-logs/components/history-list-item';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { flattenHistory } from '@/features/daily-logs/daily-log-history';
import { useDailyLogHistory } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { useCanEditPet } from '@/features/pets/hooks/use-pets';
import { t } from '@/i18n';

/** Historial de registros diarios de una mascota, del más reciente al más antiguo, por páginas. */
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
    if (history.isPending) return <LoadingState />;
    // Sin datos: falló la primera página. Con datos, el error es de "cargar más" (abajo).
    if (history.isError && !history.data) {
      return <ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} />;
    }

    const logs = flattenHistory(history.data.pages);
    if (logs.length === 0) {
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
        {logs.map((log) => (
          <HistoryListItem
            key={log.id}
            log={log}
            isToday={log.log_date === today}
            withYear={currentYear !== undefined && !log.log_date.startsWith(currentYear)}
            onPress={() => openLog(log.log_date)}
          />
        ))}
        <FormMessage message={history.isFetchNextPageError ? errorMessage(history.error) : null} />
        {history.hasNextPage ? (
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
