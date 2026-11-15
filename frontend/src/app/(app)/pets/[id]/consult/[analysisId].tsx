import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CalendarDays, CircleAlert, RefreshCw, Share2, TriangleAlert, X } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import {
  buildShareText,
  isSymptomOnset,
  isSymptomTrend,
  pollState,
  REINVOKE_AFTER_MS,
  resultScreen,
  toRequestErrorCode,
  type Analysis,
} from '@/features/ai-analysis/ai-analysis-model';
import { ConsultGate } from '@/features/ai-analysis/components/consult-gate';
import {
  BulletList,
  ConsultDisclaimer,
  EmergencyHint,
  FeedbackButtons,
  UrgencyPanel,
} from '@/features/ai-analysis/components/consult-parts';
import {
  useAnalysis,
  useAnalysisSymptomIds,
  useProcessAnalysis,
  useRequestAnalysis,
  useSubmitFeedback,
  useSymptoms,
} from '@/features/ai-analysis/hooks/use-ai-analysis';
import { usePetPhotoUrl } from '@/features/pets/hooks/use-pet-photo';
import type { Pet } from '@/features/pets/types';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

/**
 * Resultado de una consulta (tableros 7.7–7.12): preparando (con polling y reintento de la función si
 * se queda pendiente), resultado por nivel de urgencia con el aviso siempre visible y la valoración
 * (solo quien la pidió), o error con «volver a intentarlo» con las mismas señales y foto.
 */
export default function ConsultResultScreen() {
  const { id, analysisId } = useLocalSearchParams<{ id: string; analysisId: string }>();
  return <ConsultGate petId={id}>{(pet, canEdit) => <ConsultResult pet={pet} canEdit={canEdit} analysisId={analysisId} />}</ConsultGate>;
}

function ConsultResult({ pet, canEdit, analysisId }: { pet: Pet; canEdit: boolean; analysisId: string }) {
  const router = useRouter();
  const analysis = useAnalysis(analysisId);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (analysis.isPending) {
    return (
      <Screen align="top">
        <TopBar onBack={close} backIcon={X} />
        <LoadingState />
      </Screen>
    );
  }
  if (analysis.isError) {
    return (
      <Screen align="top">
        <TopBar onBack={close} backIcon={X} />
        <ErrorState message={t('consult.errors.unknown')} onRetry={() => void analysis.refetch()} />
      </Screen>
    );
  }
  if (!analysis.data) {
    return (
      <Screen align="top">
        <TopBar onBack={close} backIcon={X} />
        <EmptyState title={t('consult.errors.notFound')} actionLabel={t('common.back')} onAction={close} />
      </Screen>
    );
  }
  const row = analysis.data;
  const screen = resultScreen(row);
  if (screen === 'result') return <ResultView pet={pet} analysis={row} onClose={close} />;
  if (screen === 'failed') return <FailedView pet={pet} canEdit={canEdit} analysis={row} onClose={close} />;
  return <PreparingView analysis={row} onClose={close} />;
}

function PreparingView({ analysis, onClose }: { analysis: Analysis; onClose: () => void }) {
  const theme = useTheme();
  const { user } = useAuth();
  const process = useProcessAnalysis();
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(since);
  const reinvoked = useRef(false);
  const mine = analysis.requested_by === user?.id;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // Sigue pendiente (la invocación se perdió): se vuelve a lanzar una vez. El servidor no reprocesa.
  useEffect(() => {
    if (!mine || reinvoked.current || analysis.status !== 'pending' || now - since < REINVOKE_AFTER_MS) return;
    reinvoked.current = true;
    process.mutate(analysis.id);
  }, [mine, analysis.status, analysis.id, now, since, process]);

  const slow = pollState(analysis.status, since, now) === 'slow';
  return (
    <Screen
      align="center"
      footer={
        slow && mine ? (
          <>
            {process.isError ? <Alert tone="error" message={t(`consult.errors.${toRequestErrorCode(process.error)}`)} /> : null}
            <Button
              label={t('consult.preparing.retry')}
              icon={RefreshCw}
              variant="secondary"
              loading={process.isPending}
              onPress={() => process.mutate(analysis.id)}
            />
          </>
        ) : undefined
      }>
      <TopBar onBack={onClose} backIcon={X} />
      <View style={styles.preparing} accessible accessibilityRole="progressbar" accessibilityLabel={t('consult.preparing.title')}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text variant="title2" style={styles.center}>
          {t('consult.preparing.title')}
        </Text>
        <Text color="inkMuted" style={styles.center}>
          {slow ? t('consult.preparing.slow') : t('consult.preparing.text')}
        </Text>
      </View>
    </Screen>
  );
}

