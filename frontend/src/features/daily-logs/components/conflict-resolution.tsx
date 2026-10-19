import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { FIELD_LABELS, formatUnitValue } from '@/features/daily-logs/components/daily-log-values';
import { SyncStatus } from '@/features/daily-logs/components/sync-status';
import { NOTES_MAX_LENGTH, UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH } from '@/features/daily-logs/daily-log-form';
import {
  useDiscardLocalDailyLogChanges,
  useRequestDailyLogSync,
  useResolveDailyLogConflict,
  useRetryDailyLogSync,
} from '@/features/daily-logs/hooks/use-daily-log';
import { contentFromRow, type DailyLogContent } from '@/features/daily-logs/offline/daily-log-content';
import {
  MERGE_UNITS,
  buildResolvedContent,
  compareDailyLogVersions,
  suggestCombinedText,
  type MergeResolution,
  type MergeUnit,
  type ResolutionStrategy,
  type UnitChange,
} from '@/features/daily-logs/offline/daily-log-merge';
import {
  syncKey,
  type ConflictResolutionInput,
  type ConflictResolutionOutcome,
  type DiscardOutcome,
} from '@/features/daily-logs/offline/daily-log-sync-engine';
import type { LocalDailyLog } from '@/features/daily-logs/offline/local-daily-log';
import { useSyncingKey } from '@/features/daily-logs/sync/daily-log-sync-provider';
import type { DailyLog } from '@/features/daily-logs/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

/**
 * Detalle de un registro con cambios sin confirmar: conflicto (comparar y decidir), no se pudo
 * sincronizar (motivo, reintentar o descartar la copia del dispositivo) o pendiente de enviar. Nada se
 * guarda en el servidor hasta que se confirma (`engine.resolveConflict`); descartar es solo local
 * (`engine.discardLocalChanges`). Tus datos del dispositivo se ven siempre, para poder copiarlos.
 */

type ConflictResolutionProps = {
  petId: string;
  logDate: string;
  record: LocalDailyLog | null;
  /** Vuelve al registro (al terminar o si no hay nada que resolver). */
  onDone: () => void;
};

const UNITS: (MergeUnit | 'tags')[] = [...MERGE_UNITS, 'tags'];
const TEXT_UNITS: Partial<Record<MergeUnit, { column: 'notes' | 'unusual_behavior_notes'; max: number }>> = {
  notes: { column: 'notes', max: NOTES_MAX_LENGTH },
  unusual_behavior: { column: 'unusual_behavior_notes', max: UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH },
};

type Outcome = ConflictResolutionOutcome | DiscardOutcome;

const OUTCOME_MESSAGES: Record<Outcome, TranslationKey> = {
  synced: 'dailyLogs.resolve.outcome.synced',
  pending: 'dailyLogs.resolve.outcome.pending',
  conflict: 'dailyLogs.resolve.outcome.conflict',
  failed: 'dailyLogs.resolve.outcome.failed',
  unavailable: 'dailyLogs.resolve.outcome.unavailable',
  not_in_conflict: 'dailyLogs.resolve.outcome.notInConflict',
  discarded: 'dailyLogs.resolve.outcome.discarded',
  not_discardable: 'dailyLogs.resolve.outcome.notDiscardable',
  remote_unknown: 'dailyLogs.resolve.outcome.remoteUnknown',
};

/** Explicación principal según el estado: no se mezcla "no se pudo" con "hasta que decidas". */
const INTRO: Record<'pending' | 'failed' | 'conflict', TranslationKey> = {
  conflict: 'dailyLogs.resolve.kept',
  failed: 'dailyLogs.resolve.keptFailed',
  pending: 'dailyLogs.resolve.keptPending',
};

