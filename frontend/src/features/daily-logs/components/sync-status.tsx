import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { FIELD_LABELS } from '@/features/daily-logs/components/daily-log-values';
import { describeConflict, type DisplaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import type { LocalDailyLog } from '@/features/daily-logs/offline/local-daily-log';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';

/** Texto y símbolo de cada estado: nunca solo color. */
const STATUS: Record<DisplaySyncStatus, { symbol: string; label: TranslationKey }> = {
  synced: { symbol: '✓', label: 'dailyLogs.sync.synced' },
  pending: { symbol: '•', label: 'dailyLogs.sync.pending' },
  syncing: { symbol: '↻', label: 'dailyLogs.sync.syncing' },
  conflict: { symbol: '!', label: 'dailyLogs.sync.conflict' },
  failed: { symbol: '!', label: 'dailyLogs.sync.failed' },
};


export function syncStatusLabel(status: DisplaySyncStatus): string {
  return `${STATUS[status].symbol} ${t(STATUS[status].label)}`;
}

/** Explicación del estado, sin mensajes del servidor ni contenido. */
function statusDetail(record: LocalDailyLog | null, status: DisplaySyncStatus): string[] {
  const error = record?.error;
  if (status === 'conflict') {
    const conflict = describeConflict(record);
    const lines =
      conflict?.remote === 'absent'
        ? [t('dailyLogs.sync.conflictDetail.deleted')]
        : conflict?.remote === 'present'
          ? [t('dailyLogs.sync.conflictDetail.changed')]
          : [t('dailyLogs.sync.conflictDetail.notCompared')];
    if (conflict?.fields.length) {
      lines.push(
        `${t('dailyLogs.sync.conflictDetail.fields')} ${conflict.fields.map((field) => t(FIELD_LABELS[field])).join(', ')}.`
      );
    }
    return [...lines, t('dailyLogs.sync.kept')];
  }
  if (status === 'failed') {
    const reason =
      error?.kind === 'permission'
        ? t('dailyLogs.sync.reason.permission')
        : error?.reason === 'log_date_too_old' || error?.reason === 'log_date_future'
          ? t('dailyLogs.sync.reason.date')
          : error?.kind === 'validation'
            ? t('dailyLogs.sync.reason.invalid')
            : t('dailyLogs.sync.reason.server');
    return [reason, t('dailyLogs.sync.kept')];
  }
  if (status === 'pending' && error) {
    if (error.kind === 'network') return [t('dailyLogs.sync.reason.waitingNetwork')];
    if (error.kind === 'auth') return [t('dailyLogs.sync.reason.waitingSession')];
    return [t('dailyLogs.sync.reason.retrying')];
  }
  return [];
}

type SyncStatusProps = {
  status: DisplaySyncStatus;
  record: LocalDailyLog | null;
  /** Reintento manual; solo se ofrece cuando tiene sentido (fallido, conflicto o en espera). */
  onRetry?: () => Promise<void>;
  /** Abre la pantalla de resolución (conflicto) o de detalle (no se pudo sincronizar). */
  onResolve?: () => void;
};

/** Estado de sincronización de un registro, con su explicación y «Reintentar». */
export function SyncStatus({ status, record, onRetry, onResolve }: SyncStatusProps) {
  const theme = useTheme();
  const [retrying, setRetrying] = useState(false);
  const needsAttention = status === 'conflict' || status === 'failed';
  // En conflicto, la pantalla de resolución ya vuelve a comprobar el servidor.
  const canRetry =
    onRetry !== undefined &&
    (status === 'failed' ||
      (status === 'conflict' && onResolve === undefined) ||
      (status === 'pending' && record?.error != null));
  const details = statusDetail(record, status);

  return (
    <View
      style={[
        styles.container,
        needsAttention && { borderColor: theme.danger, borderWidth: 1, padding: Spacing.three },
      ]}
      accessibilityLiveRegion="polite">
      <ThemedText
        type="smallBold"
        style={needsAttention ? { color: theme.danger } : undefined}
        themeColor={needsAttention ? undefined : 'textSecondary'}>
        {syncStatusLabel(status)}
      </ThemedText>
      {details.map((line) => (
        <ThemedText key={line} type="small" themeColor="textSecondary">
          {line}
        </ThemedText>
      ))}
      {needsAttention && onResolve ? (
        <Button
          label={t(status === 'conflict' ? 'dailyLogs.resolve.open' : 'dailyLogs.resolve.openDetails')}
          onPress={onResolve}
        />
      ) : null}
      {canRetry ? (
        <Button
          variant="secondary"
          label={t('dailyLogs.sync.retry')}
          loading={retrying}
          onPress={() => {
            if (retrying) return;
            setRetrying(true);
            void onRetry().finally(() => setRetrying(false));
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
    borderRadius: Spacing.two,
  },
});
