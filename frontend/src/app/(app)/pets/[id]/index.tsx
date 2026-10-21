import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Pencil } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { PetDetails } from '@/features/pets/components/pet-details';
import { PetProfile } from '@/features/pets/components/pet-profile';
import { PetSyncNotice } from '@/features/pets/components/pet-sync-status';
import { usePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { isLocalPetId } from '@/features/pets/offline/pet-operation';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { formatBreed } from '@/features/pets/pet-format';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Perfil de una mascota abierto desde «Mis mascotas» o un enlace (`/pets/[id]`). Es el mismo perfil
 * que la pestaña Perfil, con «Volver». `?photoFailed=1`: se creó, pero la foto no se pudo subir.
 * Sin conexión: la copia del dispositivo con aviso de que puede estar desactualizada; sin copia,
 * «no disponible sin conexión» (no «no existe»: eso solo lo dice el servidor).
 *
 * Con cambios guardados solo en el dispositivo (fase 8), su estado y lo que se puede hacer. Un id
 * local es un alta de este dispositivo: se ve el borrador (sin registros diarios ni foto, que necesitan
 * el id del servidor) y, cuando se confirma, se pasa a la mascota del servidor.
 */
export default function PetDetailScreen() {
  const { id, photoFailed } = useLocalSearchParams<{ id: string; photoFailed?: string }>();
  const router = useRouter();
  const pet = usePet(id);
  const species = useSpecies();
  const { view } = pet;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/pets'));

  if (pet.redirectTo) return <Redirect href={{ pathname: '/pets/[id]', params: { id: pet.redirectTo } }} />;

  const syncNotice = <PetSyncNotice op={pet.op} display={pet.display} onDiscarded={isLocalPetId(id) ? back : undefined} />;

  if (view.state === 'ready' && isLocalPetId(id)) {
    const speciesName = species.data?.find((item) => item.id === view.pet.species_id)?.name ?? null;
    return (
      <Screen align="top">
        <TopBar onBack={back} />
        <View style={styles.heading}>
          <Text variant="title1" accessibilityRole="header">
            {view.pet.name}
          </Text>
        </View>
        {syncNotice}
        <Alert tone="info" message={t('pets.sync.dailyLogsUnavailableText')} />
        {pet.op?.status !== 'forbidden' ? (
          <Button
            variant="secondary"
            size="md"
            icon={Pencil}
            label={t('pets.profile.edit')}
            onPress={() => router.push({ pathname: '/pets/[id]/edit', params: { id } })}
          />
        ) : null}
        <PetDetails pet={view.pet} speciesName={speciesName} breedLabel={formatBreed(view.pet, null)} isShared={false} />
      </Screen>
    );
  }

  if (view.state === 'ready') {
    return (
      <PetProfile
        pet={view.pet}
        mode="stack"
        freshness={view}
        syncNotice={syncNotice}
        onOpenHistory={() => router.push({ pathname: '/pets/[id]/daily-logs', params: { id } })}
        notice={photoFailed === '1' ? <Alert tone="warning" message={t('pets.new.photoFailed')} /> : null}
      />
    );
  }

  const content = () => {
    switch (view.state) {
      case 'loading':
        return <LoadingState />;
      case 'error':
        return <ErrorState message={petErrorMessage(view.error)} onRetry={pet.refetch} />;
      case 'local_error':
        return <ErrorState message={t('pets.offline.localReadFailed')} onRetry={pet.refetch} />;
      case 'offline_unavailable':
        return (
          <ErrorState
            offline
            message={t('pets.offline.detailUnavailableTitle')}
            description={t('pets.offline.detailUnavailableText')}
            onRetry={pet.refetch}
          />
        );
      case 'unavailable':
        return (
          <EmptyState
            kind="offline"
            title={t('pets.offline.noLongerAvailableTitle')}
            description={t('pets.offline.noLongerAvailableText')}
            actionLabel={t('common.retry')}
            onAction={pet.refetch}
          />
        );
      case 'not_found':
        return (
          <EmptyState
            title={t('pets.detail.notFound')}
            actionLabel={t('pets.detail.backToList')}
            onAction={() => router.dismissTo('/pets')}
          />
        );
    }
  };

  return (
    <Screen align="top">
      <TopBar onBack={back} />
      {/* Cambios guardados en el dispositivo de una mascota que ya no se ve: se pueden copiar o descartar. */}
      {syncNotice}
      {content()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
});
