import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowLeftRight, Camera, ChartLine, ChevronLeft, FileText, Pencil, Plus, Settings, Users } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { WeekRing } from '@/components/ui/week-ring';
import { lastDays } from '@/components/ui/chart-geometry';
import { useAuth } from '@/features/auth/auth-context';
import { useTodayLogDate } from '@/features/daily-logs/hooks/use-today-log-date';
import { useWeekOverview } from '@/features/daily-logs/hooks/use-week-overview';
import { TodayLogCard } from '@/features/daily-logs/components/today-log-card';
import { PetDetails } from '@/features/pets/components/pet-details';
import { PetPhotoEditor } from '@/features/pets/components/pet-photo-editor';
import { PetSelectorSheet } from '@/features/pets/components/pet-selector-sheet';
import { useBreed } from '@/features/pets/hooks/use-breeds';
import { usePetPhotoUrl } from '@/features/pets/hooks/use-pet-photo';
import { useCanEditPet, usePetStreak } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { petErrorMessage } from '@/features/pets/pet-errors';
import { formatBreed } from '@/features/pets/pet-format';
import { currentStreak, missingProfileFields, petAge, PROFILE_FIELDS } from '@/features/pets/pet-profile';
import type { Pet } from '@/features/pets/types';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { fontFamily, layout, radius, spacing } from '@/theme/tokens';

type PetProfileProps = {
  pet: Pet;
  /**
   * `tab`: pestaña Perfil (cambiar de mascota y cuenta arriba). `stack`: abierta desde la lista de
   * mascotas (`/pets/[id]`), con «Volver».
   */
  mode: 'tab' | 'stack';
  /** Abre el historial de esta mascota. */
  onOpenHistory: () => void;
  /** Aviso bajo la cabecera (p. ej. la foto no se pudo subir al crearla). */
  notice?: ReactNode;
};

/** Foto de cabecera: 220 desde el borde superior, barra de estado (44 en el tablero) incluida. */
const HEADER_HEIGHT = 220;
const BOARD_STATUS_BAR = 44;

/**
 * Perfil de la mascota (tablero 3.6). Datos reales: la ficha (`pets`), la racha que calcula el
 * servidor (`pet_streaks`) y los permisos (`can_edit_pet`, solo para decidir qué se ofrece). Lo que
 * aún no existe (consultas con foto, co-tutores, informe) se marca «Próximamente» y no se pulsa.
 */
