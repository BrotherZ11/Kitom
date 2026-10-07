import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { MAX_BREED_RESULTS, searchBreeds } from '@/features/pets/breed-search';
import { useBreed, useBreeds } from '@/features/pets/hooks/use-breeds';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type BreedPickerProps = {
  speciesId: string;
  /** `''` = ninguna seleccionada. */
  selectedBreedId: string;
  onSelect: (breedId: string) => void;
  /** El usuario indica que su raza no está en el catálogo (texto libre). */
  onChooseOther: () => void;
  error?: string | null;
};

/** Buscador de razas activas de la especie, por nombre y alias. */
export function BreedPicker({
  speciesId,
  selectedBreedId,
  onSelect,
  onChooseOther,
  error,
}: BreedPickerProps) {
  const theme = useTheme();
  const breeds = useBreeds(speciesId);
  const [query, setQuery] = useState('');

  const selectedInList = breeds.data?.find((breed) => breed.id === selectedBreedId);
  // Raza guardada que ya no está activa: se pide por id solo para mostrar su nombre.
  const selectedOutsideList = useBreed(
    selectedBreedId !== '' && breeds.isSuccess && !selectedInList ? selectedBreedId : null
  );

  if (selectedBreedId !== '') {
    const name = selectedInList?.name ?? selectedOutsideList.data?.name ?? t('common.loading');
    return (
      <View style={styles.container}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('pets.breedPicker.selected')}
        </ThemedText>
        <ThemedText type="smallBold">{name}</ThemedText>
        <Button
          variant="link"
          label={t('pets.breedPicker.change')}
          onPress={() => {
            setQuery('');
            onSelect('');
          }}
        />
      </View>
    );
  }

  if (breeds.isPending) return <LoadingState />;
  if (breeds.isError) {
    return <ErrorState message={petErrorMessage(breeds.error)} onRetry={() => breeds.refetch()} />;
  }

  const results = searchBreeds(breeds.data, query);
  const visible = results.slice(0, MAX_BREED_RESULTS);

  return (
    <View style={styles.container}>
      <TextField
        label={t('pets.breedPicker.searchLabel')}
        value={query}
        onChangeText={setQuery}
        placeholder={t('pets.breedPicker.searchPlaceholder')}
        autoCorrect={false}
        autoCapitalize="none"
        error={error}
      />

      <View
        style={[styles.results, { borderColor: theme.border }]}
        accessibilityRole="list"
        accessibilityLabel={t('pets.breedPicker.searchLabel')}>
        {visible.map((breed, index) => (
          <Pressable
            key={breed.id}
            accessibilityRole="button"
            accessibilityLabel={breed.name}
            onPress={() => onSelect(breed.id)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
              pressed && { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText type="small">{breed.name}</ThemedText>
          </Pressable>
        ))}
        {visible.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.row}>
            {t('pets.breedPicker.noResults')}
          </ThemedText>
        ) : null}
      </View>

      {results.length > visible.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('pets.breedPicker.moreResults')}
        </ThemedText>
      ) : null}

      <Button variant="link" label={t('pets.breedPicker.other')} onPress={onChooseOther} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  results: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
