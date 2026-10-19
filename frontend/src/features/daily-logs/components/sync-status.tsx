import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CircleAlert, Clock, CloudCheck, RefreshCw, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Tag, type TagTone } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { FIELD_LABELS } from '@/features/daily-logs/components/daily-log-values';
import { describeConflict, type DisplaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import type { LocalDailyLog } from '@/features/daily-logs/offline/local-daily-log';
import { t, type TranslationKey } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Texto, icono y tono de cada estado: nunca solo color. */
const STATUS: Record<DisplaySyncStatus, { icon: LucideIcon; tone: TagTone; label: TranslationKey }> = {
  synced: { icon: CloudCheck, tone: 'success', label: 'dailyLogs.sync.synced' },
  pending: { icon: Clock, tone: 'neutral', label: 'dailyLogs.sync.pending' },
  syncing: { icon: RefreshCw, tone: 'neutral', label: 'dailyLogs.sync.syncing' },
  conflict: { icon: TriangleAlert, tone: 'danger', label: 'dailyLogs.sync.conflict' },
  failed: { icon: CircleAlert, tone: 'danger', label: 'dailyLogs.sync.failed' },
};

export function syncStatusLabel(status: DisplaySyncStatus): string {
  return t(STATUS[status].label);
}

/** Estado de sincronización en una etiqueta (icono + texto). */
export function SyncStatusTag({ status }: { status: DisplaySyncStatus }) {
  const spec = STATUS[status];
  return <Tag label={t(spec.label)} tone={spec.tone} icon={spec.icon} />;
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

/**
 * Estado de sincronización de un registro, con su explicación y «Reintentar». Conflicto o fallo: una
 * alerta que se queda hasta resolverse (los datos siguen en el dispositivo). Lo demás: una etiqueta.
 */
export function SyncStatus({ status, record, onRetry, onResolve }: SyncStatusProps) {
  const [retrying, setRetrying] = useState(false);
  const needsAttention = status === 'conflict' || status === 'failed';
  // En conflicto, la pantalla de resolución ya vuelve a comprobar el servidor.
  const canRetry =
    onRetry !== undefined &&
    (status === 'failed' ||
      (status === 'conflict' && onResolve === undefined) ||
      (status === 'pending' && record?.error != null));
  const details = statusDetail(record, status);

  const retryButton = canRetry ? (
    <Button
      variant="secondary"
      size="md"
      label={t('dailyLogs.sync.retry')}
      loading={retrying}
      onPress={() => {
        if (retrying) return;
        setRetrying(true);
        void onRetry().finally(() => setRetrying(false));
      }}
    />
  ) : null;

  if (needsAttention) {
    return (
      <View style={styles.container}>
        <Alert
          tone="error"
          icon={STATUS[status].icon}
          title={syncStatusLabel(status)}
          message={details.join(' ')}
          action={
            onResolve
              ? {
                  label: t(status === 'conflict' ? 'dailyLogs.resolve.open' : 'dailyLogs.resolve.openDetails'),
                  onPress: onResolve,
                }
              : undefined
          }
        />
        {retryButton}
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <SyncStatusTag status={status} />
      {details.map((line) => (
        <Text key={line} variant="caption" color="inkMuted">
          {line}
        </Text>
      ))}
      {retryButton}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
});
