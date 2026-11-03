/**
 * Exportación de los datos del usuario (RGPD art. 15 y 20): un JSON legible con su cuenta y lo de cada
 * mascota a la que tiene acceso. Módulo puro (sin imports en ejecución): se prueba con `npm test`.
 * Las fotos no van dentro (solo su ruta); se pueden pedir por email (`docs/PRIVACY.md`).
 * Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «DataExportScreen».
 */

export const EXPORT_FORMAT = 'kitom-export';
export const EXPORT_FORMAT_VERSION = 1;

type Row = Record<string, unknown>;
type PetRow = Row & { id: string; owner_id: string };
type PetScoped = Row & { pet_id: string };

export type ExportInput = {
  exportedAt: Date;
  appVersion: string | null;
  account: { id: string; email: string | null; createdAt: string | null };
  profile: Row | null;
  notificationPreferences: Row | null;
  subscription: Row | null;
  pets: PetRow[];
  dailyLogs: PetScoped[];
  reminders: PetScoped[];
  aiAnalyses: (PetScoped & { id: string })[];
  aiAnalysisSymptoms: (Row & { analysis_id: string })[];
  achievements: PetScoped[];
  streaks: PetScoped[];
  members: PetScoped[];
};

function byPet<T extends PetScoped>(rows: readonly T[], petId: string): Omit<T, 'pet_id'>[] {
  return rows.filter((row) => row.pet_id === petId).map(({ pet_id: _petId, ...rest }) => rest);
}

/** Documento final. Cada mascota agrupa sus registros, agenda, consultas, logros, racha y miembros. */
export function buildExportDocument(input: ExportInput) {
  const symptomsOf = (analysisId: string) =>
    input.aiAnalysisSymptoms.filter((row) => row.analysis_id === analysisId).map((row) => row.symptom_id);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exported_at: input.exportedAt.toISOString(),
    app_version: input.appVersion,
    account: { id: input.account.id, email: input.account.email, created_at: input.account.createdAt },
    profile: input.profile,
    notification_preferences: input.notificationPreferences,
    subscription: input.subscription,
    pets: input.pets.map((pet) => ({
      role: pet.owner_id === input.account.id ? 'owner' : 'co_owner',
      ...pet,
      daily_logs: byPet(input.dailyLogs, pet.id),
      reminders: byPet(input.reminders, pet.id),
      ai_analyses: byPet(input.aiAnalyses, pet.id).map((analysis) => ({
        ...analysis,
        symptom_ids: symptomsOf(analysis.id as string),
      })),
      achievements: byPet(input.achievements, pet.id),
      streak: byPet(input.streaks, pet.id)[0] ?? null,
      members: byPet(input.members, pet.id),
    })),
  };
}

/** `kitom-datos-2026-10-30.json` (fecha local del dispositivo). */
export function exportFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `kitom-datos-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Pide páginas de `size` filas hasta que una venga incompleta (PostgREST limita cada respuesta). */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < size) return rows;
  }
}