export function PetProfile({ pet, mode, onOpenHistory, notice }: PetProfileProps) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canEdit = useCanEditPet(pet.id).data === true;
  const species = useSpecies();
  const breed = useBreed(pet.breed_id);
  const streak = usePetStreak(pet.id);
  const photoUrl = usePetPhotoUrl(pet.photo_path);
  const today = useTodayLogDate();
  const week = useWeekOverview(pet.id);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const speciesName = species.data?.find((item) => item.id === pet.species_id)?.name ?? null;
  const breedLabel = formatBreed(pet, breed.data?.name ?? null);
  const age = today ? petAge(pet.birth_date, today) : null;
  const ageLabel = age
    ? age.unit === 'newborn'
      ? t('pets.profile.age.newborn')
      : age.unit === 'months'
        ? age.count === 1
          ? t('pets.profile.age.month')
          : tf('pets.profile.age.months', { count: age.count })
        : age.count === 1
          ? t('pets.profile.age.year')
          : tf('pets.profile.age.years', { count: age.count })
    : null;
  const subtitle = [speciesName, breedLabel, ageLabel].filter(Boolean).join(' · ');
  const isShared = pet.owner_id !== user?.id;
  const missing = missingProfileFields(pet);
  const filled = PROFILE_FIELDS.length - missing.length;
  const goEdit = () => router.push({ pathname: '/pets/[id]/edit', params: { id: pet.id } });

  const yesterday = today ? lastDays(today, 2)[0] : null;
  const current = streak.data && yesterday ? currentStreak(streak.data, yesterday) : 0;
  const best = streak.data?.longest_streak ?? 0;

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View
          style={[styles.header, { height: HEADER_HEIGHT - BOARD_STATUS_BAR + insets.top, backgroundColor: theme.surfaceWarm }]}>
          {photoUrl.data && pet.photo_path ? (
            <Image
              source={{ uri: photoUrl.data, cacheKey: pet.photo_path }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessibilityLabel={`${t('pets.fields.photo')}: ${pet.name}`}
            />
          ) : (
            <View style={[styles.placeholder, { paddingTop: insets.top }]}>
              <Avatar name={pet.name} size="xl" tone="warm" />
            </View>
          )}
          <View style={[styles.headerActions, { top: insets.top + 10 }]}>
            {mode === 'tab' ? (
              <IconButton
                variant="soft"
                icon={ArrowLeftRight}
                accessibilityLabel={t('pets.profile.swap')}
                onPress={() => setSelectorOpen(true)}
              />
            ) : (
              <IconButton
                variant="soft"
                icon={ChevronLeft}
                accessibilityLabel={t('common.back')}
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
              />
            )}
            <IconButton
              variant="soft"
              icon={Settings}
              accessibilityLabel={t('pets.profile.settings')}
              onPress={() => router.push('/settings')}
            />
          </View>
          {/* Foto: cambiar, elegir o quitar (hoja 3.2), como antes desde la ficha. */}
          <View style={styles.photoAction}>
            <PetPhotoEditor
              pet={pet}
              canEdit={canEdit}
              trigger={(open) => (
                <IconButton
                  variant="soft"
                  icon={Camera}
                  accessibilityLabel={t('pets.edit.changePhoto')}
                  onPress={open}
                />
              )}
            />
          </View>
        </View>

        <View style={styles.body}>
          {notice}
          {photoUrl.isError ? (
            <Alert
              tone="warning"
              message={petErrorMessage(photoUrl.error)}
              action={{ label: t('common.retry'), onPress: () => void photoUrl.refetch() }}
            />
          ) : null}
          <View style={styles.between}>
            <View style={styles.flex}>
              <Text variant="title1" accessibilityRole="header">
                {pet.name}
              </Text>
              {subtitle ? <Text color="inkMuted">{subtitle}</Text> : null}
              {isShared ? (
                <View style={styles.sharedTag}>
                  <Tag label={t('pets.list.shared')} tone="brand" icon={Users} />
                </View>
              ) : null}
            </View>
            {canEdit ? (
              <Button variant="secondary" size="sm" icon={Pencil} label={t('pets.profile.edit')} onPress={goEdit} />
            ) : null}
          </View>

          {canEdit && missing.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${tf('pets.profile.completeTitle', { name: pet.name })}. ${filled}/${PROFILE_FIELDS.length}`}
              onPress={goEdit}>
              <Card variant="brand" style={styles.complete}>
                <View style={styles.between}>
                  <Text variant="bodyStrong" style={styles.flex}>
                    {tf('pets.profile.completeTitle', { name: pet.name })}
                  </Text>
                  <Text variant="data">{`${filled}/${PROFILE_FIELDS.length}`}</Text>
                </View>
                <ProgressBar value={filled / PROFILE_FIELDS.length} />
                <Text variant="caption" color="inkMuted">
                  {tf('pets.profile.completeText', {
                    fields: missing.map((field) => t(`pets.profile.missing.${field}`)).join(', '),
                  })}
                </Text>
              </Card>
            </Pressable>
          ) : null}

          {streak.data !== undefined ? (
            <Card style={styles.streak}>
              <WeekRing
                days={week.state === 'ready' ? week.overview.days : ['off', 'off', 'off', 'off', 'off', 'off']}
                today={week.state === 'ready' ? (week.overview.today ? 'done' : 'pending') : 'none'}
                text={String(current)}
                textSize={14}
                size={56}
                accessibilityLabel={
                  current === 1 ? t('pets.profile.streakOne') : tf('pets.profile.streakTitle', { count: current })
                }
              />
              <View style={styles.flex}>
                <Text variant="bodyStrong">
                  {current === 0
                    ? t('pets.profile.streakNone')
                    : current === 1
                      ? t('pets.profile.streakOne')
                      : tf('pets.profile.streakTitle', { count: current })}
                </Text>
                <Text variant="caption" color="inkMuted">
                  {best === 0
                    ? t('pets.profile.streakStart')
                    : best === 1
                      ? t('pets.profile.streakBestOne')
                      : tf('pets.profile.streakBest', { count: best })}
                </Text>
              </View>
            </Card>
          ) : null}

          {/* Desde una ficha concreta (no la mascota activa), el registro de hoy de esa mascota. */}
          {mode === 'stack' ? <TodayLogCard petId={pet.id} canEdit={canEdit} showHistoryLink={false} /> : null}

          <PetDetails pet={pet} speciesName={speciesName} breedLabel={breedLabel} isShared={isShared} />

          <Section title={tf('pets.profile.care', { name: pet.name })}>
            <ListItem
              icon={ChartLine}
              title={t('pets.profile.history')}
              subtitle={t('pets.profile.historyText')}
              onPress={onOpenHistory}
              divider
            />
            <ListItem
              icon={Camera}
              title={t('pets.profile.consult')}
              subtitle={t('pets.profile.consultText')}
              trailing={<SoonMark />}
            />
          </Section>

          {mode === 'tab' ? (
            <Card flush>
              <ListItem icon={Plus} title={t('petSelector.add')} onPress={() => router.push('/pets/new')} />
            </Card>
          ) : null}

          <Section title={t('pets.profile.soon')}>
            <ListItem
              icon={Users}
              title={t('pets.profile.coTutors')}
              subtitle={tf('pets.profile.coTutorsText', { name: pet.name })}
              trailing={<SoonMark />}
              divider
            />
            <ListItem
              icon={FileText}
              title={t('pets.profile.report')}
              subtitle={t('pets.profile.reportText')}
              trailing={<SoonMark />}
            />
          </Section>
        </View>
      </ScrollView>
      {mode === 'tab' ? <PetSelectorSheet visible={selectorOpen} onClose={() => setSelectorOpen(false)} /> : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" color="inkMuted" accessibilityRole="header">
        {title}
      </Text>
      <Card flush>{children}</Card>
    </View>
  );
}

/** Marca «Próximamente» (`.tmark`): informa, no se pulsa. */
function SoonMark() {
  const theme = useTheme();
  return (
    <View style={[styles.soon, { backgroundColor: theme.surfaceSunken }]}>
      <Text color="inkMuted" style={styles.soonText}>
        {t('common.soon')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing['6'],
  },
  header: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: 'hidden',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAction: {
    position: 'absolute',
    right: spacing['4'],
    bottom: spacing['4'],
  },
  headerActions: {
    position: 'absolute',
    left: spacing['4'],
    right: spacing['4'],
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  body: {
    gap: 22,
    paddingTop: 22,
    paddingHorizontal: layout.screenGutter,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3'],
  },
  sharedTag: {
    marginTop: spacing['2'],
  },
  complete: {
    gap: 10,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  section: {
    gap: spacing['2'],
  },
  soon: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  soonText: {
    fontFamily: fontFamily.sans600,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
  },
});
