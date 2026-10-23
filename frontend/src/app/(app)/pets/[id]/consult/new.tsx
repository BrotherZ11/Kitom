import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { Camera, ChartLine, ImageIcon, ListChecks } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { TopBar, TopBarText } from '@/components/ui/top-bar';
import { nextMonthStart, toggleSymptom, toRequestErrorCode, type Entitlement } from '@/features/ai-analysis/ai-analysis-model';
import { ConsultGate } from '@/features/ai-analysis/components/consult-gate';
import { EmergencyHint } from '@/features/ai-analysis/components/consult-parts';
import { useEntitlement, useRequestAnalysis, useSymptoms } from '@/features/ai-analysis/hooks/use-ai-analysis';
import { pickPetPhoto, type PetPhotoSource } from '@/features/pets/pet-photo-picker';
import { petErrorMessage } from '@/features/pets/pet-errors';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import type { Pet } from '@/features/pets/types';
import { formatFullDate } from '@/features/reminders/reminder-format';
import { getLocale, t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { radius, spacing } from '@/theme/tokens';

type Step = 'intro' | 'photo' | 'signs' | 'review';

/**
 * Nueva consulta (tableros 7.1–7.6 y 7.13): introducción, foto opcional con su consentimiento, señales,
 * revisión y envío. El cupo y la compatibilidad de las señales los decide el servidor.
 */
export default function NewConsultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ConsultGate petId={id} requireEdit>
      {(pet) => <NewConsult pet={pet} />}
    </ConsultGate>
  );
}

function NewConsult({ pet }: { pet: Pet }) {
  const router = useRouter();
  const entitlement = useEntitlement();
  const symptoms = useSymptoms(pet.species_id);
  const request = useRequestAnalysis(pet.id);
  const [step, setStep] = useState<Step>('intro');
  const [photo, setPhoto] = useState<PreparedPetPhoto | null>(null);
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [guard] = useState(createSubmitGuard);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (entitlement.isPending) {
    return (
      <Screen align="top">
        <TopBar onBack={close} />
        <LoadingState />
      </Screen>
    );
  }
  if (entitlement.isError || !entitlement.data) {
    return (
      <Screen align="top">
        <TopBar onBack={close} />
        <ErrorState message={t('consult.errors.unknown')} onRetry={() => void entitlement.refetch()} />
      </Screen>
    );
  }
  const quota = entitlement.data;
  if (!quota.canRequest) return <LimitView quota={quota} onClose={close} />;

  const remaining = quota.monthlyLimit === null ? t('consult.unlimited') : tf('consult.remaining', { used: quota.usedThisMonth, limit: quota.monthlyLimit });

  const pick = async (source: PetPhotoSource) => {
    setPhotoError(null);
    try {
      const picked = await pickPetPhoto(source);
      if (picked) {
        setPhoto(picked);
        setConsent(false);
      }
    } catch (error) {
      setPhotoError(petErrorMessage(error));
    }
  };

  const send = () => {
    void guard.run(async () => {
      setSubmitError(null);
      try {
        const analysisId = await request.mutateAsync({ photo, photoPath: null, symptomIds: selected });
        router.replace({ pathname: '/pets/[id]/consult/[analysisId]', params: { id: pet.id, analysisId } });
      } catch (error) {
        const code = toRequestErrorCode(error);
        setSubmitError(t(`consult.errors.${code}`));
        if (code === 'limit') void entitlement.refetch();
      }
    });
  };

  if (step === 'intro') {
    return (
      <Screen
        align="top"
        footer={
          <>
            <Button label={t('consult.intro.start')} onPress={() => setStep('photo')} />
            <Button
              label={t('consult.intro.previous')}
              variant="ghost"
              size="md"
              onPress={() => router.push({ pathname: '/pets/[id]/consult', params: { id: pet.id } })}
            />
          </>
        }>
        <TopBar onBack={close} />
        <View style={styles.heading}>
          <View style={styles.headingRow}>
            <Text variant="overline" color="inkMuted" style={styles.flex}>
              {pet.name}
            </Text>
            <Tag label={remaining} />
          </View>
          <Text variant="title1" accessibilityRole="header">
            {t('consult.intro.title')}
          </Text>
          <Text color="inkMuted">{t('consult.intro.text')}</Text>
        </View>
        <Card flush>
          <ListItem icon={Camera} title={t('consult.intro.photoTitle')} subtitle={t('consult.intro.photoText')} divider />
          <ListItem icon={ListChecks} title={t('consult.intro.signsTitle')} subtitle={t('consult.intro.signsText')} divider />
          <ListItem
            icon={ChartLine}
            title={t('consult.intro.historyTitle')}
            subtitle={quota.fullHistory ? t('consult.intro.historyFull') : t('consult.intro.historyText')}
          />
        </Card>
        <Alert tone="info" title={t('consult.intro.noticeTitle')} message={t('consult.intro.noticeText')} />
        <EmergencyHint />
        <Text variant="caption" color="inkMuted">
          {t('consult.intro.privacy')}
        </Text>
      </Screen>
    );
  }

  if (step === 'photo') {
    return (
      <Screen
        align="top"
        footer={
          photo ? (
            <Button label={t('consult.photo.continue')} disabled={!consent} onPress={() => setStep('signs')} />
          ) : (
            <Button label={t('consult.photo.skip')} variant="secondary" onPress={() => setStep('signs')} />
          )
        }>
        <TopBar onBack={() => setStep('intro')} title={t('consult.photo.title')} right={<TopBarText text={tf('consult.step', { step: 1 })} mono />} />
        <Text color="inkMuted">{t('consult.photo.text')}</Text>
        {photo ? (
          <>
            <Image
              source={{ uri: photo.uri }}
              style={styles.preview}
              contentFit="cover"
              accessibilityLabel={t('consult.photo.previewA11y')}
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label={t('consult.photo.change')} variant="secondary" size="md" onPress={() => void pick('camera')} />
              </View>
              <View style={styles.flex}>
                <Button
                  label={t('consult.photo.remove')}
                  variant="secondary"
                  size="md"
                  onPress={() => {
                    setPhoto(null);
                    setConsent(false);
                  }}
                />
              </View>
            </View>
            <Alert tone="warning" title={t('consult.photo.peopleTitle')} message={t('consult.photo.peopleText')} />
            <Checkbox checked={consent} onChange={setConsent} label={t('consult.photo.consent')} />
            <Text variant="caption" color="inkMuted">
              {t('consult.photo.consentText')}
            </Text>
          </>
        ) : (
          <View style={styles.pickers}>
            <Button label={t('consult.photo.take')} icon={Camera} onPress={() => void pick('camera')} />
            <Button label={t('consult.photo.gallery')} icon={ImageIcon} variant="secondary" onPress={() => void pick('library')} />
          </View>
        )}
        {photoError ? <Alert tone="error" message={photoError} /> : null}
      </Screen>
    );
  }

  if (step === 'signs') {
    const catalog = symptoms.data ?? [];
    return (
      <Screen
        align="top"
        footer={
          <Button
            label={selected.length ? t('consult.signs.continue') : t('consult.signs.none')}
            disabled={selected.length === 0}
            onPress={() => setStep('review')}
          />
        }>
        <TopBar onBack={() => setStep('photo')} title={t('consult.signs.title')} right={<TopBarText text={tf('consult.step', { step: 2 })} mono />} />
        <Text color="inkMuted">{t('consult.signs.text')}</Text>
        {symptoms.isPending ? (
          <LoadingState variant="inline" />
        ) : symptoms.isError ? (
          <ErrorState message={t('consult.signs.loadError')} onRetry={() => void symptoms.refetch()} />
        ) : (
          <View style={styles.chips}>
            {catalog.map((symptom) => (
              <Chip
                key={symptom.id}
                label={symptom.label}
                selected={selected.includes(symptom.id)}
                onPress={() => setSelected((current) => toggleSymptom(current, symptom.id, catalog.map((item) => item.id)))}
              />
            ))}
          </View>
        )}
      </Screen>
    );
  }

  const labels = (symptoms.data ?? []).filter((symptom) => selected.includes(symptom.id)).map((symptom) => symptom.label);
  return (
    <Screen
      align="top"
      footer={
        <>
          {submitError ? <Alert tone="error" message={submitError} /> : null}
          <Button label={t('consult.review.send')} loading={request.isPending} loadingLabel={t('consult.review.sending')} onPress={send} />
        </>
      }>
      <TopBar onBack={() => setStep('signs')} title={t('consult.review.title')} right={<TopBarText text={tf('consult.step', { step: 3 })} mono />} />
      <Card flush>
        <ListItem
          icon={photo ? Camera : ImageIcon}
          title={photo ? t('consult.review.photo') : t('consult.review.noPhoto')}
          trailing={<Button label={t('consult.review.change')} variant="ghost" size="sm" onPress={() => setStep('photo')} />}
          divider
        />
        <View style={styles.signs}>
          <View style={styles.between}>
            <Text variant="bodyStrong">{t('consult.review.signs')}</Text>
            <Button label={t('consult.review.change')} variant="ghost" size="sm" onPress={() => setStep('signs')} />
          </View>
          <View style={styles.chips}>
            {labels.map((label) => (
              <Tag key={label} label={label} tone="brand" />
            ))}
          </View>
        </View>
      </Card>
      {quota.monthlyLimit !== null ? (
        <Text variant="caption" color="inkMuted">
          {tf('consult.review.uses', { limit: quota.monthlyLimit })}
        </Text>
      ) : null}
    </Screen>
  );
}

