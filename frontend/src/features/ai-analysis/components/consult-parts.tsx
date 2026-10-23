import { Linking, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Eye,
  MapPin,
  RefreshCw,
  Stethoscope,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  type LucideIcon,
} from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { UrgencyLevel } from '@/features/ai-analysis/ai-analysis-model';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { t, tf } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

/** Nivel de urgencia: color, icono y texto juntos (nunca solo color; tokens `urgency`). */
export const URGENCY_STYLE: Record<UrgencyLevel, { background: ThemeColor; foreground: ThemeColor; icon: LucideIcon }> = {
  observe: { background: 'observeBg', foreground: 'observeFg', icon: Eye },
  routine_change: { background: 'routineBg', foreground: 'routineFg', icon: RefreshCw },
  consult_soon: { background: 'vetBg', foreground: 'vetFg', icon: Stethoscope },
  urgent: { background: 'urgent', foreground: 'onUrgent', icon: TriangleAlert },
};

/** Etiqueta de urgencia compacta (lista de consultas). */
export function UrgencyTag({ level }: { level: UrgencyLevel }) {
  const theme = useTheme();
  const style = URGENCY_STYLE[level];
  return (
    <View style={[styles.tag, { backgroundColor: theme[style.background] }]}>
      <Icon icon={style.icon} size={14} color={style.foreground} />
      <Text variant="label" color={style.foreground}>
        {t(`consult.result.urgency.${level}`)}
      </Text>
    </View>
  );
}

/** Cabecera del resultado (tableros 7.8–7.11): nivel, titular y mascota. */
export function UrgencyPanel({ level, petName }: { level: UrgencyLevel; petName: string }) {
  const theme = useTheme();
  const style = URGENCY_STYLE[level];
  return (
    <View
      accessible
      accessibilityRole={level === 'urgent' ? 'alert' : undefined}
      style={[styles.panel, { backgroundColor: theme[style.background] }]}>
      <View style={styles.row}>
        <Icon icon={style.icon} size={24} color={style.foreground} />
        <Text variant="overline" color={style.foreground}>
          {t(`consult.result.urgency.${level}`)}
        </Text>
      </View>
      <Text variant="title1" color={style.foreground} accessibilityRole="header">
        {tf(`consult.result.headline.${level}`, { name: petName })}
      </Text>
    </View>
  );
}

/** Aviso obligatorio en cada resultado de orientación (CLAUDE.md, PRD §13). */
export function ConsultDisclaimer() {
  return <Alert tone="info" message={t('consult.result.disclaimer')} />;
}

const EMERGENCY_SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=';

/** Señales de urgencia y acceso a urgencias veterinarias cercanas (sin clínica propia guardada). */
export function EmergencyHint({ prominent = false }: { prominent?: boolean }) {
  const open = () => void Linking.openURL(EMERGENCY_SEARCH_URL + encodeURIComponent(t('consult.emergencySearch')));
  return (
    <View style={styles.emergency}>
      <Alert tone="error" icon={TriangleAlert} message={t('consult.urgentHint')} />
      <Button
        label={t('consult.emergencySearch')}
        icon={MapPin}
        variant={prominent ? 'danger' : 'secondary'}
        size={prominent ? 'lg' : 'md'}
        onPress={open}
      />
    </View>
  );
}

type FeedbackValue = 'useful' | 'not_useful';

/** «¿Te ha sido útil?» (`submit_ai_feedback`, solo quien pidió la consulta). */
export function FeedbackButtons({
  value,
  busy,
  error,
  onChange,
}: {
  value: FeedbackValue | null;
  busy: boolean;
  error: boolean;
  onChange: (value: FeedbackValue) => void;
}) {
  return (
    <View style={styles.feedback}>
      <Text variant="bodyStrong">{t('consult.feedback.question')}</Text>
      <View style={styles.feedbackRow}>
        <View style={styles.flex}>
          <Button
            label={t('consult.feedback.useful')}
            icon={ThumbsUp}
            variant={value === 'useful' ? 'primary' : 'secondary'}
            size="md"
            disabled={busy}
            accessibilityState={{ selected: value === 'useful', disabled: busy }}
            onPress={() => onChange('useful')}
          />
        </View>
        <View style={styles.flex}>
          <Button
            label={t('consult.feedback.notUseful')}
            icon={ThumbsDown}
            variant={value === 'not_useful' ? 'primary' : 'secondary'}
            size="md"
            disabled={busy}
            accessibilityState={{ selected: value === 'not_useful', disabled: busy }}
            onPress={() => onChange('not_useful')}
          />
        </View>
      </View>
      {value ? (
        <Text variant="caption" color="inkMuted">
          {t('consult.feedback.thanks')}
        </Text>
      ) : null}
      {error ? <Alert tone="error" message={t('consult.feedback.error')} /> : null}
    </View>
  );
}

/** Lista con viñetas (posibles causas, qué hacer). */
export function BulletList({ items }: { items: readonly string[] }) {
  const theme = useTheme();
  return (
    <View style={styles.bullets}>
      {items.map((item, index) => (
        <View key={index} style={styles.bullet}>
          <View style={[styles.dot, { backgroundColor: theme.primary }]} />
          <Text style={styles.flex}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: spacing['2'],
    borderRadius: radius.xs,
  },
  panel: {
    borderRadius: radius.lg,
    padding: spacing['5'],
    gap: spacing['3'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  emergency: {
    gap: spacing['3'],
  },
  feedback: {
    gap: spacing['3'],
  },
  feedbackRow: {
    flexDirection: 'row',
    gap: spacing['3'],
  },
  flex: {
    flex: 1,
  },
  bullets: {
    gap: spacing['2'],
  },
  bullet: {
    flexDirection: 'row',
    gap: spacing['3'],
    alignItems: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    marginTop: 8,
  },
});
