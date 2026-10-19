import { useRouter } from 'expo-router';

import { Alert } from '@/components/ui/alert';
import { CloudUpload } from '@/components/ui/icons';
import { useUnsyncedDailyLogs } from '@/features/daily-logs/hooks/use-daily-log';
import { t, tf } from '@/i18n';

/**
 * Aviso de Hoy con los registros que tienen cambios solo en este dispositivo (también de mascotas que
 * ya no se ven), con acceso a «Registros sin sincronizar». Lee solo el almacén local del usuario.
 * Sin pendientes no ocupa sitio; si no se puede leer el almacén, lo dice (no afirma que no hay nada).
 */
export function UnsyncedDailyLogsEntry() {
  const router = useRouter();
  const { view } = useUnsyncedDailyLogs();
  const open = { label: t('dailyLogs.unsynced.bannerAction'), onPress: () => router.push('/daily-logs/unsynced') };

  if (view.state === 'error') {
    return <Alert tone="warning" title={t('dailyLogs.unsynced.title')} message={t('dailyLogs.errors.local_read_failed')} action={open} />;
  }
  if (view.state !== 'ready' || view.items.length === 0) return null;

  const count = view.items.length;
  return (
    <Alert
      tone="warning"
      icon={CloudUpload}
      message={count === 1 ? t('dailyLogs.unsynced.bannerOne') : tf('dailyLogs.unsynced.banner', { count })}
      action={open}
    />
  );
}