function ResultView({ pet, analysis, onClose }: { pet: Pet; analysis: Analysis; onClose: () => void }) {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const level = analysis.urgency_level ?? 'observe';
  const urgent = level === 'urgent';
  const mine = analysis.requested_by === user?.id;
  const feedback = useSubmitFeedback(analysis.id);
  const [pending, setPending] = useState<'useful' | 'not_useful' | null>(null);
  const photoUrl = usePetPhotoUrl(analysis.photo_path);
  const signs = useSignLabels(pet, analysis.id);
  const value = pending ?? analysis.feedback ?? null;
  const [shareError, setShareError] = useState(false);
  const date = formatFullDate(new Date(analysis.created_at), getLocale());
  const onset = isSymptomOnset(analysis.symptom_onset) ? analysis.symptom_onset : null;
  const trend = isSymptomTrend(analysis.symptom_trend) ? analysis.symptom_trend : null;
  const warningSigns = analysis.warning_signs ?? [];
  const vetQuestions = analysis.vet_questions ?? [];

  const share = async () => {
    setShareError(false);
    const message = buildShareText(analysis, {
      title: tf('consult.result.shareTitle', { name: pet.name }),
      date: tf('consult.result.shareDate', { date }),
      level: tf('consult.result.shareLevel', { level: t(`consult.result.urgency.${level}`) }),
      signs: signs ? tf('consult.result.shareSigns', { list: signs }) : null,
      summary: t('consult.result.summary'),
      causes: t('consult.result.causes'),
      todo: t('consult.result.todo'),
      warning: t('consult.result.warning'),
      vet: t('consult.result.vet'),
      yourContext: t('consult.result.yourContext'),
      footer: t('consult.result.shareFooter'),
    });
    try {
      await Share.share({ message, title: tf('consult.result.shareTitle', { name: pet.name }) });
    } catch {
      setShareError(true);
    }
  };

  return (
    <Screen
      align="top"
      footer={
        <>
          {level === 'consult_soon' || urgent ? (
            <Button
              label={t('consult.result.addReminder')}
              icon={CalendarDays}
              variant={urgent ? 'secondary' : 'primary'}
              onPress={() => router.push({ pathname: '/reminders/new', params: { petId: pet.id, type: 'appointment' } })}
            />
          ) : null}
          <Button label={t('consult.result.backHome')} variant="ghost" size="md" onPress={() => router.replace('/')} />
        </>
      }>
      <TopBar onBack={onClose} backIcon={X} title={tf('consult.result.overline', { name: pet.name })} />
      <UrgencyPanel level={level} petName={pet.name} />
      {/* Urgente: primero cómo actuar; la valoración, al final (tablero 7.11). */}
      {urgent ? <EmergencyHint prominent /> : null}
      {analysis.summary ? (
        <View style={styles.section}>
          <Text variant="title3" accessibilityRole="header">
            {t('consult.result.summary')}
          </Text>
          <Text variant="bodyLg">{analysis.summary}</Text>
        </View>
      ) : null}
      {photoUrl.data ? (
        <View style={styles.photoBlock}>
          <Image source={{ uri: photoUrl.data }} style={styles.photo} contentFit="cover" accessibilityLabel={t('consult.result.photoA11y')} />
          {analysis.photo_observations ? (
            <Text color="inkMuted">
              <Text variant="bodyStrong" color="inkMuted">{`${t('consult.result.photo')}: `}</Text>
              {analysis.photo_observations}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text variant="title3" accessibilityRole="header">
          {t('consult.result.causes')}
        </Text>
        <BulletList items={analysis.possible_causes ?? []} />
      </View>
      <View style={styles.section}>
        <Text variant="title3" accessibilityRole="header">
          {t('consult.result.todo')}
        </Text>
        <BulletList items={analysis.recommendations ?? []} />
      </View>
      {warningSigns.length ? (
        <View style={[styles.warning, { backgroundColor: theme.dangerBg }]} accessible accessibilityRole="summary">
          <View style={styles.warningTitle}>
            <Icon icon={TriangleAlert} size={20} color="dangerInk" />
            <Text variant="title3" color="dangerInk" accessibilityRole="header" style={styles.flex}>
              {t('consult.result.warning')}
            </Text>
          </View>
          <BulletList items={warningSigns} />
        </View>
      ) : null}
      {vetQuestions.length ? (
        <View style={styles.section}>
          <Text variant="title3" accessibilityRole="header">
            {t('consult.result.vet')}
          </Text>
          <Text color="inkMuted">{t('consult.result.vetText')}</Text>
          <BulletList items={vetQuestions} />
        </View>
      ) : null}
      <Button label={t('consult.result.share')} icon={Share2} variant="secondary" size="md" onPress={() => void share()} />
      {shareError ? <Alert tone="error" message={t('consult.result.shareError')} /> : null}
      {analysis.user_context || onset || trend ? (
        <View style={styles.context}>
          <Text variant="label" color="inkMuted">
            {t('consult.result.yourContext')}
          </Text>
          {onset ? (
            <Text variant="caption" color="inkMuted">
              {tf('consult.result.onset', { value: t(`consult.context.onset.${onset}`) })}
            </Text>
          ) : null}
          {trend ? (
            <Text variant="caption" color="inkMuted">
              {tf('consult.result.trend', { value: t(`consult.context.trend.${trend}`) })}
            </Text>
          ) : null}
          {analysis.user_context ? (
            <Text variant="caption" color="inkMuted">
              {`«${analysis.user_context}»`}
            </Text>
          ) : null}
        </View>
      ) : null}
      {signs ? (
        <Text variant="caption" color="inkMuted">
          {tf('consult.result.signs', { list: signs })}
        </Text>
      ) : null}
      <Text variant="caption" color="inkMuted">
        {tf('consult.result.date', { date })}
      </Text>
      <ConsultDisclaimer />
      {mine ? (
        <FeedbackButtons
          value={value}
          busy={feedback.isPending}
          error={feedback.isError}
          onChange={(next) => {
            setPending(next);
            feedback.mutate(next);
          }}
        />
      ) : null}
    </Screen>
  );
}

function FailedView({ pet, canEdit, analysis, onClose }: { pet: Pet; canEdit: boolean; analysis: Analysis; onClose: () => void }) {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const symptomIds = useAnalysisSymptomIds(analysis.id);
  const request = useRequestAnalysis(pet.id);
  const [error, setError] = useState<string | null>(null);
  const canRetry = canEdit && analysis.requested_by === user?.id && symptomIds.data !== undefined;

  const retry = async () => {
    setError(null);
    try {
      const next = await request.mutateAsync({
        photo: null,
        photoPath: analysis.photo_path,
        symptomIds: symptomIds.data ?? [],
        context: {
          text: analysis.user_context,
          onset: isSymptomOnset(analysis.symptom_onset) ? analysis.symptom_onset : null,
          trend: isSymptomTrend(analysis.symptom_trend) ? analysis.symptom_trend : null,
        },
      });
      router.replace({ pathname: '/pets/[id]/consult/[analysisId]', params: { id: pet.id, analysisId: next } });
    } catch (cause) {
      setError(t(`consult.errors.${toRequestErrorCode(cause)}`));
    }
  };

  return (
    <Screen
      align="top"
      footer={
        <>
          {error ? <Alert tone="error" message={error} /> : null}
          {canRetry ? (
            <Button
              label={t('consult.error.retry')}
              icon={RefreshCw}
              loading={request.isPending}
              onPress={() => void retry()}
            />
          ) : null}
          <Button label={t('consult.result.backHome')} variant="ghost" size="md" onPress={() => router.replace('/')} />
        </>
      }>
      <TopBar onBack={onClose} backIcon={X} />
      <View style={styles.failed}>
        <View style={[styles.failedIcon, { backgroundColor: theme.dangerBg }]}>
          <Icon icon={CircleAlert} size={32} color="dangerInk" />
        </View>
        <Text variant="title2" accessibilityRole="header" style={styles.center}>
          {t('consult.error.title')}
        </Text>
        <Text color="inkMuted" style={styles.center}>
          {t('consult.error.text')}
        </Text>
      </View>
      <EmergencyHint />
    </Screen>
  );
}

/** Nombres de las señales elegidas en un análisis («Ojos llorosos, Cojera»). */
function useSignLabels(pet: Pet, analysisId: string): string | null {
  const ids = useAnalysisSymptomIds(analysisId);
  const symptoms = useSymptoms(pet.species_id);
  if (!ids.data || !symptoms.data) return null;
  const labels = symptoms.data.filter((symptom) => ids.data.includes(symptom.id)).map((symptom) => symptom.label);
  return labels.length ? labels.join(', ') : null;
}

const styles = StyleSheet.create({
  preparing: {
    alignItems: 'center',
    gap: spacing['4'],
    paddingHorizontal: spacing['4'],
  },
  center: {
    textAlign: 'center',
  },
  section: {
    gap: spacing['3'],
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
  },
  photoBlock: {
    gap: spacing['2'],
  },
  warning: {
    gap: spacing['3'],
    padding: spacing['4'],
    borderRadius: radius.lg,
  },
  warningTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  context: {
    gap: spacing['1'],
  },
  flex: {
    flex: 1,
  },
  failed: {
    alignItems: 'center',
    gap: spacing['3'],
    paddingTop: spacing['8'],
  },
  failedIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
