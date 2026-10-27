import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Icon } from '@/components/ui/icon';
import { Info, Lock, WifiOff } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { PetBreedField, type BreedValues } from '@/features/pets/components/pet-breed-field';
import { useBreedCatalog } from '@/features/pets/hooks/use-breeds';
import { findBreed } from '@/features/pets/offline/breed-catalog-view';
import {
  hasPetFormErrors,
  toPetFields,
  validatePetForm,
  withSpecies,
  type PetFieldError,
  type PetFormErrors,
  type PetFormValues,
} from '@/features/pets/pet-form';
import { PET_SEX_VALUES, type PetFields, type Species } from '@/features/pets/types';
import { useLeaveConfirmation } from '@/hooks/use-leave-confirmation';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { borderWidth, fontFamily, radius, spacing } from '@/theme/tokens';

type PetFormProps = {
  /** `new` (tablero 3.1 + datos opcionales) o `edit` (tablero 3.8). */
  variant: 'new' | 'edit';
  initialValues: PetFormValues;
  species: Species[];
  /** Cabecera de la pantalla (barra superior). */
  header: ReactNode;
  /** Foto: botón de foto del alta o editor de foto de la ficha. */
  photo: ReactNode;
  /** Bajo los campos (p. ej. «Eliminar a Kika de Kitom»). */
  footerExtra?: ReactNode;
  isSubmitting: boolean;
  /**
   * Salir sin preguntar aunque haya cambios (ya se guardó, o se está eliminando la mascota). Mientras
   * se envía tampoco se pregunta.
   */
  leaveAllowed?: boolean;
  /** Mensaje del último error al guardar (ya traducido). */
  submitError: string | null;
  /**
   * Sin conexión o sin sesión utilizable: se avisa de que se guardará en el dispositivo y se enviará al
   * volver la conexión (fase 8). Guardar sigue disponible.
   */
  offline?: boolean;
  onSubmit: (fields: PetFields) => void;
};

const STERILIZED_VALUES = ['yes', 'no', 'unknown'] as const;
/** «Otro» del tablero 3.1: no es una especie del catálogo; explica que, por ahora, perros y gatos. */
const OTHER_SPECIES = '__other__';

function fieldError(error: PetFieldError | undefined): string | null {
  return error ? t(`pets.validation.${error}`) : null;
}

/**
 * Formulario de alta y edición de una mascota. Solo produce columnas editables (`PetFields`), nunca
 * `owner_id`. Nombre y especie son obligatorios; el resto, opcional también al crear. Con cambios
 * sin guardar, salir pide confirmación.
 */
