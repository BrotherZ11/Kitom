import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CircleAlert, Clock, Lock, RefreshCw, Trash, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Tag, type TagTone } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { useReminderSyncActions, type ReminderSaveOutcome } from '@/features/reminders/hooks/use-reminders';
import {
  canDiscardReminderOperation,
  conflictGroups,
  type LocalReminderOperation,
  type ReminderContent,
  type ReminderFieldGroup,
  type ReminderSyncDisplay,
} from '@/features/reminders/offline/reminder-operation';
import { formatReminderLongDay, formatReminderTime } from '@/features/reminders/reminder-format';
import { getLocale, t } from '@/i18n';
import { spacing } from '@/theme/tokens';

const STATUS: Record<ReminderSyncDisplay, { icon: LucideIcon; tone: TagTone }> = {
  pending: { icon: Clock, tone: 'neutral' },
  pending_delete: { icon: Trash, tone: 'neutral' },
  syncing: { icon: RefreshCw, tone: 'neutral' },
  uncertain: { icon: RefreshCw, tone: 'neutral' },
  conflict: { icon: TriangleAlert, tone: 'danger' },
  failed: { icon: CircleAlert, tone: 'danger' },
  forbidden: { icon: Lock, tone: 'danger' },
};

export function reminderSyncLabel(display: ReminderSyncDisplay): string {
  return t(`agenda.sync.status.${display}`);
}

/** Estado de una fila o un detalle con cambios en el dispositivo (icono + texto, nunca solo color). */
export function ReminderSyncTag({ display }: { display: ReminderSyncDisplay | null }) {
  if (!display) return null;
  const spec = STATUS[display];
  return <Tag label={reminderSyncLabel(display)} tone={spec.tone} icon={spec.icon} />;
}

/** Mensaje de una acción ya guardada: confirmada por el servidor, o qué ha pasado en el dispositivo. */
export function reminderOutcomeMessage(outcome: ReminderSaveOutcome, confirmed: string): string {
  if (outcome.synced) return confirmed;
  if (outcome.display === 'conflict') return t('agenda.sync.toast.conflict');
  if (outcome.display === 'forbidden') return t('agenda.sync.toast.forbidden');
  if (outcome.display === 'failed') return t('agenda.sync.toast.failed');
  return t('agenda.sync.toast.saved');
}

function groupLines(content: ReminderContent, group: ReminderFieldGroup): string {
  const locale = getLocale();
  const when = (value: string) => {
    const date = new Date(value);
    return `${formatReminderLongDay(date, new Date(), locale)} · ${formatReminderTime(date)}`;
  };
  switch (group) {
    case 'content':
      return [t(`agenda.types.${content.type}`), content.title, content.description].filter(Boolean).join(' · ');
    case 'date':
      return [when(content.snooze_until ?? content.due_at), content.recurrence_rule ? t('agenda.sync.conflict.repeats') : null]
        .filter(Boolean)
        .join(' · ');
    case 'status':
      return content.status === 'pending' ? t('agenda.sync.conflict.pending') : t('agenda.sync.conflict.done');
    case 'active':
      return content.is_active ? t('agenda.sync.conflict.active') : t('agenda.sync.conflict.paused');
  }
}

/**
 * Estado de un recordatorio con cambios guardados en el dispositivo y lo que se puede hacer: reintentar, descartar
 * (solo si lo pide el usuario y no está en vuelo), deshacer la eliminación o decidir un conflicto. Nada se descarta
 * solo; un permiso revocado se explica y se conserva.
 */
export function ReminderSyncPanel({
  op,
  display,
  onClosed,
}: {
  op: LocalReminderOperation;
  display: ReminderSyncDisplay;
  /** El recordatorio ya no existe aquí (alta descartada o conflicto de eliminación resuelto). */
  onClosed: () => void;
}) {
  const toast = useToast();
  const actions = useReminderSyncActions();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (done) toast({ message: done });
    } catch {
      toast({ message: t('agenda.errors.localWrite') });
    } finally {
      setBusy(false);
    }
  };

  const discard = () =>
    run(async () => {
      const outcome = await actions.discard(op.localId);
      if (outcome !== 'discarded') {
        toast({ message: t('agenda.sync.toast.notDiscardable') });
        return;
      }
      toast({ message: t('agenda.sync.toast.discarded') });
      if (op.kind === 'create') onClosed();
    });

  const isDelete = op.kind === 'delete';
  const remote = op.conflictRemote;
  const message = t(isDelete && display !== 'pending_delete' && display !== 'pending' ? `agenda.sync.text.delete_${display}` : `agenda.sync.text.${display}`);
  const canDiscard = canDiscardReminderOperation(op);
  const canUndo = isDelete && op.inFlightSince === null && display !== 'syncing';

  return (
    <View style={styles.panel}>
      <Alert tone={STATUS[display].tone === 'danger' ? 'error' : 'info'} message={message} />

      {display === 'conflict' && remote && !isDelete ? (
        <Card variant="flat" style={styles.compare}>
          {conflictGroups(op).map((group) => (
            <View key={group} style={styles.group}>
              <Text variant="overline" color="inkMuted">
                {t(`agenda.sync.conflict.groups.${group}`)}
              </Text>
              <Text>
                {t('agenda.sync.conflict.mine')}: {groupLines(op.content, group)}
              </Text>
              <Text>
                {t('agenda.sync.conflict.theirs')}: {groupLines(remote, group)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <View style={styles.actions}>
        {display === 'conflict' && remote && !isDelete ? (
          <>
            <Button
              size="md"
              label={t('agenda.sync.action.keepMine')}
              disabled={busy}
              onPress={() => void run(() => actions.resolveConflict(op.localId, { choice: 'local', shownRemote: remote }), t('agenda.sync.toast.resolved'))}
            />
            <Button
              size="md"
              variant="secondary"
              label={t('agenda.sync.action.useTheirs')}
              disabled={busy}
              onPress={() => void run(() => actions.resolveConflict(op.localId, { choice: 'remote', shownRemote: remote }), t('agenda.sync.toast.resolved'))}
            />
          </>
        ) : null}
        {display === 'conflict' && remote && isDelete ? (
          <>
            <Button
              size="md"
              label={t('agenda.sync.action.keepReminder')}
              disabled={busy}
              onPress={() => void run(() => actions.resolveDeleteConflict(op.localId, { decision: 'keep', shownRemote: remote }))}
            />
            <Button
              size="md"
              variant="secondary"
              label={t('agenda.sync.action.deleteAnyway')}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const outcome = await actions.resolveDeleteConflict(op.localId, { decision: 'delete', shownRemote: remote });
                  if (outcome === 'synced' || outcome === 'gone') onClosed();
                })
              }
            />
          </>
        ) : null}
        {display === 'failed' || (display === 'pending' && op.lastError) ? (
          <Button size="md" variant="secondary" label={t('common.retry')} disabled={busy} onPress={() => void run(() => actions.retry(op.localId))} />
        ) : null}
        {canUndo && display !== 'conflict' ? (
          <Button
            size="md"
            variant="secondary"
            label={t('agenda.sync.action.undoDelete')}
            disabled={busy}
            onPress={() => void run(() => actions.undoDelete(op.localId), t('agenda.toast.undone'))}
          />
        ) : null}
        {canDiscard ? (
          <Button size="md" variant="ghost" label={t('agenda.sync.action.discard')} disabled={busy} onPress={() => void discard()} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing['2'],
  },
  compare: {
    gap: spacing['3'],
  },
  group: {
    gap: 2,
  },
  actions: {
    gap: spacing['2'],
  },
});
