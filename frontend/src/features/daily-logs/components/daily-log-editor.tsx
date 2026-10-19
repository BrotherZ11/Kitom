import { useRouter } from 'expo-router';
import { useReducer, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Check, ChevronRight, Pencil, Plus, X } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { TopBar, TopBarText } from '@/components/ui/top-bar';
import { DetailScaleSelector, PrimaryScaleSelector } from '@/features/daily-logs/components/scale-selector';
import { SyncStatus } from '@/features/daily-logs/components/sync-status';
import { TagSelector } from '@/features/daily-logs/components/tag-selector';
import {
  DETAIL_SCALE_FIELDS,
  NOTES_MAX_LENGTH,
  PRIMARY_SCALE_FIELDS,
  UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH,
  answeredPrimaryCount,
  dailyLogEditorReducer,
  decideSourceChange,
  hasDetailValues,
  initialDailyLogEditorState,
  setAllAsUsual,
  setScale,
  toDailyLogContent,
  toggleTag,
  validateDailyLogForm,
  type DailyLogContentSource,
  type DailyLogEditorSource,
  type DailyLogFormValues,
} from '@/features/daily-logs/daily-log-form';
import { useLocalDailyLog, useRetryDailyLogSync, useSaveDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import {
  contentFromRow,
  normalizeDailyLogContent,
  sameDailyLogContent,
  type DailyLogContent,
} from '@/features/daily-logs/offline/daily-log-content';
import { syncKey } from '@/features/daily-logs/offline/daily-log-sync-engine';
import { displaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import { scaleValueLabel } from '@/features/daily-logs/scale-labels';
import { useSyncingKey } from '@/features/daily-logs/sync/daily-log-sync-provider';
import type { DailyLog } from '@/features/daily-logs/types';
import { useLeaveConfirmation } from '@/hooks/use-leave-confirmation';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { radius, spacing } from '@/theme/tokens';

export type DailyLogSaved = {
  /** Era un registro nuevo (no había nada guardado de ese día, ni en el servidor ni aquí). */
  isNew: boolean;
  content: DailyLogContent;
};

type DailyLogEditorProps = {
  petId: string;
  logDate: string;
  /** Nombre de la mascota (bajo el título); `null` si no se conoce (sin conexión). */
  petName: string | null;
  /** Título de la cabecera («Hoy, jueves 16», «Miércoles 15»). */
  title: string;
  /** Día anterior a hoy (tablero 5.4): se avisa de que se edita otro día. */
  historical: boolean;
  /** Contenido con el que se abre: lo pendiente en el dispositivo o la fila del servidor. `null` = vacío. */
  initialContent: DailyLogContentSource | null;
  /** Fila del servidor que se está editando (base de la precondición); `null` si no existía. */
  baseRow: DailyLog | null;
  /** UX (`can_edit_pet`): sin permiso, solo lectura. La autorización real es RLS. */
  canEdit: boolean;
  /** Avisos de la pantalla (sin conexión, permiso sin comprobar…), bajo la barra de progreso. */
  notices?: ReactNode;
  /** Cerrar (X): la confirmación de «salir sin guardar» la hace el editor. */
  onClose: () => void;
  /** Guardado en el dispositivo. Quien abre el editor decide a dónde ir. */
  onSaved: (saved: DailyLogSaved) => void;
};

/**
 * Registro de un día (tableros 5.1, 5.2 y 5.4–5.7). Nunca crea nada al abrirse. Guardar lo deja en el
 * dispositivo al momento (sin esperar a la red) y el motor de sincronización lo envía. Montar con
 * `key={logDate}` para empezar de cero si cambia el día.
 *
 * Al crear, las 4 escalas principales son obligatorias; al editar, basta con que no quede vacío
 * (`validateDailyLogForm`). Los detalles (5.2) son opcionales y no bloquean guardar.
 *
 * Si la pantalla trae otra versión con el formulario abierto (respuesta tardía del servidor,
 * confirmación de un guardado, conflicto resuelto), `decideSourceChange` decide: se cargan los
 * valores nuevos solo si el usuario no ha tocado nada; si ya editó, se conservan sus valores, la base
 * no cambia (la precondición detectará el cambio al guardar) y se avisa. Nunca se vuelve a montar.
 */
export function DailyLogEditor({
  petId,
  logDate,
  petName,
  title,
  historical,
  initialContent,
  baseRow,
  canEdit,
  notices,
  onClose,
  onSaved,
}: DailyLogEditorProps) {
  const theme = useTheme();
  const router = useRouter();
  const [state, dispatch] = useReducer(dailyLogEditorReducer, initialContent, initialDailyLogEditorState);
  const [submitGuard] = useState(createSubmitGuard);
  const [step, setStep] = useState<'main' | 'details'>('main');
  const saveDailyLog = useSaveDailyLog();
  const retrySync = useRetryDailyLogSync();
  const local = useLocalDailyLog(petId, logDate).data ?? null;
  const syncing = useSyncingKey() === syncKey(petId, logDate);

  // Versión con la que trabaja el formulario. Su `baseRow` es la base de la próxima operación: avanza
  // si llega una versión con el mismo contenido (p. ej. el servidor confirma lo guardado desde aquí)
  // o si se cargan sus valores; si otro dispositivo la cambió y el usuario ya editó, no (así se
  // detecta el conflicto al guardar).
  const incoming: DailyLogEditorSource = { content: initialContent, baseRow };
  const [opened, setOpened] = useState<DailyLogEditorSource>(incoming);
  const sourceChange = decideSourceChange(opened, incoming, state);
  if (sourceChange === 'adopt') {
    setOpened(incoming);
  } else if (sourceChange === 'reload') {
    setOpened(incoming);
    dispatch({ type: 'load', log: initialContent });
  }
  const reloadIncoming = () => {
    setOpened(incoming);
    dispatch({ type: 'load', log: initialContent });
  };

  const [lastSaved, setLastSaved] = useState<DailyLogContent | null>(null);
  const confirmedRow = local?.status === 'synced' ? local.serverRow : null;
  const editBase =
    confirmedRow && lastSaved && sameDailyLogContent(contentFromRow(confirmedRow), lastSaved)
      ? confirmedRow
      : opened.baseRow;
  const syncStatus = local ? displaySyncStatus(local, syncing) : opened.baseRow ? 'synced' : null;

  const { values } = state;
  const isSaving = state.status === 'saving';
  const isLocked = !canEdit || isSaving;
  // Nuevo: no hay nada guardado de ese día (ni en el servidor ni en el dispositivo).
  const isNew = opened.content === null && opened.baseRow === null && lastSaved === null;
  const answered = answeredPrimaryCount(values);
  const canSave = canEdit && (!isNew || answered === PRIMARY_SCALE_FIELDS.length);

  // «Salir sin guardar» (tablero 5.7): X, «atrás» del sistema o gesto, solo si hay cambios.
  const leave = useLeaveConfirmation(state.dirty && canEdit);

  const edit = (update: (current: DailyLogFormValues) => DailyLogFormValues) => dispatch({ type: 'edit', update });

  const handleSave = () => {
    const invalid = validateDailyLogForm(values, { requirePrimary: isNew });
    if (invalid) {
      dispatch({ type: 'invalid', error: invalid });
      return;
    }
    const content = normalizeDailyLogContent(toDailyLogContent(values));
    const wasNew = isNew;
    const pending = submitGuard.run(() => saveDailyLog.mutateAsync({ petId, logDate, content, baseRow: editBase }));
    if (!pending) return; // ya hay un guardado en curso
    dispatch({ type: 'saveStarted' });
    pending.then(
      () => {
        setLastSaved(content);
        dispatch({ type: 'saveSucceeded', log: content });
        leave.allowLeave();
        onSaved({ isNew: wasNew, content });
      },
      () => dispatch({ type: 'saveFailed', error: 'local_save_failed' })
    );
  };

  const footer = canEdit ? (
    <>
      {state.status === 'error' && state.error === 'local_save_failed' ? (
        <Alert tone="error" title={t('dailyLogs.editor.saveErrorTitle')} message={t('dailyLogs.editor.saveErrorText')} />
      ) : state.status === 'error' && state.error ? (
        <Alert tone="error" message={t(`dailyLogs.errors.${state.error}`)} />
      ) : null}
      <Button
        label={isNew ? t('dailyLogs.editor.saveNew') : t('dailyLogs.editor.saveEdit')}
        loading={isSaving}
        loadingLabel={t('dailyLogs.editor.saving')}
        disabled={!canSave}
        onPress={handleSave}
      />
    </>
  ) : undefined;

  const syncBlock = syncStatus ? (
    <SyncStatus
      status={syncStatus}
      record={local}
      onRetry={canEdit && local ? () => retrySync(petId, logDate) : undefined}
      onResolve={() =>
        router.push({ pathname: '/pets/[id]/daily-logs/resolve/[date]', params: { id: petId, date: logDate } })
      }
    />
  ) : null;

  const newerVersion =
    sourceChange === 'keep' ? (
      <Alert
        tone="info"
        message={t('dailyLogs.newerVersion.message')}
        action={{ label: t('dailyLogs.newerVersion.load'), onPress: reloadIncoming }}
      />
    ) : null;

  const discardDialog = (
    <Dialog
      visible={leave.visible}
      title={t('dailyLogs.editor.discardTitle')}
      message={t('dailyLogs.editor.discardText')}
      confirmLabel={t('dailyLogs.editor.discardKeep')}
      cancelLabel={t('dailyLogs.editor.discardLeave')}
      onConfirm={leave.stay}
      onCancel={leave.leave}
      onDismiss={leave.stay}
    />
  );

  if (step === 'details') {
    return (
      <Screen align="top" gap={22} footer={footer}>
        <TopBar
          onBack={() => setStep('main')}
          title={t('dailyLogs.editor.detailsTitle')}
          right={<TopBarText text={t('dailyLogs.editor.optional')} />}
        />
        <Text variant="caption" color="inkMuted" style={styles.detailsIntro}>
          {petName ? tf('dailyLogs.editor.detailsIntro', { name: petName }) : t('dailyLogs.editor.detailsIntroNoName')}
        </Text>
        {DETAIL_SCALE_FIELDS.map((field) => (
          <DetailScaleSelector
            key={field}
            field={field}
            value={values.scales[field]}
            disabled={isLocked}
            onChange={(value) => edit((current) => setScale(current, field, value))}
          />
        ))}
        <View style={styles.group}>
          <View style={styles.between}>
            <Text variant="title3" style={styles.flex} accessibilityRole="header">
              {t('dailyLogs.editor.unusual')}
            </Text>
            <Switch
              accessibilityLabel={t('dailyLogs.editor.unusual')}
              value={values.unusualBehavior}
              disabled={isLocked}
              onValueChange={(unusualBehavior) => edit((current) => ({ ...current, unusualBehavior }))}
            />
          </View>
          {values.unusualBehavior ? (
            <TextField
              label={t('dailyLogs.unusualBehaviorNotes')}
              placeholder={t('dailyLogs.unusualBehaviorNotes')}
              value={values.unusualBehaviorNotes}
              onChangeText={(unusualBehaviorNotes) => edit((current) => ({ ...current, unusualBehaviorNotes }))}
              editable={!isLocked}
              multiline
              maxLength={UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH}
            />
          ) : null}
        </View>
        <TagSelector value={values.tags} disabled={isLocked} onToggle={(tag) => edit((current) => toggleTag(current, tag))} />
        <TextField
          label={t('dailyLogs.editor.note')}
          placeholder={t('dailyLogs.editor.notePlaceholder')}
          value={values.notes}
          onChangeText={(notes) => edit((current) => ({ ...current, notes }))}
          editable={!isLocked}
          multiline
          maxLength={NOTES_MAX_LENGTH}
        />
        {discardDialog}
      </Screen>
    );
  }

  return (
    <Screen align="top" gap={22} footer={footer}>
      <TopBar
        onBack={onClose}
        backIcon={X}
        backLabel={t('common.close')}
        title={title}
        subtitle={petName ?? undefined}
        right={
          canEdit ? (
            <TopBarText mono text={`${answered}/4`} accessibilityLabel={tf('dailyLogs.editor.progress', { count: answered })} />
          ) : null
        }
      />
      {canEdit ? <ProgressBar value={answered / PRIMARY_SCALE_FIELDS.length} /> : null}
      {historical && canEdit ? (
        <Alert
          tone="info"
          icon={Pencil}
          title={t('dailyLogs.editor.historicalTitle')}
          message={tf('dailyLogs.editor.historicalText', { date: title })}
        />
      ) : null}
      {notices}
      {!canEdit ? (
        <Text variant="caption" color="inkMuted">
          {t('dailyLogs.readOnly')}
        </Text>
      ) : null}
      {newerVersion}
      {syncBlock}
      {canEdit && isNew ? (
        <View style={styles.chip}>
          <Chip
            accessibilityRole="button"
            accessibilityHint={t('dailyLogs.allAsUsualHint')}
            label={t('dailyLogs.allAsUsual')}
            icon={Check}
            disabled={isSaving}
            onPress={() => edit(setAllAsUsual)}
          />
        </View>
      ) : null}
      {PRIMARY_SCALE_FIELDS.map((field) => (
        <PrimaryScaleSelector
          key={field}
          field={field}
          value={values.scales[field]}
          disabled={isLocked}
          onChange={(value) => edit((current) => setScale(current, field, value))}
        />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('dailyLogs.editor.addDetails')}. ${detailsSummary(values) ?? t('dailyLogs.editor.addDetailsHint')}`}
        onPress={() => setStep('details')}>
        {({ pressed }) => (
          <View style={styles.detailsRow}>
            {pressed ? <PressedOverlay /> : null}
            <View style={[styles.iconTile, { backgroundColor: theme.surfaceBrand }]}>
              <Icon icon={Plus} size="sm" color="primary" />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{t('dailyLogs.editor.addDetails')}</Text>
              <Text variant="caption" color="inkMuted">
                {detailsSummary(values) ?? t('dailyLogs.editor.addDetailsHint')}
              </Text>
            </View>
            <Icon icon={ChevronRight} size="sm" color="inkSubtle" />
          </View>
        )}
      </Pressable>
      {discardDialog}
    </Screen>
  );
}

/** Lo ya indicado en los detalles, tal cual («Sueño: Normal · Con nota»); `null` si no hay nada. */
function detailsSummary(values: DailyLogFormValues): string | null {
  if (!hasDetailValues(values)) return null;
  const parts = DETAIL_SCALE_FIELDS.flatMap((field) => {
    const value = values.scales[field];
    return value === null ? [] : [`${t(`dailyLogs.fields.${field}`)}: ${scaleValueLabel(field, value)}`];
  });
  if (values.unusualBehavior) parts.push(t('dailyLogs.history.unusualBehavior'));
  parts.push(...values.tags.map((tag) => t(`dailyLogs.tags.${tag}`)));
  if (values.notes.trim() !== '') parts.push(t('dailyLogs.history.withNotes'));
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  group: {
    gap: 10,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
  },
  chip: {
    alignItems: 'flex-start',
  },
  detailsIntro: {
    marginTop: -10,
  },
  detailsRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    borderRadius: radius.sm,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
