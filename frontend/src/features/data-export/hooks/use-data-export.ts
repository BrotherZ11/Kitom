import { useMutation } from '@tanstack/react-query';
import Constants from 'expo-constants';

import { useAuth } from '@/features/auth/auth-context';
import { fetchExportData } from '@/features/data-export/api/export-api';
import { buildExportDocument, exportFileName } from '@/features/data-export/data-export';
import { saveExport } from '@/features/data-export/save-export';
import { t } from '@/i18n';

/** Prepara el JSON con los datos del usuario y lo entrega (compartir en móvil, descarga en web). */
export function useDataExport() {
  const auth = useAuth();
  return useMutation({
    mutationFn: async () => {
      const user = auth.user;
      if (!user) throw new Error('session_unavailable');
      const data = await auth.serverCall(() => fetchExportData(user.id));
      const exportedAt = new Date();
      const document = buildExportDocument({
        ...data,
        exportedAt,
        appVersion: Constants.expoConfig?.version ?? null,
        account: { id: user.id, email: user.email ?? null, createdAt: user.created_at ?? null },
      });
      return saveExport(exportFileName(exportedAt), JSON.stringify(document, null, 2), t('settings.exportScreen.shareTitle'));
    },
  });
}
