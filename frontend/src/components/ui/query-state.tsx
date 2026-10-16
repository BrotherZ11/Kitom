import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CircleAlert, WifiOff } from '@/components/ui/icons';
import { KitomSymbol } from '@/components/ui/kitom-symbol';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

/** Estados comunes de una pantalla con datos: cargando, error y vacío (tablero 12 y EmptyState). */

/** Las cargas cortas no muestran nada: el indicador aparece a los 300 ms (PANTALLAS.md › 12.1). */
const LOADING_DELAY_MS = 300;

type LoadingStateProps = {
  /** `screen` (por defecto): esqueleto de pantalla. `inline`: indicador pequeño dentro de un bloque. */
  variant?: 'screen' | 'inline';
};

export function LoadingState({ variant = 'screen' }: LoadingStateProps) {
  const theme = useTheme();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      style={variant === 'inline' ? styles.inline : styles.skeleton}>
      {!isVisible ? null : variant === 'inline' ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <>
          <Skeleton width="45%" height={28} />
          <Skeleton height={120} radius={radius.lg} />
          <Skeleton width="80%" height={16} />
          <Skeleton width="60%" height={16} />
        </>
      )}
    </View>
  );
}

type EmptyStateProps = {
  /** `empty`: falta algo (símbolo de Kitom). `error` y `offline`: no se ha podido cargar. */
  kind?: 'empty' | 'error' | 'offline';
  title: string;
  description?: string;
  /** Una sola acción, la más útil. */
  actionLabel?: string;
  onAction?: () => void;
};

/** Estado vacío o de error de pantalla (docs/design/componentes/EmptyState). */
export function EmptyState({ kind = 'empty', title, description, actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();
  const isProblem = kind !== 'empty';

  return (
    <View style={styles.empty}>
      <View style={[styles.illustration, { backgroundColor: isProblem ? theme.dangerBg : theme.surfaceBrand }]}>
        {isProblem ? (
          <Icon icon={kind === 'offline' ? WifiOff : CircleAlert} size="lg" color="dangerInk" />
        ) : (
          <KitomSymbol size={36} />
        )}
      </View>
      <Text variant="title3" style={styles.center} accessibilityRole="header">
        {title}
      </Text>
      {description ? (
        <Text color="inkMuted" style={styles.center}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          // En error, reintentar es la alternativa razonable, no la acción principal de la pantalla.
          variant={isProblem ? 'secondary' : 'primary'}
          label={actionLabel}
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  /** Sin conexión: icono propio; por defecto, error genérico. */
  offline?: boolean;
};

export function ErrorState({ message, onRetry, offline = false }: ErrorStateProps) {
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite">
      <EmptyState
        kind={offline ? 'offline' : 'error'}
        title={message}
        actionLabel={onRetry ? t('common.retry') : undefined}
        onAction={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    gap: spacing['4'],
    paddingVertical: spacing['2'],
  },
  inline: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: spacing['3'],
    paddingVertical: spacing['8'],
    paddingHorizontal: spacing['2'],
  },
  illustration: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['1'],
  },
  center: {
    textAlign: 'center',
  },
  action: {
    marginTop: spacing['2'],
  },
});
