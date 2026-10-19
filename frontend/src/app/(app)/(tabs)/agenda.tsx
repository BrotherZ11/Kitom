import { StyleSheet, View } from 'react-native';

import { Calendar } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { useActivePet } from '@/features/pets/active-pet-context';
import { TAB_SCREEN_EDGES } from '@/features/pets/components/active-pet-gate';
import { t, tf } from '@/i18n';
import { size, spacing } from '@/theme/tokens';

/**
 * Agenda (tableros 8.x): recordatorios de vacunas, medicación y citas. Todavía no está implementada
 * (tabla `reminders` y avisos pendientes de frontend): la pestaña existe y lo dice, sin acciones que
 * aparenten funcionar.
 */
export default function AgendaScreen() {
  const { activePet } = useActivePet();

  return (
    <Screen align="top" edges={[...TAB_SCREEN_EDGES]}>
      <View style={styles.top}>
        <Text variant="title1" accessibilityRole="header">
          {t('agenda.title')}
        </Text>
      </View>
      <EmptyState
        icon={Calendar}
        title={t('agenda.soonTitle')}
        description={activePet ? tf('agenda.soonText', { name: activePet.name }) : t('agenda.soonTextNoPet')}
        style={styles.empty}
      />
      <View style={styles.center}>
        <Tag label={t('agenda.soon')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    minHeight: size.touchMin,
    justifyContent: 'center',
  },
  empty: {
    paddingTop: spacing['10'],
    paddingBottom: 0,
  },
  // `Tag` fija su propio `alignSelf`: se centra el contenedor.
  center: {
    alignSelf: 'center',
  },
});