export function ConflictResolution({ petId, logDate, record, onDone }: ConflictResolutionProps) {
  const resolve = useResolveDailyLogConflict();
  const discard = useDiscardLocalDailyLogChanges();
  const retry = useRetryDailyLogSync();
  const requestSync = useRequestDailyLogSync();
  const online = useIsOnline();
  const syncing = useSyncingKey() === syncKey(petId, logDate);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState(false);
  // Última comprobación de la fila remota pedida desde aquí terminada (con o sin éxito).
  const [checkFinished, setCheckFinished] = useState(false);

  const needsRemote = record?.status === 'conflict' && record.conflict?.remote.status === 'not_fetched';
  // Al abrir (o al recuperar la conexión), si todavía no se ha leído la fila remota, se pide (la lee
  // el motor). Sin conexión no se intenta: se explica y quedan las acciones locales.
  useEffect(() => {
    if (!needsRemote || !online) return;
    let current = true;
    void requestSync().finally(() => {
      if (current) setCheckFinished(true);
    });
    return () => {
      current = false;
    };
  }, [needsRemote, online, requestSync]);

  const submit = (input: ConflictResolutionInput) => {
    if (saving) return;
    setSaving(true);
    setOutcome(null);
    resolve(petId, logDate, input)
      .then(setOutcome, () => setOutcome('unavailable'))
      .finally(() => setSaving(false));
  };

  const submitDiscard = () => {
    if (saving) return;
    setSaving(true);
    setOutcome(null);
    discard(petId, logDate)
      .then(setOutcome, () => setOutcome('not_discardable'))
      .finally(() => setSaving(false));
  };

  const retryCheck = async () => {
    setCheckFinished(false);
    try {
      await retry(petId, logDate);
    } finally {
      setCheckFinished(true);
    }
  };

  const outcomeMessage = outcome ? (
    <FormMessage
      tone={outcome === 'synced' || outcome === 'discarded' ? 'success' : 'error'}
      message={t(OUTCOME_MESSAGES[outcome])}
    />
  ) : null;

  if (!record?.pending || record.status === 'synced') {
    return (
      <View style={styles.container}>
        {outcomeMessage ?? (
          <Text color="inkMuted">{t('dailyLogs.resolve.nothingToResolve')}</Text>
        )}
        <Button variant="secondary" size="md" label={t('dailyLogs.resolve.back')} onPress={onDone} />
      </View>
    );
  }

  const local = record.pending.content;
  const remote = record.conflict?.remote;
  // Descartar es posible si el servidor rechazó el cambio o si se conoce la versión del servidor.
  const canDiscard = record.status === 'failed' || (record.status === 'conflict' && !needsRemote);
  const remoteCheck = !needsRemote
    ? null
    : !online
      ? 'dailyLogs.resolve.remoteCheck.offline'
      : syncing || !checkFinished
        ? 'dailyLogs.resolve.remoteCheck.checking'
        : 'dailyLogs.resolve.remoteCheck.failed';

  return (
    <View style={styles.container}>
      <Text>{t(INTRO[record.status])}</Text>
      <SyncStatus
        status={record.status}
        record={record}
        onRetry={
          record.status === 'failed' || (record.status === 'pending' && record.error)
            ? () => retry(petId, logDate)
            : undefined
        }
      />

      {remoteCheck ? (
        <View style={styles.section} accessibilityLiveRegion="polite">
          <Text variant="caption" color="inkMuted">
            {t(remoteCheck)}
          </Text>
          {remoteCheck === 'dailyLogs.resolve.remoteCheck.failed' ? (
            <Button variant="secondary" size="md" label={t('dailyLogs.sync.retry')} onPress={() => void retryCheck()} />
          ) : null}
        </View>
      ) : null}

      {record.status === 'failed' && record.error?.kind === 'permission' ? (
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.resolve.permissionHelp')}
        </Text>
      ) : null}

      {remote?.status === 'absent' ? (
        <DeletedRemote local={local} saving={saving} onSubmit={submit} />
      ) : null}

      {remote?.status === 'present' ? (
        <Comparison
          // Versión nueva del servidor → se vuelve a empezar la decisión.
          key={remote.row.updated_at}
          base={record.serverRow ? contentFromRow(record.serverRow) : null}
          local={local}
          remoteRow={remote.row}
          saving={saving}
          onSubmit={submit}
          onDecisionChange={() => setOutcome(null)}
        />
      ) : null}

      {outcomeMessage}
      {outcome === 'synced' ? <Button label={t('dailyLogs.resolve.back')} onPress={onDone} /> : null}

      <LocalValues content={local} />

      {canDiscard ? <DiscardLocalCopy saving={saving} onConfirm={submitDiscard} /> : null}
    </View>
  );
}

