import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Camera } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useActivePet } from '@/features/pets/active-pet-context';
import { PetForm } from '@/features/pets/components/pet-form';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import { PetPhotoSheet } from '@/features/pets/components/pet-photo-sheet';
import { useUploadNewPetPhoto } from '@/features/pets/hooks/use-pet-photo';
import { useSaveNewPet } from '@/features/pets/hooks/use-pet-writes';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { resolveNewPetForm } from '@/features/pets/offline/pet-form-gate';
import { isPetOfflineError, petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import type { PetFields } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { borderWidth, fontFamily, radius, spacing } from '@/theme/tokens';

/**
 * Nueva mascota (tablero 3.1, con todos los datos opcionales disponibles al crear). La foto se elige
 * aquí y se sube al crearla (Storage necesita el id); si la subida falla, la mascota ya existe y su
 * perfil lo dice. La nueva pasa a ser la mascota activa. El límite del plan lo decide el servidor.
 *
 * Fase 8: el alta se guarda primero en el dispositivo (con su clave de alta idempotente) y la envía la
 * sincronización; con conexión se espera brevemente al servidor. Si no confirma a tiempo (o no hay
 * conexión), la mascota queda como borrador con id local, sin foto (la foto necesita el id del
 * servidor) y sin pasar a ser la activa (las pestañas usan registros diarios).
 */
export default function NewPetScreen() {
  const router = useRouter();
  const theme = useTheme();
  const species = useSpecies();
  const saveNew = useSaveNewPet();
  const uploadPhoto = useUploadNewPetPhoto();
  const toast = useToast();
  const [guard] = useState(createSubmitGuard);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { setActivePet } = useActivePet();
  const [photo, setPhoto] = useState<PreparedPetPhoto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const writable = canUseServer && online;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const handleSubmit = (fields: PetFields) => {
    void guard.run(async () => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const outcome = await saveNew(fields, { waitForServer: writable });
        setSaved(true);
        if (outcome.synced && outcome.petId) {
          const petId = outcome.petId;
          setActivePet(petId);
          let photoFailed = false;
          if (photo) {
            try {
              await uploadPhoto.mutateAsync({ petId, photo });
            } catch {
              photoFailed = true;
            }
          }
          // Sustituye el formulario por el perfil: «atrás» no vuelve al formulario.
          router.replace({ pathname: '/pets/[id]', params: photoFailed ? { id: petId, photoFailed: '1' } : { id: petId } });
          return;
        }
        // Guardada solo en el dispositivo: la foto no (necesita el id del servidor).
        toast({ message: photo ? t('pets.sync.photoNotUploaded') : t('pets.sync.createdLocally') });
        if (outcome.op) router.replace({ pathname: '/pets/[id]', params: { id: outcome.op.localId } });
      } catch {
        setSubmitError(t('pets.errors.unknown'));
      } finally {
        setSubmitting(false);
      }
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

  const gate = resolveNewPetForm({ species, writable, isOfflineError: isPetOfflineError });

  if (gate.state !== 'form' || !species.data) {
    return (
      <Screen align="top">
        {header}
        {gate.state === 'loading' ? (
          <LoadingState />
        ) : gate.state === 'error' ? (
          <ErrorState message={petErrorMessage(gate.error)} onRetry={() => void species.refetch()} />
        ) : (
          // Sin conexión y sin el catálogo de especies guardado: no se puede rellenar el formulario.
          <ErrorState
            offline
            message={t('pets.offline.newTitle')}
            description={t('pets.sync.speciesUnavailable')}
            onRetry={() => void species.refetch()}
          />
        )}
      </Screen>
    );
  }

  // Sin conexión no se elige foto: no se podría subir (necesita el id del servidor).
  const photoButton = !writable ? (
    <View style={[styles.photoButton, { borderColor: theme.lineControl, backgroundColor: theme.surface }]}>
      <Icon icon={Camera} size="md" color="inkMuted" />
      <Text variant="caption" color="inkMuted" style={styles.photoOffline}>
        {t('pets.sync.photoOffline')}
      </Text>
    </View>
  ) : (
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
        isSubmitting={submitting || uploadPhoto.isPending}
        leaveAllowed={saved}
        submitError={submitError}
        offline={gate.offline}
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
  photoOffline: {
    textAlign: 'center',
    paddingHorizontal: spacing['2'],
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