/** Límite del plan (tablero 7.13). Premium aún no existe: se dice sin presionar. */
function LimitView({ quota, onClose }: { quota: Entitlement; onClose: () => void }) {
  return (
    <Screen align="top" footer={<Button label={t('consult.limit.back')} variant="secondary" onPress={onClose} />}>
      <TopBar onBack={onClose} />
      <View style={styles.heading}>
        <Text variant="overline" color="inkMuted">
          {t('consult.limit.overline')}
        </Text>
        <Text variant="title1" accessibilityRole="header">
          {tf('consult.limit.title', { limit: quota.monthlyLimit ?? quota.usedThisMonth })}
        </Text>
        <Text color="inkMuted">
          {tf('consult.limit.text', { date: formatFullDate(nextMonthStart(new Date()), getLocale()) })}
        </Text>
      </View>
      <EmergencyHint />
      <Card variant="brand" style={styles.premium}>
        <View style={styles.between}>
          <Text variant="bodyStrong">{t('consult.limit.premiumTitle')}</Text>
          <Tag label={t('consult.limit.premiumSoon')} />
        </View>
        <Text color="inkMuted">{t('consult.limit.premiumUnlimited')}</Text>
        <Text color="inkMuted">{t('consult.limit.premiumHistory')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['2'],
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
  },
  row: {
    flexDirection: 'row',
    gap: spacing['3'],
  },
  flex: {
    flex: 1,
  },
  pickers: {
    gap: spacing['3'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
  signs: {
    gap: spacing['2'],
    paddingVertical: spacing['3'],
    paddingHorizontal: spacing['4'],
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['2'],
  },
  premium: {
    gap: spacing['2'],
  },
});
