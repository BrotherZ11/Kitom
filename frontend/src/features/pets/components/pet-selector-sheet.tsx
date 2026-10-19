import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Plus } from '@/components/ui/icons';
import { PressedOverlay } from '@/components/ui/pressed-overlay';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/auth-context';
import { useActivePet } from '@/features/pets/active-pet-context';
import { PetPhoto } from '@/features/pets/components/pet-photo';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { borderWidth, radius, size, spacing } from '@/theme/tokens';

type PetSelectorSheetProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Selector de mascota (hoja 3.9): la elegida es la que se ve en Hoy, Historial, Agenda y Perfil.
 * «Añadir otra mascota» abre el alta; el límite del plan lo decide el servidor al crearla.
 */
export function PetSelectorSheet({ visible, onClose }: PetSelectorSheetProps) {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const { pets, activePet, setActivePet } = useActivePet();
  const species = useSpecies();
  const speciesName = (id: string) => species.data?.find((item) => item.id === id)?.name ?? null;
  const list = pets.data ?? [];

  return (
    <BottomSheet visible={visible} title={t('petSelector.title')} onClose={onClose}>
      <Card flush accessibilityRole="radiogroup" accessibilityLabel={t('petSelector.title')}>
        {list.map((pet) => {
          const selected = pet.id === activePet?.id;
          const subtitle = [speciesName(pet.species_id), pet.owner_id !== user?.id ? t('pets.list.shared') : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              key={pet.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={[pet.name, subtitle].filter(Boolean).join(', ')}
              onPress={() => {
                setActivePet(pet.id);
                onClose();
              }}>
              {({ pressed }) => (
                <View style={[styles.option, { borderBottomColor: theme.line }]}>
                  {pressed ? <PressedOverlay /> : null}
                  <PetPhoto name={pet.name} photoPath={pet.photo_path} size="md" />
                  <View style={styles.text}>
                    <Text variant="bodyStrong">{pet.name}</Text>
                    {subtitle ? (
                      <Text variant="caption" color="inkMuted">
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.radio, { borderColor: selected ? theme.primary : theme.lineControl }]}>
                    {selected ? <View style={[styles.radioDot, { backgroundColor: theme.primary }]} /> : null}
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose();
            router.push('/pets/new');
          }}>
          {({ pressed }) => (
            <View style={styles.option}>
              {pressed ? <PressedOverlay /> : null}
              <View style={[styles.addTile, { backgroundColor: theme.surfaceSunken }]}>
                <Icon icon={Plus} size="sm" color="inkMuted" />
              </View>
              <Text variant="bodyStrong" style={styles.text}>
                {t('petSelector.add')}
              </Text>
            </View>
          )}
        </Pressable>
      </Card>
      <Text variant="caption" color="inkMuted">
        {t('petSelector.hint')}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: size.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: 10,
    paddingHorizontal: spacing['4'],
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: 'transparent',
  },
  text: {
    flex: 1,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
  },
  addTile: {
    width: size.avatarMd,
    height: size.avatarMd,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
