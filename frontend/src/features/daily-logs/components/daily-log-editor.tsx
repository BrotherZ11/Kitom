import { useRouter } from 'expo-router';
import { useReducer, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { ScaleSelector } from '@/features/daily-logs/components/scale-selector';
import { SyncStatus } from '@/features/daily-logs/components/sync-status';
import { TagSelector } from '@/features/daily-logs/components/tag-selector';
import {
  DETAIL_SCALE_FIELDS,
  NOTES_MAX_LENGTH,
  PRIMARY_SCALE_FIELDS,
  UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH,
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
  type ScaleField,
} from '@/features/daily-logs/daily-log-form';
import {
  useLocalDailyLog,
  useRetryDailyLogSync,
  useSaveDailyLog,
} from '@/features/daily-logs/hooks/use-daily-log';
import {
  contentFromRow,
  normalizeDailyLogContent,
  sameDailyLogContent,
  type DailyLogContent,
} from '@/features/daily-logs/offline/daily-log-content';
import { syncKey } from '@/features/daily-logs/offline/daily-log-sync-engine';
import { displaySyncStatus } from '@/features/daily-logs/offline/daily-log-view';
import { useSyncingKey } from '@/features/daily-logs/sync/daily-log-sync-provider';
import type { DailyLog } from '@/features/daily-logs/types';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';

type DailyLogEditorProps = {
  petId: string;
  logDate: string;
  /** Contenido con el que se abre: lo pendiente en el dispositivo o la fila del servidor. `null` = vacío. */
  initialContent: DailyLogContentSource | null;
  /** Fila del servidor que se está editando (base de la precondición); `null` si no existía. */
  baseRow: DailyLog | null;
  /** UX (`can_edit_pet`): sin permiso, solo lectura. La autorización real es RLS. */
  canEdit: boolean;
};

/**
 * Formulario del registro de un día. Nunca crea nada al abrirse. «Guardar registro» guarda en el
 * dispositivo al momento (sin esperar a la red) y el motor de sincronización lo envía; el estado de
 * sincronización se ve debajo. Montar con `key={logDate}` para empezar de cero si cambia el día.
 *
 * Si la pantalla trae otra versión con el formulario abierto (respuesta tardía del servidor,
 * confirmación de un guardado, conflicto resuelto), `decideSourceChange` decide: se cargan los
 * valores nuevos solo si el usuario no ha tocado nada; si ya editó, se conservan sus valores, la base
 * no cambia (la precondición detectará el cambio al guardar) y se avisa. Nunca se vuelve a montar.
 */
export function DailyLogEditor({ petId, logDate, initialContent, baseRow, canEdit }: DailyLogEditorProps) {
  const theme = useTheme();
  const router = useRouter();
  const [state, dispatch] = useReducer(dailyLogEditorReducer, initialContent, initialDailyLogEditorState);
  const [submitGuard] = useState(createSubmitGuard);
  const [showDetails, setShowDetails] = useState(() => hasDetailValues(state.values));
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

  const edit = (update: (current: DailyLogFormValues) => DailyLogFormValues) =>
    dispatch({ type: 'edit', update });

  const handleSave = () => {
    const invalid = validateDailyLogForm(values);
    if (invalid) {
      dispatch({ type: 'invalid', error: invalid });
      return;
    }
    const content = normalizeDailyLogContent(toDailyLogContent(values));
    const pending = submitGuard.run(() =>
      saveDailyLog.mutateAsync({ petId, logDate, content, baseRow: editBase })
    );
    if (!pending) return; // ya hay un guardado en curso
    dispatch({ type: 'saveStarted' });
    pending.then(
      () => {
        setLastSaved(content);
        dispatch({ type: 'saveSucceeded', log: content });
      },
      () => dispatch({ type: 'saveFailed', error: 'local_save_failed' })
    );
  };

  const renderScale = (field: ScaleField) => (
    <ScaleSelector
      key={field}
      field={field}
      value={values.scales[field]}
      disabled={isLocked}
      onChange={(value) => edit((current) => setScale(current, field, value))}
    />
  );

  if (!canEdit && !initialContent) {
    return (
      <ThemedText themeColor="textSecondary" style={styles.center}>
        {t('dailyLogs.emptyReadOnly')}
      </ThemedText>
    );
  }

  return (
    <View style={styles.container}>
      {sourceChange === 'keep' ? (
        <View style={[styles.notice, { borderColor: theme.border }]} accessibilityLiveRegion="polite">
          <ThemedText type="small">{t('dailyLogs.newerVersion.message')}</ThemedText>
          <Button variant="secondary" label={t('dailyLogs.newerVersion.load')} onPress={reloadIncoming} />
        </View>
      ) : null}

      {canEdit ? (
        <View style={styles.group}>
          <Button
            variant="secondary"
            label={t('dailyLogs.allAsUsual')}
            disabled={isSaving}
            onPress={() => edit(setAllAsUsual)}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('dailyLogs.allAsUsualHint')}
          </ThemedText>
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('dailyLogs.readOnly')}
        </ThemedText>
      )}

      {PRIMARY_SCALE_FIELDS.map(renderScale)}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetails }}
        onPress={() => setShowDetails((current) => !current)}
        style={[styles.toggle, { borderColor: theme.border }]}>
        <ThemedText type="smallBold">
          {showDetails ? t('dailyLogs.lessDetails') : t('dailyLogs.moreDetails')}
        </ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {showDetails ? '▲' : '▼'}
        </ThemedText>
      </Pressable>
      {showDetails ? DETAIL_SCALE_FIELDS.map(renderScale) : null}

      <View style={styles.switchRow}>
        <ThemedText type="smallBold" style={styles.flex}>
          {t('dailyLogs.unusualBehavior')}
        </ThemedText>
        <Switch
          accessibilityLabel={t('dailyLogs.unusualBehavior')}
          value={values.unusualBehavior}
          disabled={isLocked}
          onValueChange={(unusualBehavior) => edit((current) => ({ ...current, unusualBehavior }))}
        />
      </View>
      {values.unusualBehavior ? (
        <TextField
          label={t('dailyLogs.unusualBehaviorNotes')}
          value={values.unusualBehaviorNotes}
          onChangeText={(unusualBehaviorNotes) =>
            edit((current) => ({ ...current, unusualBehaviorNotes }))
          }
          editable={!isLocked}
          multiline
          maxLength={UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH}
        />
      ) : null}

      <TagSelector
        value={values.tags}
        disabled={isLocked}
        onToggle={(tag) => edit((current) => toggleTag(current, tag))}
      />

      <TextField
        label={t('dailyLogs.notes')}
        hint={t('dailyLogs.notesHint')}
        value={values.notes}
        onChangeText={(notes) => edit((current) => ({ ...current, notes }))}
        editable={!isLocked}
        multiline
        maxLength={NOTES_MAX_LENGTH}
      />

      {canEdit ? (
        <View style={styles.group}>
          <FormMessage message={state.error ? t(`dailyLogs.errors.${state.error}`) : null} />
          <FormMessage
            tone="success"
            message={state.status === 'saved' ? t('dailyLogs.savedLocally') : null}
          />
          <Button label={t('dailyLogs.save')} loading={isSaving} onPress={handleSave} />
        </View>
      ) : null}

      {syncStatus ? (
        <SyncStatus
          status={syncStatus}
          record={local}
          onRetry={canEdit && local ? () => retrySync(petId, logDate) : undefined}
          onResolve={() =>
            router.push({ pathname: '/pets/[id]/daily-logs/resolve/[date]', params: { id: petId, date: logDate } })
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.four,
  },
  group: {
    gap: Spacing.two,
  },
  notice: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  toggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  center: {
    textAlign: 'center',
  },
});
