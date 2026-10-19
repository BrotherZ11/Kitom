import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { Banner } from '@/components/ui/banner';
import { WifiOff, X } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { DailyLogEditor } from '@/features/daily-logs/components/daily-log-editor';
import { DailyLogSavedScreen } from '@/features/daily-logs/components/daily-log-saved';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import { resolveDailyLogPetContext } from '@/features/daily-logs/daily-log-pet-context';
import { useDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import { formatWeekdayDay } from '@/features/daily-logs/log-date';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { petErrorMessage, toPetError } from '@/features/pets/pet-errors';
import { getLocale, t, tf } from '@/i18n';

/**
 * Registro de hoy de una mascota (crear o editar; tableros 5.1–5.3, 5.5–5.8), a pantalla completa.
 * Se guarda en el dispositivo y se sincroniza. Con conexión espera brevemente a la versión del
 * servidor; sin conexión (o si el servidor tarda) muestra lo último conocido y, si no hay nada,
 * permite empezarlo. Tras crear el de hoy, «Hecho» (5.3); tras editarlo, vuelve con un aviso.
 */
export default function DailyLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  // Sin conexión y sin la mascota en caché, el registro sigue disponible (`daily-log-pet-context.ts`).
  const petContext = resolveDailyLogPetContext(pet, canEdit, (error) => toPetError(error).code === 'network');
  // La fecha se fija al abrir: el registro que se está rellenando no cambia de día.
  const logDate = useTodayLogDate({ refreshOnForeground: false });
  const { view, refetch } = useDailyLog(id, logDate, { allowOfflineCreate: true, waitForRemote: true });
  const week = useWeekOverview(id);
  const [showSaved, setShowSaved] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const petName = petContext.state === 'ready' ? petContext.name : null;

  const frame = (content: ReactNode) => (
    <Screen align="top">
      <TopBar onBack={close} backIcon={X} backLabel={t('common.close')} />
      {content}
    </Screen>
  );

  // Con datos ya cargados (p. ej. al quedarse sin conexión), un error al refrescar no tapa la pantalla.
  if (petContext.state === 'error') {
    const query = petContext.source === 'pet' ? pet : canEdit;
    return frame(<ErrorState message={petErrorMessage(petContext.error)} onRetry={() => void query.refetch()} />);
  }
  if (view.state === 'error') {
    return frame(<ErrorState message={t(`dailyLogs.errors.${toDailyLogError(view.error).code}`)} onRetry={refetch} />);
  }
  if (petContext.state === 'loading' || logDate === null || view.state === 'loading') return frame(<LoadingState />);
  if (petContext.state === 'not_found') {
    return frame(
      <EmptyState
        title={t('pets.detail.notFound')}
        actionLabel={t('pets.detail.backToList')}
        onAction={() => router.dismissTo('/pets')}
      />
    );
  }
  if (!petContext.canEdit && !view.content) {
    return frame(<EmptyState title={t('dailyLogs.emptyReadOnly')} />);
  }

  if (showSaved && week.state === 'ready' && week.overview.today) {
    return (
      <DailyLogSavedScreen
        petName={petName ?? t('dailyLogs.offlinePet.unavailable')}
        overview={week.overview}
        savedLocally={week.overview.today.syncStatus !== 'synced' && (view.offline || week.offline)}
        onHome={() => router.dismissTo('/')}
        onEdit={() => {
          setShowSaved(false);
          setEditorKey((key) => key + 1);
        }}
      />
    );
  }

  return (
    <DailyLogEditor
      key={`${logDate}-${editorKey}`}
      petId={id}
      logDate={logDate}
      petName={petName}
      title={tf('dailyLogs.editor.todayTitle', { date: formatWeekdayDay(logDate, getLocale()) })}
      historical={false}
      initialContent={view.content}
      baseRow={view.baseRow}
      canEdit={petContext.canEdit}
      notices={
        <>
          {view.offline ? <Banner icon={WifiOff} message={t('home.offlineBanner')} /> : null}
          {!view.offline && view.checking ? (
            <Text variant="caption" color="inkMuted" accessibilityLiveRegion="polite">
              {t('dailyLogs.sync.notChecked')}
            </Text>
          ) : null}
          {petContext.permissionUnknown ? (
            <Text variant="caption" color="inkMuted">
              {t('dailyLogs.offlinePet.permissionUnknown')}
            </Text>
          ) : null}
        </>
      }
      onClose={close}
      onSaved={({ isNew }) => {
        if (isNew) {
          setShowSaved(true);
        } else {
          toast({ message: t('dailyLogs.editor.saved') });
          close();
        }
      }}
    />
  );
}
