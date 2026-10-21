import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { CircleAlert, Clock, Lock, RefreshCw, Trash, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Tag, type TagTone } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { usePetSyncActions } from '@/features/pets/hooks/use-pet-writes';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { canDiscardPetOperation, type LocalPetOperation, type PetSyncDisplay } from '@/features/pets/offline/pet-operation';
import { formatBirthDate, formatBreed, formatList, formatSex, formatSterilized, formatWeight } from '@/features/pets/pet-format';
import type { PetFields } from '@/features/pets/types';
import { t, type TranslationKey } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** Texto, icono y tono de cada estado: nunca solo color. */
const STATUS: Record<PetSyncDisplay, { icon: LucideIcon; tone: TagTone }> = {
  pending_create: { icon: Clock, tone: 'neutral' },
  pending_update: { icon: Clock, tone: 'neutral' },
  syncing: { icon: RefreshCw, tone: 'neutral' },
  uncertain: { icon: RefreshCw, tone: 'neutral' },
  conflict: { icon: TriangleAlert, tone: 'danger' },
  failed: { icon: CircleAlert, tone: 'danger' },
  forbidden: { icon: Lock, tone: 'danger' },
};

export function petSyncLabel(display: PetSyncDisplay): string {
  return t(`pets.sync.status.${display}` as TranslationKey);
}

/** Estado de sincronización en una etiqueta (icono + texto). Sincronizada: no ocupa sitio. */
export function PetSyncTag({ display }: { display: PetSyncDisplay | null }) {
  if (!display) return null;
  const spec = STATUS[display];
  return <Tag label={petSyncLabel(display)} tone={spec.tone} icon={spec.icon} />;
}

/** Los datos editables como texto legible (para revisarlos o copiarlos). */
export function usePetContentLines() {
  const species = useSpecies();
  return (content: PetFields): { label: string; value: string }[] => {
    const speciesName = species.data?.find((item) => item.id === content.species_id)?.name ?? t('common.notSpecified');
    const value = (text: string | null) => text ?? t('common.notSpecified');
    return [
      { label: t('pets.fields.name'), value: content.name },
      { label: t('pets.fields.species'), value: speciesName },
      // Una raza del catálogo sin su nombre a mano (sin conexión) se dice, no se inventa.
      { label: t('pets.fields.breed'), value: value(formatBreed(content, null)) },
      { label: t('pets.fields.sex'), value: formatSex(content) },
      { label: t('pets.fields.birthDate'), value: value(formatBirthDate(content.birth_date)) },
      { label: t('pets.fields.weightKg'), value: value(formatWeight(content.weight_kg)) },
      { label: t('pets.fields.sterilized'), value: formatSterilized(content.sterilized) },
      { label: t('pets.fields.knownConditions'), value: value(formatList(content.known_conditions)) },
      { label: t('pets.fields.allergies'), value: value(formatList(content.allergies)) },
      { label: t('pets.fields.temperamentNotes'), value: value(content.temperament_notes) },
    ];
  };
}

type PetSyncNoticeProps = {
  op: LocalPetOperation | null;
  display: PetSyncDisplay | null;
  /** Tras descartar un borrador (la mascota deja de existir en el dispositivo). */
  onDiscarded?: () => void;
};

/**
 * Aviso del estado de una mascota con cambios guardados solo en el dispositivo, con lo que se puede
 * hacer: reintentar, revisar un conflicto, corregir los datos o descartarlos (solo en el dispositivo,
 * con confirmación). Sin permiso, los datos locales se muestran para poder copiarlos.
 */
export function PetSyncNotice({ op, display, onDiscarded }: PetSyncNoticeProps) {
  const router = useRouter();
  const toast = useToast();
  const actions = usePetSyncActions();
  const lines = usePetContentLines();
  const [confirming, setConfirming] = useState(false);
  if (!op || !display) return null;

  const failedOnServer = display === 'failed' && op.lastError?.kind !== 'validation';
  const detailKey = failedOnServer ? 'failedServer' : display;
  const action =
    display === 'conflict'
      ? { label: t('pets.sync.resolve'), onPress: () => router.push({ pathname: '/pets/[id]/resolve', params: { id: op.localId } }) }
      : display === 'failed' && !failedOnServer
        ? { label: t('pets.sync.fix'), onPress: () => router.push({ pathname: '/pets/[id]/edit', params: { id: op.localId } }) }
        : display === 'failed' || display === 'uncertain' || display === 'pending_create' || display === 'pending_update'
          ? { label: t('pets.sync.retry'), onPress: () => void actions.retry(op.localId) }
          : undefined;
  const danger = display === 'conflict' || display === 'failed' || display === 'forbidden';

  return (
    <View style={styles.container}>
      <Alert
        tone={danger ? 'warning' : 'info'}
        icon={STATUS[display].icon}
        title={petSyncLabel(display)}
        message={t(`pets.sync.detail.${detailKey}` as TranslationKey)}
        action={action}
      />
      {display === 'forbidden' ? (
        <Card style={styles.data}>
          <Text variant="caption" color="inkMuted">
            {t('pets.sync.localData')}
          </Text>
          {lines(op.content).map((line) => (
            <Text key={line.label} variant="caption" selectable>
              {`${line.label}: ${line.value}`}
            </Text>
          ))}
        </Card>
      ) : null}
      {canDiscardPetOperation(op) && display !== 'syncing' ? (
        <Button
          variant="dangerGhost"
          size="md"
          icon={Trash}
          label={op.kind === 'create' ? t('pets.sync.discardDraft') : t('pets.sync.discard')}
          onPress={() => setConfirming(true)}
        />
      ) : null}
      <Dialog
        visible={confirming}
        tone="danger"
        icon={Trash}
        title={t('pets.sync.discardTitle')}
        message={t('pets.sync.discardText')}
        confirmLabel={t('pets.sync.discardConfirm')}
        onConfirm={async () => {
          setConfirming(false);
          if ((await actions.discard(op.localId)) === 'discarded') {
            toast({ message: t('pets.sync.discarded') });
            onDiscarded?.();
          }
        }}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['2'],
  },
  data: {
    gap: spacing['1'],
  },
});
