import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ChevronRight, Plus, Stethoscope } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import type { Analysis } from '@/features/ai-analysis/ai-analysis-model';
import { ConsultGate } from '@/features/ai-analysis/components/consult-gate';
import { UrgencyTag } from '@/features/ai-analysis/components/consult-parts';
import { usePetAnalyses } from '@/features/ai-analysis/hooks/use-ai-analysis';
import type { Pet } from '@/features/pets/types';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { borderWidth, spacing } from '@/theme/tokens';

/** Consultas anteriores de una mascota (tablero 7.14). Las ven todos sus miembros. */
export default function ConsultListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ConsultGate petId={id}>{(pet, canEdit) => <ConsultList pet={pet} canEdit={canEdit} />}</ConsultGate>;
}

function ConsultList({ pet, canEdit }: { pet: Pet; canEdit: boolean }) {
  const router = useRouter();
  const analyses = usePetAnalyses(pet.id);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const openNew = () => router.push({ pathname: '/pets/[id]/consult/new', params: { id: pet.id } });

  return (
    <Screen
      align="top"
      footer={canEdit ? <Button label={t('consult.list.new')} icon={Plus} onPress={openNew} /> : undefined}>
      <TopBar onBack={close} title={tf('consult.list.title', { name: pet.name })} />
      {analyses.isPending ? (
        <LoadingState />
      ) : analyses.isError ? (
        <ErrorState message={tf('consult.list.loadError', { name: pet.name })} onRetry={() => void analyses.refetch()} />
      ) : analyses.data.length === 0 ? (
        <EmptyState icon={Stethoscope} title={t('consult.list.emptyTitle')} description={t('consult.list.emptyText')} />
      ) : (
        <Card flush>
          {analyses.data.map((analysis, index) => (
            <AnalysisRow
              key={analysis.id}
              analysis={analysis}
              divider={index < analyses.data.length - 1}
              onPress={() => router.push({ pathname: '/pets/[id]/consult/[analysisId]', params: { id: pet.id, analysisId: analysis.id } })}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function AnalysisRow({ analysis, divider, onPress }: { analysis: Analysis; divider: boolean; onPress: () => void }) {
  const theme = useTheme();
  const date = formatFullDate(new Date(analysis.created_at), getLocale());
  const status =
    analysis.status === 'completed' && analysis.urgency_level
      ? t(`consult.result.urgency.${analysis.urgency_level}`)
      : analysis.status === 'failed'
        ? t('consult.list.failed')
        : t('consult.list.preparing');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${date}. ${status}`} onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.row, divider && { borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.line }]}>
          {pressed ? <PressedOverlay /> : null}
          <View style={styles.text}>
            <Text variant="caption" color="inkMuted">
              {date}
            </Text>
            {analysis.status === 'completed' && analysis.urgency_level ? (
              <UrgencyTag level={analysis.urgency_level} />
            ) : (
              <Tag label={status} tone={analysis.status === 'failed' ? 'danger' : 'neutral'} />
            )}
            {analysis.possible_causes?.[0] ? (
              <Text color="inkMuted" numberOfLines={2}>
                {analysis.possible_causes[0]}
              </Text>
            ) : null}
          </View>
          <Icon icon={ChevronRight} size="sm" color="inkSubtle" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: spacing['3'],
    paddingHorizontal: spacing['4'],
  },
  text: {
    flex: 1,
    gap: 6,
  },
});
