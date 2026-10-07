import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-context';
import { PetDetails } from '@/features/pets/components/pet-details';
import { useCanEditPet, useDeletePet, usePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const pet = usePet(id);
  const canEdit = useCanEditPet(id);
  const species = useSpecies();
  const deletePet = useDeletePet(id);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleDelete = () => {
    deletePet.mutate(undefined, { onSuccess: () => router.dismissTo('/pets') });
  };

  if (pet.isPending) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <LoadingState />
      </Screen>
    );
  }

  if (pet.isError) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ErrorState message={petErrorMessage(pet.error)} onRetry={() => pet.refetch()} />
      </Screen>
    );
  }

  if (pet.data === null) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <EmptyState
          title={t('pets.detail.notFound')}
          actionLabel={t('pets.detail.backToList')}
          onAction={() => router.dismissTo('/pets')}
        />
      </Screen>
    );
  }

  const currentPet = pet.data;
  const speciesName =
    species.data?.find((item) => item.id === currentPet.species_id)?.name ?? null;
  // Solo UX: ocultar acciones que RLS rechazaría (editar: `can_edit_pet`; borrar: propietario).
  const isOwner = currentPet.owner_id === user?.id;

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: currentPet.name }} />

      <PetDetails pet={currentPet} speciesName={speciesName} isShared={!isOwner} />

      {canEdit.data ? (
        <Button
          label={t('pets.detail.edit')}
          onPress={() => router.push({ pathname: '/pets/[id]/edit', params: { id } })}
        />
      ) : null}

      {isOwner && !isConfirmingDelete ? (
        <Button
          variant="link"
          label={t('pets.detail.delete')}
          onPress={() => setIsConfirmingDelete(true)}
        />
      ) : null}

      {isOwner && isConfirmingDelete ? (
        <View style={[styles.confirm, { borderColor: theme.danger }]}>
          <ThemedText type="smallBold">{t('pets.detail.deleteConfirmTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('pets.detail.deleteConfirmDescription')}
          </ThemedText>
          <FormMessage message={deletePet.isError ? petErrorMessage(deletePet.error) : null} />
          <Button
            label={t('pets.detail.deleteConfirm')}
            loading={deletePet.isPending}
            onPress={handleDelete}
          />
          <Button
            variant="link"
            label={t('common.cancel')}
            disabled={deletePet.isPending}
            onPress={() => setIsConfirmingDelete(false)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  confirm: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
});