/** El registro ya no está en el servidor: volver a crearlo, siempre a petición (o descartar, abajo). */
function DeletedRemote({
  local,
  saving,
  onSubmit,
}: {
  local: DailyLogContent;
  saving: boolean;
  onSubmit: (input: ConflictResolutionInput) => void;
}) {
  return (
    <View style={styles.section}>
      <Text variant="caption" color="inkMuted">
        {t('dailyLogs.resolve.deletedExplanation')}
      </Text>
      <Button
        label={t('dailyLogs.resolve.recreate')}
        loading={saving}
        // Tu versión, sobre «no existe» → se envía con `p_expect_absent`.
        onPress={() => onSubmit({ action: 'save', content: local, shownRemote: null })}
      />
    </View>
  );
}

/**
 * Descartar la copia de este dispositivo (cambios fallidos o en conflicto), con confirmación en dos
 * pasos. Solo local: no borra ni cambia nada en el servidor, y el texto lo dice para no confundirlo
 * con eliminar el registro.
 */
function DiscardLocalCopy({ saving, onConfirm }: { saving: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card variant="flat">
      <Text variant="bodyStrong">{t('dailyLogs.resolve.discardLocal.title')}</Text>
      <Text variant="caption" color="inkMuted">
        {t('dailyLogs.resolve.discardLocal.explanation')}
      </Text>
      {confirming ? (
        <>
          <Alert tone="warning" message={t('dailyLogs.resolve.discardLocal.confirm')} />
          <Button variant="secondary" size="md" label={t('common.cancel')} onPress={() => setConfirming(false)} />
          <Button
            variant="danger"
            size="md"
            label={t('dailyLogs.resolve.discardLocal.confirmButton')}
            loading={saving}
            onPress={onConfirm}
          />
        </>
      ) : (
        <Button
          variant="dangerGhost"
          size="md"
          label={t('dailyLogs.resolve.discardLocal.action')}
          onPress={() => setConfirming(true)}
        />
      )}
    </Card>
  );
}

const CHANGE_HINTS: Record<Exclude<UnitChange, 'same'>, TranslationKey> = {
  local_only: 'dailyLogs.resolve.change.localOnly',
  remote_only: 'dailyLogs.resolve.change.remoteOnly',
  conflict: 'dailyLogs.resolve.change.conflict',
  merged: 'dailyLogs.resolve.change.merged',
};

type UnitChoice = 'local' | 'remote' | 'text';

