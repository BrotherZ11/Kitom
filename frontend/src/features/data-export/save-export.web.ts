import type { SaveExportResult } from '@/features/data-export/save-export';

/** Web: descarga el JSON con un enlace temporal (sin pasar por ningún servidor). */
export async function saveExport(fileName: string, json: string, _dialogTitle: string): Promise<SaveExportResult> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    // El navegador ya ha empezado la descarga; liberar la URL un poco después.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return 'saved';
}
