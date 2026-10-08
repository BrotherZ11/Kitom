import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Spacing } from '@/constants/theme';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import { usePetPhotoUrl, useRemovePetPhoto, useUploadPetPhoto } from '@/features/pets/hooks/use-pet-photo';
import { petErrorMessage, PetPhotoPermissionError } from '@/features/pets/pet-errors';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import { pickPetPhoto, type PetPhotoSource } from '@/features/pets/pet-photo-picker';
import type { Pet } from '@/features/pets/types';
import { t } from '@/i18n';

const PHOTO_SIZE = 128;

/**
 * En web el botón de cámara sería un segundo selector de archivos (el navegador decide si ofrece la
 * cámara), así que solo se muestra la galería. En móvil nativo se ofrecen ambas.
 */
const CAN_USE_CAMERA = Platform.OS !== 'web';

type PetPhotoEditorProps = {
  pet: Pet;
  /** Solo UX (`can_edit_pet`): la autorización real la hacen las políticas de Storage y RLS. */
  canEdit: boolean;
};

type Mode = 'idle' | 'choosing' | 'confirmingRemove';

/**
 * Foto de la ficha de la mascota con sus acciones. Independiente del formulario de datos: un fallo
 * de Storage nunca bloquea la edición de nombre, raza, peso, etc.
 */
export function PetPhotoEditor({ pet, canEdit }: PetPhotoEditorProps) {
  const photoPath = pet.photo_path;
  const photoUrl = usePetPhotoUrl(photoPath);
  const upload = useUploadPetPhoto(pet.id);
  const remove = useRemovePetPhoto(pet.id);

  const [mode, setMode] = useState<Mode>('idle');
  const [preview, setPreview] = useState<PreparedPetPhoto | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [pickError, setPickError] = useState<unknown>(null);

  const isBusy = isPicking || upload.isPending || remove.isPending;
  const mutationError = upload.error ?? remove.error;
  const error = pickError ?? mutationError;
  const needsSettings = error instanceof PetPhotoPermissionError && !error.canAskAgain;

  const resetFeedback = () => {
    setPickError(null);
    upload.reset();
    remove.reset();
  };

  const handlePick = async (source: PetPhotoSource) => {
    resetFeedback();
    setIsPicking(true);
    try {
      const photo = await pickPetPhoto(source);
      // Cancelar no es un error: se vuelve al estado anterior sin mensaje.
      if (photo) setPreview(photo);
      setMode('idle');
    } catch (pickFailure) {
      setPickError(pickFailure);
    } finally {
      setIsPicking(false);
    }
  };

  const handleSave = () => {
    if (!preview) return;
    upload.mutate(
      { photo: preview, previousPath: photoPath },
      { onSuccess: () => setPreview(null) },
    );
  };

  const handleRemove = () => {
    if (!photoPath) return;
    remove.mutate(photoPath, { onSuccess: () => setMode('idle') });
  };

  const sourceButtons = (
    <>
      <Button
        variant="secondary"
        label={t('pets.photo.fromLibrary')}
        disabled={isBusy}
        onPress={() => handlePick('library')}
      />
      {CAN_USE_CAMERA ? (
        <Button
          variant="secondary"
          label={t('pets.photo.takePhoto')}
          disabled={isBusy}
          onPress={() => handlePick('camera')}
        />
      ) : null}
    </>
  );

  let actions: ReactNode = null;
  if (!canEdit) {
    actions = null;
  } else if (preview) {
    actions = (
      <>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {t('pets.photo.previewHint')}
        </ThemedText>
        <Button label={t('pets.photo.save')} loading={upload.isPending} onPress={handleSave} />
        <Button
          variant="link"
          label={t('common.cancel')}
          disabled={upload.isPending}
          onPress={() => {
            resetFeedback();
            setPreview(null);
          }}
        />
      </>
    );
  } else if (!photoPath) {
    actions = sourceButtons;
  } else if (mode === 'choosing') {
    actions = (
      <>
        {sourceButtons}
        <Button
          variant="link"
          label={t('common.cancel')}
          disabled={isBusy}
          onPress={() => setMode('idle')}
        />
      </>
    );
  } else if (mode === 'confirmingRemove') {
    actions = (
      <>
        <ThemedText type="smallBold" style={styles.center}>
          {t('pets.photo.removeConfirmTitle')}
        </ThemedText>
        <Button label={t('pets.photo.removeConfirm')} loading={remove.isPending} onPress={handleRemove} />
        <Button
          variant="link"
          label={t('common.cancel')}
          disabled={remove.isPending}
          onPress={() => setMode('idle')}
        />
      </>
    );
  } else {
    actions = (
      <>
        <Button
          variant="secondary"
          label={t('pets.photo.change')}
          disabled={isBusy}
          onPress={() => {
            resetFeedback();
            setMode('choosing');
          }}
        />
        <Button
          variant="link"
          label={t('pets.photo.remove')}
          disabled={isBusy}
          onPress={() => {
            resetFeedback();
            setMode('confirmingRemove');
          }}
        />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <PetPhoto name={pet.name} photoPath={photoPath} previewUri={preview?.uri} size={PHOTO_SIZE} />

      {isPicking ? (
        <View style={styles.row} accessibilityLabel={t('pets.photo.processing')}>
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            {t('pets.photo.processing')}
          </ThemedText>
        </View>
      ) : null}

      {photoUrl.isError && !preview ? (
        <View style={styles.actions}>
          <FormMessage message={petErrorMessage(photoUrl.error)} />
          <Button variant="link" label={t('common.retry')} onPress={() => photoUrl.refetch()} />
        </View>
      ) : null}

      {actions ? <View style={styles.actions}>{actions}</View> : null}

      {error ? (
        <View style={styles.actions}>
          <FormMessage message={petErrorMessage(error)} />
          {needsSettings ? (
            <Button
              variant="link"
              label={t('pets.photo.openSettings')}
              onPress={() => Linking.openSettings()}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  center: {
    textAlign: 'center',
  },
});