export function PetForm({
  variant,
  initialValues,
  species,
  header,
  photo,
  footerExtra,
  isSubmitting,
  leaveAllowed = false,
  submitError,
  offline = false,
  onSubmit,
}: PetFormProps) {
  const theme = useTheme();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<PetFormErrors>({});
  const [otherSpecies, setOtherSpecies] = useState(false);
  // Edición: la especie se muestra bloqueada; cambiarla (por si se eligió mal) pide confirmación.
  const [speciesUnlocked, setSpeciesUnlocked] = useState(false);
  const [confirmingSpecies, setConfirmingSpecies] = useState(false);
  const [dirty, setDirty] = useState(false);
  const leave = useLeaveConfirmation(dirty && !isSubmitting && !leaveAllowed);
  // Con conexión, abrir el formulario descarga el catálogo de razas (y su copia para usarlo sin conexión).
  const breedCatalog = useBreedCatalog();

  const setField = <K extends keyof PetFormValues>(field: K, value: PetFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setDirty(true);
    // Al corregir un campo se oculta su error; la validación completa vuelve al enviar.
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  // La raza depende de la especie: al cambiarla se descarta una raza concreta incompatible.
  const setSpecies = (speciesId: string) => {
    setOtherSpecies(false);
    setValues((current) => withSpecies(current, speciesId));
    setDirty(true);
    setErrors((current) => ({ ...current, speciesId: undefined, breedId: undefined, breedText: undefined }));
  };

  const setBreed = (breed: BreedValues) => {
    setValues((current) => ({ ...current, ...breed }));
    setDirty(true);
    setErrors((current) => ({ ...current, breedId: undefined, breedText: undefined }));
  };

  // Solo especies activas, más la actual si se edita una mascota de una especie ya desactivada.
  const speciesOptions = species.filter((item) => item.isActive || item.id === initialValues.speciesId);
  const currentSpeciesName =
    species.find((item) => item.id === values.speciesId)?.name ?? t('common.notSpecified');

  const handleSubmit = () => {
    const nextErrors = validatePetForm(values, {
      breedSpeciesId: findBreed(breedCatalog.view, values.breedId)?.speciesId,
    });
    setErrors(nextErrors);
    if (hasPetFormErrors(nextErrors)) return;
    onSubmit(toPetFields(values));
  };

  const name = values.name.trim();
  const submitLabel =
    variant === 'edit' ? t('pets.edit.submit') : name ? tf('pets.new.submitNamed', { name }) : t('pets.new.submit');

  return (
    <Screen
      align="top"
      footer={
        <>
          {offline ? <Banner tone="warning" icon={WifiOff} message={t('pets.offline.formBanner')} /> : null}
          <FormMessage message={submitError} />
          <Button
            label={submitLabel}
            loading={isSubmitting}
            disabled={speciesOptions.length === 0 || (variant === 'new' && otherSpecies)}
            onPress={handleSubmit}
          />
        </>
      }>
      {header}

      {variant === 'new' ? (
        <>
          <View style={styles.photoCenter}>{photo}</View>
          <TextField
            label={t('pets.fields.name')}
            value={values.name}
            onChangeText={(text) => setField('name', text)}
            autoCapitalize="words"
            maxLength={40}
            error={fieldError(errors.name)}
          />
        </>
      ) : (
        <>
          <View style={styles.nameRow}>
            {photo}
            <View style={styles.flex}>
              <TextField
                label={t('pets.fields.name')}
                value={values.name}
                onChangeText={(text) => setField('name', text)}
                autoCapitalize="words"
                maxLength={40}
                error={fieldError(errors.name)}
              />
            </View>
          </View>
          <Text color="inkMuted">{tf('pets.edit.intro', { name: name || initialValues.name })}</Text>
        </>
      )}

      {variant === 'edit' && !speciesUnlocked ? (
        <View style={styles.field}>
          <Text variant="label">{t('pets.fields.species')}</Text>
          <View
            accessible
            accessibilityLabel={tf('pets.edit.speciesLocked', { species: currentSpeciesName })}
            style={[styles.locked, { backgroundColor: theme.surfaceSunken }]}>
            <Text style={styles.flex}>{currentSpeciesName}</Text>
            <Icon icon={Lock} size="sm" color="inkMuted" />
          </View>
          {speciesOptions.length > 1 ? (
            <TextLink label={t('pets.edit.speciesChange')} onPress={() => setConfirmingSpecies(true)} />
          ) : null}
        </View>
      ) : variant === 'new' || speciesOptions.length > 1 ? (
        <View style={styles.field}>
          <Text variant="label" nativeID="species-label">
            {t('pets.fields.species')}
          </Text>
          {variant === 'edit' ? (
            <Text variant="caption" color="inkMuted">
              {t('pets.edit.speciesChangeHint')}
            </Text>
          ) : null}
          {speciesOptions.length === 0 ? (
            <FormMessage message={t('pets.noSpecies')} />
          ) : (
            <View style={styles.speciesGrid} accessibilityRole="radiogroup" accessibilityLabel={t('pets.fields.species')}>
              {speciesOptions.map((item) => (
                <SpeciesOption
                  key={item.id}
                  label={item.name}
                  selected={!otherSpecies && values.speciesId === item.id}
                  onPress={() => setSpecies(item.id)}
                />
              ))}
              {variant === 'new' ? (
                <SpeciesOption
                  key={OTHER_SPECIES}
                  label={t('pets.new.otherSpecies')}
                  selected={otherSpecies}
                  onPress={() => setOtherSpecies(true)}
                />
              ) : null}
            </View>
          )}
          <FormMessage message={fieldError(errors.speciesId)} />
          {otherSpecies ? (
            <Alert tone="info" icon={Info} title={t('pets.new.otherTitle')} message={t('pets.new.otherText')} />
          ) : null}
        </View>
      ) : null}

      {variant === 'new' ? (
        <View style={styles.sectionHead}>
          <Text variant="overline" color="inkMuted" accessibilityRole="header">
            {t('pets.new.more')}
          </Text>
          <Text variant="caption" color="inkMuted">
            {t('pets.new.moreHint')}
          </Text>
        </View>
      ) : null}

      <PetBreedField
        speciesId={values.speciesId}
        value={{
          breedStatus: values.breedStatus,
          breedSource: values.breedSource,
          breedId: values.breedId,
          breedText: values.breedText,
        }}
        onChange={setBreed}
        errors={{ breedId: fieldError(errors.breedId), breedText: fieldError(errors.breedText) }}
      />

      <View style={styles.field}>
        <View style={styles.grid}>
          <View style={styles.flex}>
            <TextField
              label={t('pets.fields.birthDate')}
              value={values.birthDate}
              onChangeText={(text) => setField('birthDate', text)}
              placeholder="AAAA-MM-DD"
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              maxLength={10}
              style={styles.mono}
              error={fieldError(errors.birthDate)}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label={t('pets.fields.weightKg')}
              value={values.weightKg}
              onChangeText={(text) => setField('weightKg', text)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              style={styles.mono}
              error={fieldError(errors.weightKg)}
            />
          </View>
        </View>
        <Text variant="caption" color="inkMuted">
          {t('pets.fields.birthDateHint')}
        </Text>
      </View>

      <SegmentedControl
        label={t('pets.fields.sex')}
        options={PET_SEX_VALUES.map((value) => ({ value, label: t(`pets.sex.${value}`) }))}
        value={values.sex}
        onChange={(value) => setField('sex', value)}
      />

      <SegmentedControl
        label={t('pets.fields.sterilized')}
        options={STERILIZED_VALUES.map((value) => ({ value, label: t(`common.${value}`) }))}
        value={values.sterilized}
        onChange={(value) => setField('sterilized', value)}
      />

      <TextField
        label={t('pets.fields.allergies')}
        optional
        value={values.allergies}
        onChangeText={(text) => setField('allergies', text)}
        hint={t('pets.fields.listHint')}
      />

      <TextField
        label={t('pets.fields.knownConditions')}
        optional
        value={values.knownConditions}
        onChangeText={(text) => setField('knownConditions', text)}
        hint={t('pets.fields.listHint')}
      />

      <TextField
        label={t('pets.fields.temperamentNotes')}
        optional
        value={values.temperamentNotes}
        onChangeText={(text) => setField('temperamentNotes', text)}
        multiline
      />

      {footerExtra ? (
        <>
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          {footerExtra}
        </>
      ) : null}

      <Dialog
        visible={confirmingSpecies}
        title={tf('pets.edit.speciesChangeTitle', { name: initialValues.name })}
        message={t('pets.edit.speciesChangeText')}
        confirmLabel={t('pets.edit.speciesChangeConfirm')}
        onConfirm={() => {
          setConfirmingSpecies(false);
          setSpeciesUnlocked(true);
        }}
        onCancel={() => setConfirmingSpecies(false)}
      />

      <Dialog
        visible={leave.visible}
        title={t('pets.edit.discardTitle')}
        message={t('pets.edit.discardText')}
        confirmLabel={t('pets.edit.discardKeep')}
        cancelLabel={t('pets.edit.discardLeave')}
        onConfirm={leave.stay}
        onCancel={leave.leave}
        onDismiss={leave.stay}
      />
    </Screen>
  );
}

/** Tarjeta de especie (tablero 3.1): 56 de alto; elegida, fondo de marca y borde `primary` (no solo color). */
function SpeciesOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.species,
        selected
          ? { backgroundColor: theme.surfaceBrand, borderColor: theme.primary, borderWidth: borderWidth.focus }
          : { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: borderWidth.hairline },
        pressed && styles.pressed,
      ]}>
      <Text color={selected ? 'primary' : 'ink'} style={styles.speciesText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  photoCenter: {
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing['4'],
  },
  field: {
    gap: spacing['2'],
  },
  // Especie bloqueada (tablero 3.8): mismo alto que un campo, fondo hundido y candado.
  locked: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  speciesGrid: {
    flexDirection: 'row',
    gap: spacing['2'],
  },
  species: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speciesText: {
    fontFamily: fontFamily.sans600,
  },
  pressed: {
    opacity: 0.8,
  },
  sectionHead: {
    gap: spacing['1'],
    marginTop: spacing['2'],
  },
  grid: {
    flexDirection: 'row',
    gap: spacing['3'],
  },
  mono: {
    fontFamily: fontFamily.mono500,
  },
  divider: {
    height: 1,
  },
});
