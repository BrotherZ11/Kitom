import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type SaveExportResult = 'shared' | 'saved';

/**
 * Móvil: escribe el JSON en la caché de la app y abre el menú de compartir del sistema (guardar en
 * archivos, enviar por email…). Si el sistema no puede compartir, el archivo queda en la caché
 * (`saved`). Web: `save-export.web.ts`.
 */
export async function saveExport(fileName: string, json: string, dialogTitle: string): Promise<SaveExportResult> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(json);
  if (!(await Sharing.isAvailableAsync())) return 'saved';
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
  return 'shared';
}