/** Tu versión y la del servidor, dato a dato, y la decisión. */
function Comparison({
  base,
  local,
  remoteRow,
  saving,
  onSubmit,
  onDecisionChange,
}: {
  base: DailyLogContent | null;
  local: DailyLogContent;
  remoteRow: DailyLog;
  saving: boolean;
  onSubmit: (input: ConflictResolutionInput) => void;
  /** Al cambiar la decisión deja de verse el resultado del intento anterior. */
  onDecisionChange: () => void;
}) {
  const theme = useTheme();
  const remote = contentFromRow(remoteRow);
  const units = compareDailyLogVersions({ base, local, remote });
  const differing = units.filter((item) => item.change !== 'same');
  const conflicts = differing.filter((item) => item.change === 'conflict');
  const [strategy, setStrategy] = useState<ResolutionStrategy | null>(null);
  const [choices, setChoices] = useState<Partial<Record<MergeUnit, UnitChoice>>>({});
  const [texts, setTexts] = useState<Partial<Record<MergeUnit, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const resolutions: Partial<Record<MergeUnit, MergeResolution>> = {};
  for (const [unit, choice] of Object.entries(choices) as [MergeUnit, UnitChoice][]) {
    resolutions[unit] = choice === 'text' ? { text: texts[unit] ?? '' } : choice;
  }
  const result = strategy ? buildResolvedContent({ base, local, remote }, strategy, resolutions) : null;

  const strategyOptions: Option<ResolutionStrategy>[] = [
    { value: 'local', label: t('dailyLogs.resolve.keepMine') },
    { value: 'remote', label: t('dailyLogs.resolve.keepServer') },
    { value: 'combine', label: t('dailyLogs.resolve.combine') },
  ];

  const save = () => {
    if (!result || result.status === 'incomplete') {
      setError(t('dailyLogs.resolve.errors.incomplete'));
      return;
    }
    if (result.status === 'invalid') {
      setError(t(result.reason === 'too_long' ? 'dailyLogs.resolve.errors.tooLong' : 'dailyLogs.resolve.errors.incomplete'));
      return;
    }
    if (result.status === 'unresolved') {
      setError(t('dailyLogs.resolve.errors.empty'));
      return;
    }
    setError(null);
    onSubmit({ action: 'save', content: result.content, shownRemote: remoteRow });
  };

  const namesWith = (change: UnitChange) =>
    differing.filter((item) => item.change === change).map((item) => t(FIELD_LABELS[item.unit]));

  return (
    <View style={styles.section}>
      <Text variant="bodyStrong">{t('dailyLogs.resolve.differences')}</Text>
      {differing.map((item) => (
        <View
          key={item.unit}
          style={[
            styles.card,
            { borderColor: item.change === 'conflict' ? theme.dangerInk : theme.line, backgroundColor: theme.surface },
          ]}
          accessible
          accessibilityLabel={[
            t(FIELD_LABELS[item.unit]),
            `${t('dailyLogs.resolve.mine')}: ${formatUnitValue(item.unit, item.local)}`,
            `${t('dailyLogs.resolve.server')}: ${formatUnitValue(item.unit, item.remote)}`,
            t(CHANGE_HINTS[item.change as Exclude<UnitChange, 'same'>]),
          ].join('. ')}>
          <Text variant="bodyStrong">{t(FIELD_LABELS[item.unit])}</Text>
          <View style={styles.versions}>
            <View style={[styles.version, { backgroundColor: theme.surfaceBrand }]}>
              <Text variant="overline" color="inkMuted">
                {t('dailyLogs.resolve.mine')}
              </Text>
              <Text variant="label">{formatUnitValue(item.unit, item.local)}</Text>
            </View>
            <View style={[styles.version, { backgroundColor: theme.surfaceSunken }]}>
              <Text variant="overline" color="inkMuted">
                {t('dailyLogs.resolve.server')}
              </Text>
              <Text variant="label">{formatUnitValue(item.unit, item.remote)}</Text>
            </View>
          </View>
          <Text variant="caption" color={item.change === 'conflict' ? 'dangerInk' : 'inkMuted'}>
            {t(CHANGE_HINTS[item.change as Exclude<UnitChange, 'same'>])}
          </Text>
        </View>
      ))}
      {differing.length < units.length ? (
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.resolve.restSame')}
        </Text>
      ) : null}

      <OptionGroup
        label={t('dailyLogs.resolve.decision')}
        options={strategyOptions}
        value={strategy}
        onChange={(value) => {
          setStrategy(value);
          setError(null);
          onDecisionChange();
        }}
      />

      {strategy === 'combine' ? (
        <View style={styles.section}>
          {namesWith('local_only').length ? (
            <Text variant="caption">{`${t('dailyLogs.resolve.autoMine')} ${namesWith('local_only').join(', ')}.`}</Text>
          ) : null}
          {namesWith('remote_only').length ? (
            <Text variant="caption">{`${t('dailyLogs.resolve.autoServer')} ${namesWith('remote_only').join(', ')}.`}</Text>
          ) : null}
          {namesWith('merged').length ? (
            <Text variant="caption">{t('dailyLogs.resolve.autoTags')}</Text>
          ) : null}
          {conflicts.map((item) => {
            const unit = item.unit as MergeUnit;
            const text = TEXT_UNITS[unit];
            const bothHaveText =
              text !== undefined && Boolean(item.local[text.column]) && Boolean(item.remote[text.column]);
            const options: Option<UnitChoice>[] = [
              { value: 'local', label: t('dailyLogs.resolve.chooseMine') },
              { value: 'remote', label: t('dailyLogs.resolve.chooseServer') },
              ...(bothHaveText ? [{ value: 'text' as const, label: t('dailyLogs.resolve.chooseBoth') }] : []),
            ];
            return (
              <View key={unit} style={styles.section}>
                <OptionGroup
                  label={`${t('dailyLogs.resolve.decideFor')} ${t(FIELD_LABELS[unit])}`}
                  options={options}
                  value={choices[unit] ?? null}
                  onChange={(value) => {
                    setChoices((current) => ({ ...current, [unit]: value }));
                    if (value === 'text' && text && texts[unit] === undefined) {
                      // «Conservar ambas» solo como propuesta editable: se guarda lo que el usuario revise.
                      const suggestion = suggestCombinedText(
                        (item.local[text.column] as string | null) ?? null,
                        (item.remote[text.column] as string | null) ?? null
                      );
                      setTexts((current) => ({ ...current, [unit]: suggestion ?? '' }));
                    }
                    setError(null);
                  }}
                />
                {choices[unit] === 'text' && text ? (
                  <TextField
                    label={t('dailyLogs.resolve.reviewCombined')}
                    hint={t('dailyLogs.resolve.reviewCombinedHint')}
                    error={(texts[unit]?.trim().length ?? 0) > text.max ? t('dailyLogs.resolve.errors.tooLong') : null}
                    value={texts[unit] ?? ''}
                    onChangeText={(value) => setTexts((current) => ({ ...current, [unit]: value }))}
                    multiline
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {result?.status === 'merged' ? (
        <View style={styles.section}>
          <Text variant="bodyStrong">{t('dailyLogs.resolve.result')}</Text>
          {differing.map((item) => (
            <Text key={item.unit} variant="caption">
              {`${t(FIELD_LABELS[item.unit])}: ${formatUnitValue(item.unit, result.content)}`}
            </Text>
          ))}
        </View>
      ) : null}

      <FormMessage message={error} />
      <Button label={t('dailyLogs.resolve.save')} disabled={strategy === null} loading={saving} onPress={save} />
    </View>
  );
}

/** Tus datos tal como están en el dispositivo, seleccionables para copiarlos. */
function LocalValues({ content }: { content: DailyLogContent }) {
  return (
    <Card variant="flat">
      <Text variant="bodyStrong">{t('dailyLogs.resolve.localValues')}</Text>
      {UNITS.map((unit) => (
        <Text key={unit} variant="caption" selectable>
          {`${t(FIELD_LABELS[unit])}: ${formatUnitValue(unit, content)}`}
        </Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['5'],
  },
  section: {
    gap: spacing['3'],
  },
  card: {
    gap: spacing['2'],
    padding: spacing['3'],
    borderWidth: 1,
    borderRadius: radius.md,
  },
  // Tablero 5.9: las dos versiones lado a lado; la del móvil sobre fondo de marca.
  versions: {
    flexDirection: 'row',
    gap: 10,
  },
  version: {
    flex: 1,
    gap: spacing['1'],
    padding: 10,
    borderRadius: radius.sm,
  },
});
