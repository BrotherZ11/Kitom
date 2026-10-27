import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plus } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { DeviceDailyLogs } from '@/features/daily-logs/components/device-logs';
import { PetDeleteTag } from '@/features/pets/components/pet-deletion-status';
import { PetListItem } from '@/features/pets/components/pet-list-item';
import { PetSavedBanner } from '@/features/pets/components/pet-saved-banner';
import { PetSyncTag } from '@/features/pets/components/pet-sync-status';
import { usePets } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * Mis mascotas (desde «Tu cuenta»): todas las visibles, propias y compartidas, y añadir otra. Sin
 * conexión, la última lista guardada en el dispositivo con su fecha; sin copia, «no disponible sin
 * conexión» y los registros del dispositivo. Cada mascota con cambios guardados solo en el dispositivo
 * lleva su estado; las altas sin confirmar van aparte («Guardadas solo en este dispositivo»), y las que
 * tienen una eliminación guardada también («Eliminaciones pendientes»): no están en la lista hasta que
 * se deshace (fase 10).
 */
export default function PetsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pets = usePets();
  // El nombre de la especie es secundario: si el catálogo falla, la lista se muestra igual.
  const species = useSpecies();
  const speciesNames = new Map(species.data?.map((item) => [item.id, item.name]));

  const goToNewPet = () => router.push('/pets/new');

  const { view, drafts, orphans, deletions } = pets;
  const open = (id: string) => router.push({ pathname: '/pets/[id]', params: { id } });

  // Altas guardadas solo en este dispositivo: se ven también sin la lista del servidor.
  const draftsSection =
    drafts.length > 0 ? (
      <View style={styles.section}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('pets.sync.drafts')}
        </Text>
        <Card flush>
          {drafts.map(({ pet, display }, index) => (
            <PetListItem
              key={pet.id}
              pet={pet}
              speciesName={speciesNames.get(pet.species_id) ?? null}
              isShared={false}
              divider={index < drafts.length - 1}
              trailing={<PetSyncTag display={display} />}
              onPress={() => open(pet.id)}
            />
          ))}
        </Card>
      </View>
    ) : null;
  // Cambios guardados de mascotas que ya no se ven (sin permiso, borradas…): para revisarlos o descartarlos.
  const orphansSection =
    orphans.length > 0 ? (
      <View style={styles.section}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('pets.sync.orphans')}
        </Text>
        <Card flush>
          {orphans.map(({ pet, display }, index) => (
            <PetListItem
              key={pet.id}
              pet={pet}
              speciesName={speciesNames.get(pet.species_id) ?? null}
              isShared={pet.owner_id !== user?.id}
              divider={index < orphans.length - 1}
              trailing={<PetSyncTag display={display} />}
              onPress={() => open(pet.id)}
            />
          ))}
        </Card>
      </View>
    ) : null;
  // Eliminaciones guardadas en el dispositivo aún sin confirmar: se abren para deshacerlas o decidir.
  const deletionsSection =
    deletions.length > 0 ? (
      <View style={styles.section}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('pets.deletion.section')}
        </Text>
        <Card flush>
          {deletions.map(({ pet, op, display }, index) => (
            <PetListItem
              key={op.localId}
              pet={pet}
              speciesName={speciesNames.get(pet.species_id) ?? null}
              isShared={false}
              divider={index < deletions.length - 1}
              trailing={<PetDeleteTag display={display} />}
              onPress={() => open(op.localId)}
            />
          ))}
        </Card>
      </View>
    ) : null;
  const operationsError = pets.operationsError ? (
    <Alert tone="warning" message={t('pets.sync.operationsReadFailed')} action={{ label: t('common.retry'), onPress: pets.refetch }} />
  ) : null;

  const content = () => {
    if (view.state === 'loading') return <LoadingState />;
    if (view.state === 'error') return <ErrorState message={petErrorMessage(view.error)} onRetry={pets.refetch} />;
    if (view.state === 'offline_unavailable' || view.state === 'local_error') {
      return (
        <>
          {operationsError}
          {draftsSection}
          {orphansSection}
          {deletionsSection}
          {view.state === 'local_error' ? (
            <ErrorState message={t('pets.offline.localReadFailed')} onRetry={pets.refetch} />
          ) : (
            <ErrorState
              offline
              message={t('pets.offline.listUnavailableTitle')}
              description={t('pets.offline.listUnavailableText')}
              onRetry={pets.refetch}
            />
          )}
          {/* Sin la lista: acceso a los registros guardados en el dispositivo. */}
          <DeviceDailyLogs />
        </>
      );
    }
    const items = pets.items ?? [];
    if (items.length === 0 && drafts.length === 0) {
      return (
        <>
          <PetSavedBanner freshness={view} />
          {operationsError}
          {orphansSection}
          {deletionsSection}
          <EmptyState
            title={t('pets.list.emptyTitle')}
            description={t('pets.list.emptyDescription')}
            actionLabel={t('pets.list.add')}
            onAction={goToNewPet}
          />
        </>
      );
    }
    return (
      <>
        <PetSavedBanner freshness={view} />
        {operationsError}
        {items.length > 0 ? (
          <Card flush>
            {items.map(({ pet, display }, index) => (
              <PetListItem
                key={pet.id}
                pet={pet}
                speciesName={speciesNames.get(pet.species_id) ?? null}
                // Solo informativo: la visibilidad la decide RLS, no esta comparación.
                isShared={pet.owner_id !== user?.id}
                divider={index < items.length - 1}
                trailing={<PetSyncTag display={display} />}
                onPress={() => open(pet.id)}
              />
            ))}
          </Card>
        ) : null}
        {draftsSection}
        {orphansSection}
        {deletionsSection}
      </>
    );
  };

  return (
    <Screen
      align="top"
      footer={
        view.state === 'ready' && (view.pets.length > 0 || drafts.length > 0) ? (
          <Button variant="secondary" icon={Plus} label={t('pets.list.add')} onPress={goToNewPet} />
        ) : undefined
      }>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} title={t('pets.list.title')} />
      {content()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing['2'],
  },
});
