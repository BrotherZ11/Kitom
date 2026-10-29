import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { useDataExport } from '@/features/data-export/hooks/use-data-export';
import { t, tf } from '@/i18n';
import { SUPPORT_EMAIL } from '@/lib/legal-links';
import { isNetworkError } from '@/lib/server-errors';
import { spacing } from '@/theme/tokens';

/**
 * Descargar mis datos (RGPD art. 15 y 20): un archivo JSON con la cuenta, el perfil y todo lo de cada
 * mascota a la que tiene acceso (registros, agenda, consultas, logros, racha y miembros). Las fotos
 * no van dentro (solo su ruta). Necesita conexión. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4
 * «DataExportScreen».
 */
export default function DataExportScreen() {
  const router = useRouter();
  const { canUseServer } = useAuth();
  const exportData = useDataExport();
  const included = [
    t('settings.exportScreen.includesAccount'),
    t('settings.exportScreen.includesPets'),
    t('settings.exportScreen.includesLogs'),
    t('settings.exportScreen.includesReminders'),
    t('settings.exportScreen.includesConsults'),
    t('settings.exportScreen.includesSharing'),
  ];

  return (
    <Screen
      align="top"
      footer={
        <Button
          label={t('settings.exportScreen.action')}
          icon={Download}
          loading={exportData.isPending}
          loadingLabel={t('settings.exportScreen.preparing')}
          disabled={!canUseServer}
          onPress={() => exportData.mutate()}
        />
      }>
      <TopBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
        title={t('settings.exportScreen.title')}
      />
      <Text color="inkMuted">{t('settings.exportScreen.intro')}</Text>
      <Card>
        <View style={styles.list}>
          {included.map((item) => (
            <Text key={item}>{`•  ${item}`}</Text>
          ))}
        </View>
      </Card>
      <Text variant="caption" color="inkMuted">
        {tf('settings.exportScreen.photos', { email: SUPPORT_EMAIL })}
      </Text>
      {!canUseServer ? <Alert tone="warning" message={t('settings.exportScreen.offline')} /> : null}
      {exportData.isSuccess ? (
        <Alert
          tone="success"
          message={exportData.data === 'shared' ? t('settings.exportScreen.shared') : t('settings.exportScreen.saved')}
        />
      ) : null}
      {exportData.isError ? (
        <Alert
          tone="error"
          message={
            isNetworkError(exportData.error) ? t('settings.exportScreen.offline') : t('settings.exportScreen.error')
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing['2'],
  },
});
