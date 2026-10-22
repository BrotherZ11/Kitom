import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CalendarDays, X } from '@/components/ui/icons';
import { OptionGroup } from '@/components/ui/option-group';
import { PickerField } from '@/components/ui/picker-field';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { TopBar } from '@/components/ui/top-bar';
import { formatTimeOfDay } from '@/features/notifications/notification-plan';
import { DaySheet } from '@/features/reminders/components/day-sheet';
import { TimeSheet } from '@/features/reminders/components/time-sheet';
import {
  isReminderFormDirty,
  localDateTime,
  RECURRENCES,
  REMINDER_NOTES_MAX,
  REMINDER_TITLE_MAX,
  REMINDER_TYPES,
  validateReminderForm,
  type ReminderFormErrors,
  type ReminderFormValues,
  type ReminderType,
} from '@/features/reminders/reminder-model';
import { reminderDayLabel } from '@/features/reminders/reminder-text';
import { useLeaveConfirmation } from '@/hooks/use-leave-confirmation';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { spacing } from '@/theme/tokens';

type ReminderFormProps = {
  mode: 'new' | 'edit';
  petName: string;
  initialValues: ReminderFormValues;
  isSubmitting: boolean;
  submitError: string | null;
  /** Qué pasará con el aviso (permiso de avisos y plataforma). */
  notifyHint: string;
  /** Tras guardar: salir no pregunta. */
  leaveAllowed: boolean;
  onSubmit: (values: ReminderFormValues) => void;
  onClose: () => void;
};

const example = (type: ReminderType) => t(`agenda.examples.${type}`);

/**
 * Nuevo recordatorio / editar (tablero 8.3, a pantalla completa en lugar de hoja: el formulario tiene
 * campos de texto y selectores propios). Tipo, título, día, hora, repetición y notas. El título se
 * propone según el tipo mientras no se escriba otro. Salir con cambios pregunta (tablero 5.7).
 */
