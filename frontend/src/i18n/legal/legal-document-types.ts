/** Estructura de la política de privacidad y los términos dentro de la app (generados desde `site/`). */

export type LegalDocumentId = 'privacy' | 'terms';

/** `doc:privacy` y `doc:terms` abren el otro documento en la app; el resto, `mailto:` o una web. */
export type LegalRun = { text: string; bold?: boolean; href?: string };

export type LegalBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; runs: LegalRun[] }
  | { type: 'list'; items: LegalRun[][] }
  | { type: 'table'; headers: string[]; rows: LegalRun[][][] };

export type LegalDocument = { title: string; effective: string; blocks: LegalBlock[] };

export type LegalDocuments = Record<'es' | 'en', Record<LegalDocumentId, LegalDocument>>;

export function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return value === 'privacy' || value === 'terms';
}
