import { useReducer, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { ScaleSelector } from '@/features/daily-logs/components/scale-selector';
import { TagSelector } from '@/features/daily-logs/components/tag-selector';
import { toDailyLogError } from '@/features/daily-logs/daily-log-errors';
import {
  DETAIL_SCALE_FIELDS,
  NOTES_MAX_LENGTH,
  PRIMARY_SCALE_FIELDS,
  UNUSUAL_BEHAVIOR_NOTES_MAX_LENGTH,
  dailyLogEditorReducer,
  hasDetailValues,
  initialDailyLogEditorState,
  setAllAsUsual,
  setScale,
  toSaveDailyLogArgs,
  toggleTag,
  validateDailyLogForm,
  type DailyLogFormValues,
  type ScaleField,
} from '@/features/daily-logs/daily-log-form';
import { useSaveDailyLog } from '@/features/daily-logs/hooks/use-daily-log';
import type { DailyLog } from '@/features/daily-logs/types';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';

type DailyLogEditorProps = {
  petId: string;
  logDate: string;
  /** Registro guardado de ese día (`null` = todavía no existe: formulario vacío). */
  initialLog: DailyLog | null;
  /** UX (`can_edit_pet`): sin permiso, solo lectura. La autorización real es RLS. */
  canEdit: boolean;
};

/**
 * Formulario del registro de un día. Nunca crea nada al abrirse: solo «Guardar registro» llama a
 * `save_daily_log`. Montar con `key={logDate}` para empezar de cero si cambia el día.
 */
export function DailyLogEditor({ petId, logDate, initialLog, canEdit }: DailyLogEditorProps) {
  const theme = useTheme();
  const [state, dispatch] = useReducer(dailyLogEditorReducer, initialLog, initialDailyLogEditorState);
  const [submitGuard] = useState(createSubmitGuard);
  const [showDetails, setShowDetails] = useState(() => hasDetailValues(state.values));
  const saveDailyLog = useSaveDailyLog();

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
    const pending = submitGuard.run(() =>
      saveDailyLog.mutateAsync(toSaveDailyLogArgs(petId, logDate, values))
    );
    if (!pending) return; // ya hay un guardado en curso
    dispatch({ type: 'saveStarted' });
    pending.then(
      (log) => dispatch({ type: 'saveSucceeded', log }),
      (error: unknown) => dispatch({ type: 'saveFailed', error: toDailyLogError(error).code })
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

  if (!canEdit && !initialLog) {
    return (
      <ThemedText themeColor="textSecondary" style={styles.center}>
        {t('dailyLogs.emptyReadOnly')}
      </ThemedText>
    );
  }

  return (
    <View style={styles.container}>
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
            message={state.status === 'saved' ? t('dailyLogs.saved') : null}
          />
          <Button label={t('dailyLogs.save')} loading={isSaving} onPress={handleSave} />
        </View>
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