export function ReminderForm({
  mode,
  petName,
  initialValues,
  isSubmitting,
  submitError,
  notifyHint,
  leaveAllowed,
  onSubmit,
  onClose,
}: ReminderFormProps) {
  const [values, setValues] = useState<ReminderFormValues>(() =>
    mode === 'new' && initialValues.title === '' ? { ...initialValues, title: example(initialValues.type) } : initialValues
  );
  const [initial] = useState(values);
  const [errors, setErrors] = useState<ReminderFormErrors>({});
  const [sheet, setSheet] = useState<'day' | 'time' | null>(null);
  const [guard] = useState(createSubmitGuard);
  // Mientras se guarda no se pregunta: al terminar se navega en el mismo instante.
  const leave = useLeaveConfirmation(isReminderFormDirty(initial, values) && !isSubmitting && !leaveAllowed);

  const update = (patch: Partial<ReminderFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        if (key === 'title' || key === 'notes') delete next[key];
        if (key === 'date' || key === 'hour' || key === 'minute') delete next.date;
      }
      return next;
    });
  };

  const changeType = (type: ReminderType) => {
    // El título propuesto sigue al tipo hasta que el usuario escribe el suyo.
    const proposed = values.title.trim() === '' || values.title === example(values.type);
    update(proposed ? { type, title: example(type) } : { type });
  };

  const submit = () => {
    void guard.run(async () => {
      const found = validateReminderForm(values, { now: new Date(), isNew: mode === 'new' });
      setErrors(found);
      if (Object.keys(found).length > 0) return;
      onSubmit(values);
    });
  };

  const at = localDateTime(values.date, values.hour, values.minute);
  const titleError =
    errors.title === 'required'
      ? t('agenda.form.errors.titleRequired')
      : errors.title === 'too_long'
        ? tf('agenda.form.errors.titleTooLong', { max: REMINDER_TITLE_MAX })
        : null;
  const notesError = errors.notes ? tf('agenda.form.errors.notesTooLong', { max: REMINDER_NOTES_MAX }) : null;
  const dateError =
    errors.date === 'past'
      ? t('agenda.form.errors.datePast')
      : errors.date
        ? t('agenda.form.errors.dateRequired')
        : null;

  return (
    <>
      <Screen
        align="top"
        footer={
          <>
            {submitError ? <Alert tone="error" message={submitError} /> : null}
            <Button
              label={t('agenda.form.save')}
              loading={isSubmitting}
              loadingLabel={t('agenda.form.saving')}
              onPress={submit}
            />
          </>
        }>
        <TopBar onBack={onClose} backIcon={X} backLabel={t('common.close')} />
        <View style={styles.heading}>
          <Text variant="overline" color="inkMuted">
            {tf('agenda.form.for', { name: petName })}
          </Text>
          <Text variant="title1" accessibilityRole="header">
            {mode === 'new' ? t('agenda.form.titleNew') : t('agenda.form.titleEdit')}
          </Text>
        </View>

        <OptionGroup
          label={t('agenda.form.type')}
          options={REMINDER_TYPES.map((type) => ({ value: type, label: t(`agenda.types.${type}`) }))}
          value={values.type}
          onChange={changeType}
        />

        <TextField
          label={t('agenda.form.titleLabel')}
          value={values.title}
          onChangeText={(title) => update({ title })}
          placeholder={tf('agenda.form.titlePlaceholder', { example: example(values.type).toLowerCase() })}
          maxLength={REMINDER_TITLE_MAX + 20}
          error={titleError}
          returnKeyType="done"
        />

        <View style={styles.row}>
          <View style={styles.flex}>
            <PickerField
              label={t('agenda.form.day')}
              icon={CalendarDays}
              value={at ? capitalize(reminderDayLabel(at, new Date())) : values.date}
              onPress={() => setSheet('day')}
              error={dateError}
            />
          </View>
          <View style={styles.time}>
            <PickerField
              label={t('agenda.form.time')}
              mono
              value={formatTimeOfDay(values)}
              onPress={() => setSheet('time')}
            />
          </View>
        </View>

        <OptionGroup
          label={t('agenda.form.repeat')}
          options={RECURRENCES.map((recurrence) => ({ value: recurrence, label: t(`agenda.recurrence.${recurrence}`) }))}
          value={values.recurrence}
          onChange={(recurrence) => update({ recurrence })}
        />

        <TextField
          label={t('agenda.form.notes')}
          optional
          multiline
          value={values.notes}
          onChangeText={(notes) => update({ notes })}
          placeholder={t('agenda.form.notesPlaceholder')}
          maxLength={REMINDER_NOTES_MAX + 50}
          error={notesError}
        />

        <Text variant="caption" color="inkMuted">
          {notifyHint}
        </Text>
      </Screen>

      <DaySheet
        visible={sheet === 'day'}
        value={values.date}
        allowPast={mode === 'edit'}
        onClose={() => setSheet(null)}
        onSelect={(date) => {
          update({ date });
          setSheet(null);
        }}
      />
      <TimeSheet
        visible={sheet === 'time'}
        title={t('agenda.picker.timeTitle')}
        value={{ hour: values.hour, minute: values.minute }}
        onClose={() => setSheet(null)}
        onConfirm={({ hour, minute }) => {
          update({ hour, minute });
          setSheet(null);
        }}
      />
      <Dialog
        visible={leave.visible}
        title={t('agenda.form.leaveTitle')}
        message={t('agenda.form.leaveText')}
        confirmLabel={t('agenda.form.leaveCancel')}
        cancelLabel={t('agenda.form.leaveConfirm')}
        onConfirm={leave.stay}
        onCancel={leave.leave}
        onDismiss={leave.stay}
      />
    </>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  row: {
    flexDirection: 'row',
    gap: spacing['3'],
    alignItems: 'flex-start',
  },
  flex: {
    flex: 1,
  },
  time: {
    width: 128,
  },
});
