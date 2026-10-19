import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Camera } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useActivePet } from '@/features/pets/active-pet-context';
import { PetForm } from '@/features/pets/components/pet-form';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import { PetPhotoSheet } from '@/features/pets/components/pet-photo-sheet';
import { useUploadNewPetPhoto } from '@/features/pets/hooks/use-pet-photo';
import { useCreatePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import type { PetFields } from '@/features/pets/types';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { borderWidth, fontFamily, radius, spacing } from '@/theme/tokens';

/**
 * Nueva mascota (tablero 3.1, con todos los datos opcionales disponibles al crear). La foto se elige
 * aquí y se sube al crearla (Storage necesita el id); si la subida falla, la mascota ya existe y su
 * perfil lo dice. La nueva pasa a ser la mascota activa. El límite del plan lo decide el servidor.
 */
export default function NewPetScreen() {
  const router = useRouter();
  const theme = useTheme();
  const species = useSpecies();
  const createPet = useCreatePet();
  const uploadPhoto = useUploadNewPetPhoto();
  const { setActivePet } = useActivePet();
  const [photo, setPhoto] = useState<PreparedPetPhoto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const handleSubmit = (fields: PetFields) => {
    createPet.mutate(fields, {
      onSuccess: async (pet) => {
        setActivePet(pet.id);
        let photoFailed = false;
        if (photo) {
          try {
            await uploadPhoto.mutateAsync({ petId: pet.id, photo });
          } catch {
            photoFailed = true;
          }
        }
        // Sustituye el formulario por el perfil: «atrás» no vuelve al formulario.
        router.replace({
          pathname: '/pets/[id]',
          params: photoFailed ? { id: pet.id, photoFailed: '1' } : { id: pet.id },
        });
      },
    });
  };

  const header = (
    <>
      <TopBar onBack={back} />
      <View style={styles.heading}>
        <Text variant="overline" color="inkMuted">
          {t('pets.new.overline')}
        </Text>
        <Text variant="title1" accessibilityRole="header">
          {t('pets.new.heading')}
        </Text>
        <Text color="inkMuted">{t('pets.new.description')}</Text>
      </View>
    </>
  );

  if (species.isPending || species.isError) {
    return (
      <Screen align="top">
        {header}
        {species.isPending ? (
          <LoadingState />
        ) : (
          <ErrorState message={petErrorMessage(species.error)} onRetry={() => void species.refetch()} />
        )}
      </Screen>
    );
  }

  const photoButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={photo ? t('pets.edit.changePhoto') : t('pets.photo.addA11y')}
      onPress={() => setSheetOpen(true)}
      style={({ pressed }) => pressed && styles.pressed}>
      {photo ? (
        <PetPhoto name="" photoPath={null} previewUri={photo.uri} size={112} />
      ) : (
        <View style={[styles.photoButton, { borderColor: theme.lineControl, backgroundColor: theme.surface }]}>
          <Icon icon={Camera} size="md" color="inkMuted" />
          <Text color="inkMuted" style={styles.photoLabel}>
            {t('pets.photo.add')}
          </Text>
          <Text variant="caption" color="inkMuted">
            {t('pets.photo.optional')}
          </Text>
        </View>
      )}
    </Pressable>
  );

  return (
    <>
      <PetForm
        variant="new"
        initialValues={toPetFormValues()}
        species={species.data}
        header={header}
        photo={photoButton}
        isSubmitting={createPet.isPending || uploadPhoto.isPending}
        leaveAllowed={createPet.isSuccess}
        submitError={createPet.isError ? petErrorMessage(createPet.error) : null}
        onSubmit={handleSubmit}
      />
      <PetPhotoSheet
        visible={sheetOpen}
        title={t('pets.photo.sheetTitleNew')}
        canRemove={photo !== null}
        onClose={() => setSheetOpen(false)}
        onPicked={setPhoto}
        onRemove={() => setPhoto(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
    paddingTop: spacing['2'],
  },
  photoButton: {
    width: 112,
    height: 112,
    borderRadius: radius.full,
    borderWidth: borderWidth.control,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['1'],
  },
  photoLabel: {
    fontFamily: fontFamily.sans500,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.8,
  },
});
