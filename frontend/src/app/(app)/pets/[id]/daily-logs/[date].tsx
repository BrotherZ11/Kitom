import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Pencil } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { DailyLogEditor } from '@/features/daily-logs/components/daily-log-editor';
import { DayDetail } from '@/features/daily-logs/components/day-detail';
import { SyncStatus } from '@/features/daily-logs/components/sync-status';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { parseLogDateParam, resolveHistoryLogView } from '@/features/daily-logs/daily-log-history';
import { resolveDailyLogPetContext } from '@/features/daily-logs/daily-log-pet-context';
import { useDailyLog, useRetryDailyLogSync } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { capitalizeFirst, formatLogDateLabel, formatWeekdayDay } from '@/features/daily-logs/log-date';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
import { getLocale, t } from '@/i18n';

/**
 * Un registro guardado: detalle del día (tablero 6.3) y, con `?edit=1`, su edición (5.4). Nunca
 * crea: si ese día no tiene registro, lo indica. La fecha es la de la ruta/fila guardada, no la de hoy.
 */
export default function DailyLogEntryScreen() {
  const { id, date, edit } = useLocalSearchParams<{ id: string; date: string; edit?: string }>();
  const router = useRouter();
  const toast = useToast();
  const logDate = parseLogDateParam(date);
  const today = useTodayLogDate();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  const retrySync = useRetryDailyLogSync();
  // Sin conexión y sin la mascota en caché, el registro sigue disponible (`daily-log-pet-context.ts`).
  const petContext = resolveDailyLogPetContext(pet, canEdit, (error) => toPetError(error).code === 'network');
  const { view, refetch } = useDailyLog(id, logDate, { waitForRemote: true });
  const editing = edit === '1';

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]/daily-logs', params: { id } }));
  const frame = (content: ReactNode, title?: string) => (
    <Screen align="top">
      <TopBar onBack={back} title={title} />
      {content}
    </Screen>
  );

  const missing = (
    <EmptyState title={t('dailyLogs.entry.missing')} actionLabel={t('dailyLogs.entry.backToHistory')} onAction={back} />
  );

  if (logDate === null) return frame(missing);
  const dateTitle = formatLogDateLabel(logDate, getLocale(), { withYear: today !== null && !logDate.startsWith(today.slice(0, 4)) });
  const title = capitalizeFirst(dateTitle, getLocale());

  // Con datos ya cargados (p. ej. al quedarse sin conexión), un error al refrescar no tapa la pantalla.
  if (petContext.state === 'error') {
    const query = petContext.source === 'pet' ? pet : canEdit;
    return frame(<ErrorState message={petErrorMessage(petContext.error)} onRetry={() => void query.refetch()} />, title);
  }
  if (view.state === 'error') {
    return frame(<ErrorState message={t(`dailyLogs.errors.${toDailyLogError(view.error).code}`)} onRetry={refetch} />, title);
  }
  if (petContext.state === 'loading' || view.state === 'loading') return frame(<LoadingState />, title);
  if (petContext.state === 'not_found') {
    return frame(
      <EmptyState
        title={t('pets.detail.notFound')}
        actionLabel={t('pets.detail.backToList')}
        onAction={() => router.dismissTo('/pets')}
      />
    );
  }

  const mode = resolveHistoryLogView(view.content, petContext.canEdit);
  if (mode === 'missing' || !view.content) return frame(missing, title);

  const notices = (
    <>
      {view.offline || view.checking ? (
        <Text variant="caption" color="inkMuted" accessibilityLiveRegion="polite">
          {t(view.offline ? 'dailyLogs.sync.offline' : 'dailyLogs.sync.notChecked')}
        </Text>
      ) : null}
      {petContext.permissionUnknown ? (
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.offlinePet.permissionUnknown')}
        </Text>
      ) : null}
    </>
  );

  if (editing && mode === 'editable') {
    return (
      <DailyLogEditor
        key={logDate}
        petId={id}
        logDate={logDate}
        petName={petContext.name}
        title={capitalizeFirst(formatWeekdayDay(logDate, getLocale()), getLocale())}
        historical={logDate !== today}
        initialContent={view.content}
        baseRow={view.baseRow}
        canEdit
        notices={notices}
        onClose={back}
        onSaved={() => {
          toast({ message: t('dailyLogs.editor.saved') });
          back();
        }}
      />
    );
  }

  const openEditor = () =>
    router.push({ pathname: '/pets/[id]/daily-logs/[date]', params: { id, date: logDate, edit: '1' } });

  return (
    <Screen
      align="top"
      footer={
        mode === 'editable' ? <Button variant="secondary" label={t('dailyLogs.entry.edit')} onPress={openEditor} /> : undefined
      }>
      <TopBar
        onBack={back}
        title={title}
        right={
          mode === 'editable' ? (
            <IconButton icon={Pencil} accessibilityLabel={t('dailyLogs.entry.edit')} onPress={openEditor} />
          ) : null
        }
      />
      {notices}
      {mode === 'read_only' ? (
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.readOnly')}
        </Text>
      ) : null}
      {view.syncStatus && view.syncStatus !== 'synced' ? (
        <SyncStatus
          status={view.syncStatus}
          record={view.record}
          onRetry={mode === 'editable' && view.record ? () => retrySync(id, logDate) : undefined}
          onResolve={() =>
            router.push({ pathname: '/pets/[id]/daily-logs/resolve/[date]', params: { id, date: logDate } })
          }
        />
      ) : null}
      <DayDetail content={view.content} serverRow={view.baseRow} hasLocalChanges={view.source === 'local' && view.syncStatus !== 'synced'} />
    </Screen>
  );
}
