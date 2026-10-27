import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MAX_BREED_RESULTS, searchBreeds } from '@/features/pets/breed-search';
import { useBreed, useBreedCatalog } from '@/features/pets/hooks/use-breeds';
import { selectableBreeds } from '@/features/pets/offline/breed-catalog-view';
import { formatSavedAt } from '@/features/pets/offline/pet-view';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

type BreedPickerProps = {
  speciesId: string;
  /** `''` = ninguna seleccionada. */
  selectedBreedId: string;
  onSelect: (breedId: string) => void;
  /** El usuario indica que su raza no está en el catálogo (texto libre). */
  onChooseOther: () => void;
  error?: string | null;
};

/**
 * Buscador de razas activas de la especie, por nombre y alias. Sin conexión usa el catálogo guardado
 * en el dispositivo (`useBreedCatalog`); si nunca se guardó, lo dice y deja escribir la raza a mano.
 * Al llegar un catálogo nuevo (p. ej. al volver la conexión) la búsqueda y la raza elegida se conservan.
 */
export function BreedPicker({
  speciesId,
  selectedBreedId,
  onSelect,
  onChooseOther,
  error,
}: BreedPickerProps) {
  const theme = useTheme();
  const catalog = useBreedCatalog();
  // Raza elegida o ya guardada (activa o no): su nombre sale del catálogo o se pide por id.
  const selected = useBreed(selectedBreedId === '' ? null : selectedBreedId);
  const [query, setQuery] = useState('');

  const otherButton = (
    <Button variant="ghost" size="md" label={t('pets.breedPicker.other')} onPress={onChooseOther} />
  );

  if (selectedBreedId !== '') {
    // Sin catálogo (sin conexión y sin copia guardada) no se conoce el nombre: se dice.
    const name =
      selected.data?.name ??
      (selected.isPending ? t('common.loading') : t('pets.breedPicker.nameUnavailable'));
    return (
      <View style={styles.container}>
        <Text variant="caption" color="inkMuted">
          {t('pets.breedPicker.selected')}
        </Text>
        <Text variant="bodyStrong">{name}</Text>
        <Button
          variant="ghost"
          size="md"
          label={t('pets.breedPicker.change')}
          onPress={() => {
            setQuery('');
            onSelect('');
          }}
        />
      </View>
    );
  }

  const { view } = catalog;
  if (view.state === 'loading') return <LoadingState variant="inline" />;
  if (view.state !== 'ready') {
    // Sin el catálogo se puede seguir escribiendo la raza a mano (no lo necesita) o elegir otra respuesta.
    return (
      <View style={styles.container}>
        {view.state === 'offline_unavailable' ? (
          <ErrorState
            offline
            message={t('pets.breedPicker.offlineUnavailable')}
            description={t('pets.breedPicker.offlineUnavailableHint')}
            onRetry={catalog.retry}
          />
        ) : (
          <ErrorState
            message={view.state === 'local_error' ? t('pets.breedPicker.localError') : petErrorMessage(view.error)}
            onRetry={catalog.retry}
          />
        )}
        {otherButton}
      </View>
    );
  }

  const breeds = selectableBreeds(view.breeds, speciesId);
  const savedDate = view.source === 'device' ? formatSavedAt(view.savedAt, getLocale()) : null;
  const savedNotice =
    view.source === 'device' ? (
      <Text variant="caption" color="inkMuted">
        {savedDate ? tf('pets.breedPicker.savedCatalog', { date: savedDate }) : t('pets.breedPicker.savedCatalogUndated')}
      </Text>
    ) : null;

  if (breeds.length === 0) {
    // El catálogo (confirmado por el servidor) no tiene razas para esta especie.
    return (
      <View style={styles.container}>
        <Text variant="caption" color="inkMuted">
          {t('pets.breedPicker.emptyCatalog')}
        </Text>
        {savedNotice}
        {otherButton}
      </View>
    );
  }

  const results = searchBreeds(breeds, query);
  const visible = results.slice(0, MAX_BREED_RESULTS);

  return (
    <View style={styles.container}>
      {savedNotice}
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
        style={[styles.results, { borderColor: theme.line }]}
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
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
              pressed && { backgroundColor: theme.surfaceBrand },
            ]}>
            <Text>{breed.name}</Text>
          </Pressable>
        ))}
        {visible.length === 0 ? (
          <Text variant="caption" color="inkMuted" style={styles.row}>
            {t('pets.breedPicker.noResults')}
          </Text>
        ) : null}
      </View>

      {results.length > visible.length ? (
        <Text variant="caption" color="inkMuted">
          {t('pets.breedPicker.moreResults')}
        </Text>
      ) : null}

      {otherButton}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
  results: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing['3'],
    paddingVertical: spacing['2'],
  },
});
