import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { CircleAlert, Clock, Lock, RefreshCw, Trash, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Tag, type TagTone } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { usePetContentLines } from '@/features/pets/components/pet-sync-status';
import { usePetSyncActions } from '@/features/pets/hooks/use-pet-writes';
import { canUndoPetDelete, contentOf, type LocalPetOperation, type PetDeleteDisplay } from '@/features/pets/offline/pet-operation';
import { t, tf, type TranslationKey } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Texto, icono y tono de cada estado de una eliminación: nunca solo color. */
const STATUS: Record<PetDeleteDisplay, { icon: LucideIcon; tone: TagTone }> = {
  pending: { icon: Clock, tone: 'neutral' },
  syncing: { icon: RefreshCw, tone: 'neutral' },
  uncertain: { icon: RefreshCw, tone: 'neutral' },
  conflict: { icon: TriangleAlert, tone: 'danger' },
  failed: { icon: CircleAlert, tone: 'danger' },
  forbidden: { icon: Lock, tone: 'danger' },
  deleted: { icon: Trash, tone: 'neutral' },
};

export function petDeleteLabel(display: PetDeleteDisplay): string {
  return t(`pets.deletion.status.${display}` as TranslationKey);
}

/** Estado de una eliminación en una etiqueta (icono + texto). */
export function PetDeleteTag({ display }: { display: PetDeleteDisplay | null }) {
  if (!display) return null;
  const spec = STATUS[display];
  return <Tag label={petDeleteLabel(display)} tone={spec.tone} icon={spec.icon} />;
}

/**
 * Registros diarios de la mascota que solo están en este dispositivo (`null` mientras se leen o si no
 * se pueden leer: entonces no se afirma que no haya).
 */
export function usePendingDailyLogCount(petId: string | null): number | null {
  const { view } = useUnsyncedDailyLogs();
  if (petId === null || view.state !== 'ready') return null;
  return view.items.filter((item) => item.record.petId === petId).length;
}

/** Aviso de los registros diarios sin sincronizar de una mascota que se elimina (se conservan). */
export function PendingDailyLogsNote({ petId }: { petId: string | null }) {
  const count = usePendingDailyLogCount(petId);
  if (!count) return null;
  return (
    <Alert
      tone="info"
      message={count === 1 ? t('pets.deletion.pendingLogsOne') : tf('pets.deletion.pendingLogs', { count })}
    />
  );
}

type PetDeletionNoticeProps = {
  op: LocalPetOperation;
  display: PetDeleteDisplay;
  /** La eliminación dejó de existir en el dispositivo sin deshacerse (confirmada o ya no estaba). */
  onClosed?: () => void;
};

/**
 * Estado de una eliminación guardada en el dispositivo y lo que se puede hacer: deshacerla mientras el
 * servidor no la haya podido aplicar, reintentar y, en un conflicto, ver la versión actual y decidir
 * (conservar o eliminar igualmente, con confirmación). Nunca se borra nada sin que el usuario lo vea.
 */
export function PetDeletionNotice({ op, display, onClosed }: PetDeletionNoticeProps) {
  const toast = useToast();
  const actions = usePetSyncActions();
  const lines = usePetContentLines();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const remote = op.status === 'conflict' ? op.conflictRemote : null;
  const detailKey = display === 'conflict' && !remote ? 'conflictChecking' : display;
  const name = (remote ?? op.baseRow)?.name ?? op.content.name;

  const undo = async () => {
    const outcome = await actions.undoDelete(op.localId);
    toast({ message: outcome === 'restored' ? t('pets.deletion.undone') : t('pets.deletion.undoUnavailable') });
  };

  const decide = async (decision: 'keep' | 'delete') => {
    if (!remote) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await actions.resolveDeleteConflict(op.localId, { decision, shownRemote: remote });
      if (outcome === 'kept') toast({ message: t('pets.deletion.kept') });
      else if (outcome === 'synced') {
        toast({ message: t('pets.deletion.deleted') });
        onClosed?.();
      } else if (outcome === 'gone') {
        toast({ message: t('pets.deletion.gone') });
        onClosed?.();
      } else if (outcome === 'conflict') setMessage(t('pets.deletion.changedAgain'));
      else if (outcome === 'unavailable') setMessage(t('pets.deletion.checkUnavailable'));
      else if (outcome === 'pending') toast({ message: t('pets.deletion.savedLocally') });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const retry =
    display === 'pending' || display === 'failed' || display === 'uncertain' || (display === 'conflict' && !remote)
      ? { label: t('pets.deletion.retry'), onPress: () => void actions.retry(op.localId) }
      : undefined;
  const danger = display === 'conflict' || display === 'failed' || display === 'forbidden';

  return (
    <View style={styles.container}>
      <Alert
        tone={danger ? 'warning' : 'info'}
        icon={STATUS[display].icon}
        title={petDeleteLabel(display)}
        message={t(`pets.deletion.detail.${detailKey}` as TranslationKey)}
        action={retry}
      />
      {message ? <Alert tone="warning" message={message} /> : null}

      {remote ? (
        <>
          <Card style={styles.data}>
            <Text variant="caption" color="inkMuted">
              {t('pets.deletion.currentVersion')}
            </Text>
            {lines(contentOf(remote)).map((line) => (
              <Text key={line.label} variant="caption" selectable>
                {`${line.label}: ${line.value}`}
              </Text>
            ))}
          </Card>
          <Button variant="secondary" size="md" label={t('pets.deletion.keep')} loading={busy} onPress={() => void decide('keep')} />
          <Button
            variant="dangerGhost"
            size="md"
            icon={Trash}
            label={t('pets.deletion.deleteAnyway')}
            disabled={busy}
            onPress={() => setConfirming(true)}
          />
        </>
      ) : canUndoPetDelete(op) && display !== 'syncing' ? (
        <Button variant="secondary" size="md" label={t('pets.deletion.undo')} onPress={() => void undo()} />
      ) : null}

      {display !== 'deleted' ? <PendingDailyLogsNote petId={op.petId} /> : null}

      <Dialog
        visible={confirming}
        tone="danger"
        icon={Trash}
        title={tf('pets.deletion.deleteAnywayTitle', { name })}
        message={t('pets.deletion.deleteAnywayText')}
        confirmLabel={t('pets.deletion.deleteAnyway')}
        loading={busy}
        onConfirm={() => void decide('delete')}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
  data: {
    gap: spacing['1'],
  },
});
