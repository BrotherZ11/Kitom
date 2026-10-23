import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ChevronLeft } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { StepDots } from '@/components/ui/step-dots';
import { Text } from '@/components/ui/text';
import { t, tf } from '@/i18n';
import { size, spacing } from '@/theme/tokens';

export const SETUP_STEPS = 3;

type SetupFrameProps = {
  /** Paso de la configuración (1–3); sin él, no se muestran los puntos (p. ej. «Mascota creada»). */
  step?: number;
  onBack?: () => void;
  overline?: string;
  title: string;
  text?: string;
  /** Elemento sobre el título (icono del aviso). */
  hero?: ReactNode;
  footer: ReactNode;
  children?: ReactNode;
};

/** Pantalla de la configuración inicial (tableros 2.1–2.4 y 3.4): atrás, pasos, título y pie fijo. */
export function SetupFrame({ step, onBack, overline, title, text, hero, footer, children }: SetupFrameProps) {
  return (
    <Screen align="top" gap={22} footer={footer}>
      <View style={styles.top}>
        {onBack ? (
          <IconButton icon={ChevronLeft} accessibilityLabel={t('common.back')} onPress={onBack} />
        ) : (
          <View style={styles.spacer} />
        )}
        {step ? (
          <StepDots step={step} total={SETUP_STEPS} accessibilityLabel={tf('setup.step', { step, total: SETUP_STEPS })} />
        ) : null}
        <View style={styles.spacer} />
      </View>
      <View style={styles.heading}>
        {hero}
        {overline ? (
          <Text variant="overline" color="inkMuted">
            {overline}
          </Text>
        ) : null}
        <Text variant="title1" accessibilityRole="header">
          {title}
        </Text>
        {text ? <Text color="inkMuted">{text}</Text> : null}
      </View>
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: {
    width: size.touchMin,
  },
  heading: {
    gap: spacing['2'],
  },
});
