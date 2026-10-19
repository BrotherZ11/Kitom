import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Camera, Trash } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import { PetPhotoSheet } from '@/features/pets/components/pet-photo-sheet';
import { usePetPhotoUrl, useRemovePetPhoto, useUploadPetPhoto } from '@/features/pets/hooks/use-pet-photo';
import { petErrorMessage } from '@/features/pets/pet-errors';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import type { Pet } from '@/features/pets/types';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { radius, size } from '@/theme/tokens';

type PetPhotoEditorProps = {
  pet: Pet;
  /** Solo UX (`can_edit_pet`): la autorización real la hacen las políticas de Storage y RLS. */
  canEdit: boolean;
  /**
   * Control propio que abre la hoja (p. ej. el botón de cámara sobre la foto del perfil 3.6). Sin él,
   * el avatar con su insignia de cámara (tablero 3.8).
   */
  trigger?: (open: () => void) => ReactNode;
};

/**
 * Foto de la ficha con sus acciones (tablero 3.8: el avatar abre la hoja 3.2). Independiente del
 * formulario de datos: un fallo de Storage nunca bloquea la edición de nombre, raza, peso, etc. Una
 * foto elegida se ve antes de guardarla; quitarla se confirma.
 */
export function PetPhotoEditor({ pet, canEdit, trigger }: PetPhotoEditorProps) {
  const theme = useTheme();
  const photoPath = pet.photo_path;
  const photoUrl = usePetPhotoUrl(photoPath);
  const upload = useUploadPetPhoto(pet.id);
  const remove = useRemovePetPhoto(pet.id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [preview, setPreview] = useState<PreparedPetPhoto | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const avatar = <PetPhoto name={pet.name} photoPath={photoPath} size="lg" />;

  return (
    <View>
      {trigger ? (
        canEdit ? (
          trigger(() => setSheetOpen(true))
        ) : null
      ) : canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('pets.edit.changePhoto')}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => pressed && styles.pressed}>
          {avatar}
          <View style={[styles.badge, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <Icon icon={Camera} size={14} color="ink" />
          </View>
        </Pressable>
      ) : (
        avatar
      )}

      {photoUrl.isError && !trigger ? (
        <View style={styles.urlError}>
          <Text variant="caption" color="dangerInk">
            {petErrorMessage(photoUrl.error)}
          </Text>
          <TextLink label={t('common.retry')} onPress={() => void photoUrl.refetch()} />
        </View>
      ) : null}

      <PetPhotoSheet
        visible={sheetOpen}
        title={tf('pets.photo.sheetTitle', { name: pet.name })}
        canRemove={photoPath !== null}
        onClose={() => setSheetOpen(false)}
        onPicked={(photo) => {
          upload.reset();
          setPreview(photo);
        }}
        onRemove={() => {
          remove.reset();
          setConfirmingRemove(true);
        }}
      />

      <Dialog
        visible={preview !== null}
        title={t('pets.photo.previewTitle')}
        message={t('pets.photo.previewHint')}
        confirmLabel={t('pets.photo.save')}
        loading={upload.isPending}
        error={upload.isError ? petErrorMessage(upload.error) : null}
        onConfirm={() => {
          if (!preview) return;
          upload.mutate({ photo: preview, previousPath: photoPath }, { onSuccess: () => setPreview(null) });
        }}
        onCancel={() => setPreview(null)}>
        <View style={styles.preview}>
          <PetPhoto name={pet.name} photoPath={null} previewUri={preview?.uri} size="xl" />
        </View>
      </Dialog>

      <Dialog
        visible={confirmingRemove}
        tone="danger"
        icon={Trash}
        title={t('pets.photo.removeConfirmTitle')}
        confirmLabel={t('pets.photo.removeConfirm')}
        loading={remove.isPending}
        error={remove.isError ? petErrorMessage(remove.error) : null}
        onConfirm={() => {
          if (!photoPath) return;
          remove.mutate(photoPath, { onSuccess: () => setConfirmingRemove(false) });
        }}
        onCancel={() => setConfirmingRemove(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.8,
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlError: {
    marginTop: 6,
    maxWidth: size.avatarLg * 3,
  },
  preview: {
    alignItems: 'center',
  },
});
