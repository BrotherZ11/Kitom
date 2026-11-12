import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Icon } from '@/components/ui/icon';
import { Lock, WifiOff } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { BirthDateField } from '@/features/pets/components/birth-date-field';
import { PetBreedField, type BreedValues } from '@/features/pets/components/pet-breed-field';
import { useBreedCatalog } from '@/features/pets/hooks/use-breeds';
import { findBreed } from '@/features/pets/offline/breed-catalog-view';
import {
  hasPetFormErrors,
  PET_LIST_MAX_LENGTH,
  PET_TEMPERAMENT_NOTES_MAX_LENGTH,
  toPetFields,
  validatePetForm,
  withSpecies,
  type PetFieldError,
  type PetFormErrors,
  type PetFormValues,
} from '@/features/pets/pet-form';
import { PET_SEX_VALUES, type PetFields, type Species } from '@/features/pets/types';
import { SpeciesFieldsSection } from '@/features/species/components/species-fields-section';
import { SPECIES_CODES, fieldsFor } from '@/features/species/species-fields';
import { speciesAboutTitle } from '@/features/species/species-labels';
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

/** Orden de las especies: el del catálogo de la app (perro y gato primero, «Otro» al final). */
function speciesOrder(code: string): number {
  const index = (SPECIES_CODES as readonly string[]).indexOf(code);
  return index === -1 ? SPECIES_CODES.length : index;
}

/** `YYYY-MM-DD` local de hoy (las fechas de los campos de especie no pueden ser futuras). */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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

  // La raza y los campos propios dependen de la especie: al cambiarla se descartan los incompatibles.
  const setSpecies = (speciesId: string) => {
    const code = species.find((item) => item.id === speciesId)?.code;
    setValues((current) => withSpecies(current, speciesId, code));
    setDirty(true);
    setErrors((current) => ({
      ...current,
      speciesId: undefined,
      breedId: undefined,
      breedText: undefined,
      weightKg: undefined,
      species: undefined,
    }));
  };

  const setBreed = (breed: BreedValues) => {
    setValues((current) => ({ ...current, ...breed }));
    setDirty(true);
    setErrors((current) => ({ ...current, breedId: undefined, breedText: undefined }));
  };

  // Solo especies activas, más la actual si se edita una mascota de una especie ya desactivada.
  const speciesOptions = species
    .filter((item) => item.isActive || item.id === initialValues.speciesId)
    .sort((a, b) => speciesOrder(a.code) - speciesOrder(b.code));
  const currentSpecies = species.find((item) => item.id === values.speciesId) ?? null;
  const currentSpeciesName = currentSpecies?.name ?? t('common.notSpecified');
  const speciesCode = currentSpecies?.code;
  const profileFields = values.speciesId ? fieldsFor(speciesCode, 'profile') : [];
  const today = localToday();

  const handleSubmit = () => {
    const nextErrors = validatePetForm(values, {
      breedSpeciesId: findBreed(breedCatalog.view, values.breedId)?.speciesId,
      speciesCode,
      today,
    });
    setErrors(nextErrors);
    if (hasPetFormErrors(nextErrors)) return;
    onSubmit(toPetFields(values, { speciesCode, today }));
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
            disabled={speciesOptions.length === 0}
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
                  selected={values.speciesId === item.id}
                  onPress={() => setSpecies(item.id)}
                />
              ))}
            </View>
          )}
          <FormMessage message={fieldError(errors.speciesId)} />
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
        speciesCode={speciesCode}
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
            <BirthDateField
              value={values.birthDate}
              onChange={(text) => setField('birthDate', text)}
              error={fieldError(errors.birthDate)}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label={values.weightUnit === 'g' ? t('pets.fields.weightG') : t('pets.fields.weightKg')}
              value={values.weightKg}
              onChangeText={(text) => setField('weightKg', text)}
              keyboardType={values.weightUnit === 'g' ? 'number-pad' : 'decimal-pad'}
              inputMode={values.weightUnit === 'g' ? 'numeric' : 'decimal'}
              style={styles.mono}
              error={fieldError(errors.weightKg)}
            />
          </View>
        </View>
        {Platform.OS === 'web' ? (
          <Text variant="caption" color="inkMuted">
            {t('pets.fields.birthDateHint')}
          </Text>
        ) : null}
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
        maxLength={PET_LIST_MAX_LENGTH}
        hint={t('pets.fields.listHint')}
      />

      <TextField
        label={t('pets.fields.knownConditions')}
        optional
        value={values.knownConditions}
        onChangeText={(text) => setField('knownConditions', text)}
        maxLength={PET_LIST_MAX_LENGTH}
        hint={t('pets.fields.listHint')}
      />

      <TextField
        label={t('pets.fields.temperamentNotes')}
        optional
        value={values.temperamentNotes}
        onChangeText={(text) => setField('temperamentNotes', text)}
        maxLength={PET_TEMPERAMENT_NOTES_MAX_LENGTH}
        multiline
      />

      {profileFields.length > 0 ? (
        <View style={styles.field}>
          <View style={styles.sectionHead}>
            <Text variant="overline" color="inkMuted" accessibilityRole="header">
              {speciesAboutTitle(speciesCode)}
            </Text>
            <Text variant="caption" color="inkMuted">
              {t('speciesFields.hint')}
            </Text>
          </View>
          <SpeciesFieldsSection
            fields={profileFields}
            form={values.species}
            today={today}
            showErrors={errors.species !== undefined}
            onChange={(update) => {
              setValues((current) => ({ ...current, species: update(current.species), speciesIndicated: true }));
              setDirty(true);
            }}
          />
          <FormMessage message={fieldError(errors.species)} />
        </View>
      ) : null}

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
  // Varias especies: rejilla de 3 por fila (2 en pantallas estrechas por el ancho mínimo).
  speciesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
  species: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    minHeight: 56,
    paddingHorizontal: spacing['2'],
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speciesText: {
    fontFamily: fontFamily.sans600,
    textAlign: 'center',
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
