import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/icons';
import { PickerField } from '@/components/ui/picker-field';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { formatBirthDate, localDateToIsoDate, pickerInitialDate } from '@/features/pets/birth-date';
import { getLocale, t } from '@/i18n';
import { fontFamily, spacing } from '@/theme/tokens';

type BirthDateFieldProps = {
  /** `AAAA-MM-DD` o vacío. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
};

/**
 * Fecha de nacimiento: selector nativo en Android (diálogo del sistema) e iOS (rueda en una hoja), sin
 * fechas futuras y con «Quitar» para dejarla sin indicar. En web el selector no existe: campo de texto
 * `AAAA-MM-DD` (la validación de `pet-form.ts` es la misma en todas las plataformas).
 */
export function BirthDateField({ value, onChange, error }: BirthDateFieldProps) {
  const [iosOpen, setIosOpen] = useState(false);
  const [iosDraft, setIosDraft] = useState<Date>(() => pickerInitialDate(value, new Date()));

  if (Platform.OS === 'web') {
    return (
      <TextField
        label={t('pets.fields.birthDate')}
        value={value}
        onChangeText={onChange}
        placeholder={t('pets.fields.birthDatePlaceholder')}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
        style={styles.mono}
        error={error}
      />
    );
  }

  const open = () => {
    const today = new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerInitialDate(value, today),
        mode: 'date',
        maximumDate: today,
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'set' && date) onChange(localDateToIsoDate(date));
        },
      });
      return;
    }
    setIosDraft(pickerInitialDate(value, today));
    setIosOpen(true);
  };

  return (
    <View style={styles.field}>
      <PickerField
        label={t('pets.fields.birthDate')}
        value={formatBirthDate(value, getLocale()) ?? t('pets.fields.birthDateUnset')}
        icon={Calendar}
        onPress={open}
        error={error}
      />
      {value !== '' ? <TextLink label={t('pets.fields.birthDateClear')} onPress={() => onChange('')} /> : null}
      {Platform.OS === 'ios' ? (
        <BottomSheet
          visible={iosOpen}
          title={t('pets.fields.birthDate')}
          onClose={() => setIosOpen(false)}
          footer={
            <Button
              label={t('pets.fields.birthDateDone')}
              onPress={() => {
                onChange(localDateToIsoDate(iosDraft));
                setIosOpen(false);
              }}
            />
          }>
          <DateTimePicker
            value={iosDraft}
            mode="date"
            display="spinner"
            maximumDate={new Date()}
            locale={getLocale()}
            onChange={(_event, date) => {
              if (date) setIosDraft(date);
            }}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing['2'],
  },
  mono: {
    fontFamily: fontFamily.mono500,
  },
});
