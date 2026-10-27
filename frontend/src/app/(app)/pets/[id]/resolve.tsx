import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { OptionGroup } from '@/components/ui/option-group';
import { EmptyState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import { usePetContentLines } from '@/features/pets/components/pet-sync-status';
import { usePetSyncActions } from '@/features/pets/hooks/use-pet-writes';
import { usePet } from '@/features/pets/hooks/use-pets';
import {
  chooseContent,
  contentOf,
  mergePetContent,
  PET_FIELD_GROUPS,
  type PetFieldGroup,
} from '@/features/pets/offline/pet-operation';
import type { PetFields } from '@/features/pets/types';
import { t, type TranslationKey } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { spacing } from '@/theme/tokens';

/** Etiqueta de cada grupo de datos (la raza va con la especie: dependen la una de la otra). */
const GROUP_LABEL: Record<PetFieldGroup, TranslationKey> = {
  name: 'pets.fields.name',
  species: 'pets.fields.species',
  sex: 'pets.fields.sex',
  birth_date: 'pets.fields.birthDate',
  weight_kg: 'pets.fields.weightKg',
  sterilized: 'pets.fields.sterilized',
  known_conditions: 'pets.fields.knownConditions',
  allergies: 'pets.fields.allergies',
  temperament_notes: 'pets.fields.temperamentNotes',
};

/** Líneas (etiqueta: valor) que muestran un grupo. */
const GROUP_LINES: Record<PetFieldGroup, TranslationKey[]> = {
  ...(Object.fromEntries(Object.entries(GROUP_LABEL).map(([group, label]) => [group, [label]])) as Record<PetFieldGroup, TranslationKey[]>),
  species: ['pets.fields.species', 'pets.fields.breed'],
};

/**
 * Conflicto de una edición guardada en el dispositivo (fase 8): la mascota cambió en el servidor en los
 * mismos datos. Se enseñan los dos valores de cada dato en conflicto y el usuario elige; lo que no choca
 * se conserva (lo suyo y lo del servidor) sin preguntar. Nunca se unen textos. Al guardar, el motor
 * vuelve a leer el servidor: si cambió otra vez, se vuelve a pedir; si no, se envía con la precondición
 * de la versión que vio el usuario.
 */
export default function ResolvePetConflictScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const pet = usePet(id);
  const actions = usePetSyncActions();
  const lines = usePetContentLines();
  const [guard] = useState(createSubmitGuard);
  const [choices, setChoices] = useState<Partial<Record<PetFieldGroup, 'local' | 'remote'>>>({});
  const [shownVersion, setShownVersion] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id } }));

  const frame = (content: ReactNode) => (
    <Screen align="top">
      <TopBar onBack={back} title={t('pets.sync.resolveScreen.title')} />
      {content}
    </Screen>
  );

  const op = pet.op;
  if (pet.view.state === 'loading' && !op) return frame(<LoadingState />);
  // Un conflicto de eliminación se decide en la ficha (`PetDeletionNotice`), no aquí.
  if (!op || op.kind !== 'update' || op.status !== 'conflict' || !op.baseRow) {
    return frame(<EmptyState title={t('pets.sync.resolveScreen.nothing')} actionLabel={t('common.back')} onAction={back} />);
  }
  const remoteRow = op.conflictRemote;
  if (!remoteRow) {
    // Aún no se ha podido leer la versión del servidor (sin conexión): se intentará al reintentar.
    return frame(
      <Alert
        tone="warning"
        message={t('pets.sync.resolveScreen.unavailable')}
        action={{ label: t('common.retry'), onPress: () => void actions.retry(op.localId) }}
      />
    );
  }

  // Si el servidor cambió desde que se abrió, las elecciones anteriores ya no valen.
  if (shownVersion !== remoteRow.updated_at) {
    setShownVersion(remoteRow.updated_at);
    setChoices({});
  }

  const local = op.content;
  const remote = contentOf(remoteRow);
  const { merged, conflicts } = mergePetContent(contentOf(op.baseRow), local, remote);
  const complete = conflicts.every((group) => choices[group]);
  const valuesOf = (content: PetFields, group: PetFieldGroup) => {
    const wanted = GROUP_LINES[group].map((key) => t(key));
    return lines(content)
      .filter((line) => wanted.includes(line.label))
      .map((line) => (GROUP_LINES[group].length > 1 ? `${line.label}: ${line.value}` : line.value))
      .join(' · ');
  };

  const save = () => {
    void guard.run(async () => {
      setSaving(true);
      setMessage(null);
      try {
        const outcome = await actions.resolveConflict(op.localId, {
          content: chooseContent(merged, local, remote, choices),
          shownRemote: remoteRow,
        });
        switch (outcome) {
          case 'synced':
            toast({ message: t('pets.sync.resolveScreen.saved') });
            back();
            return;
          case 'pending':
            toast({ message: t('pets.sync.resolveScreen.savedLocally') });
            back();
            return;
          case 'not_in_conflict':
            back();
            return;
          case 'conflict':
            setMessage(t('pets.sync.resolveScreen.changedAgain'));
            return;
          case 'unavailable':
            setMessage(t('pets.sync.resolveScreen.unavailable'));
            return;
          case 'forbidden':
            setMessage(t('pets.sync.resolveScreen.forbidden'));
            return;
          case 'failed':
            setMessage(t('pets.sync.resolveScreen.failed'));
            return;
        }
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <Screen
      align="top"
      footer={
        <>
          {message ? <Alert tone="warning" message={message} /> : null}
          <Button label={t('pets.sync.resolveScreen.save')} loading={saving} disabled={!complete} onPress={save} />
        </>
      }>
      <TopBar onBack={back} title={t('pets.sync.resolveScreen.title')} />
      <Text color="inkMuted">{t('pets.sync.resolveScreen.intro')}</Text>
      {conflicts.map((group) => (
        <Card key={group} style={styles.group}>
          <Text variant="bodyStrong">{t(GROUP_LABEL[group])}</Text>
          <View style={styles.values}>
            <Text variant="caption" color="inkMuted">
              {t('pets.sync.resolveScreen.yours')}
            </Text>
            <Text selectable>{valuesOf(local, group)}</Text>
            <Text variant="caption" color="inkMuted">
              {t('pets.sync.resolveScreen.theirs')}
            </Text>
            <Text selectable>{valuesOf(remote, group)}</Text>
          </View>
          <OptionGroup
            label={t(GROUP_LABEL[group])}
            options={[
              { value: 'local', label: t('pets.sync.resolveScreen.yours') },
              { value: 'remote', label: t('pets.sync.resolveScreen.theirs') },
            ]}
            value={choices[group] ?? null}
            onChange={(choice) => setChoices((current) => ({ ...current, [group]: choice }))}
          />
        </Card>
      ))}
      {PET_FIELD_GROUPS.length > conflicts.length ? <Text variant="caption" color="inkMuted">{t('pets.sync.resolveScreen.kept')}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing['3'],
  },
  values: {
    gap: spacing['1'],
  },
});
