// Genera `src/i18n/legal/legal-documents.generated.ts` a partir de las páginas públicas (`site/`): la política de
// privacidad y los términos se leen dentro de la app sin escribirlos dos veces. Las tiendas siguen necesitando
// la URL pública, así que el original son esas páginas: se cambian allí y se ejecuta `npm run legal:build`.
// `legal-documents.test.mjs` falla si el archivo generado no coincide con `site/`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../site');
export const OUTPUT = resolve(HERE, '../src/i18n/legal/legal-documents.generated.ts');

const SOURCES = {
  es: { privacy: 'privacy.html', terms: 'terms.html' },
  en: { privacy: 'en/privacy.html', terms: 'en/terms.html' },
};

const decode = (text) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');

/** Enlaces del original a lo que la app sabe abrir; los anclas internos y la navegación del sitio, sin enlace. */
function toAppHref(href) {
  if (/^(mailto:|https?:)/.test(href)) return href;
  if (href.endsWith('privacy.html')) return 'doc:privacy';
  if (href.endsWith('terms.html')) return 'doc:terms';
  return undefined;
}

/** Texto de un bloque, en tramos con negrita y enlace, con los espacios del HTML normalizados. */
function parseRuns(html) {
  const runs = [];
  let bold = false;
  let href;
  const push = (raw) => {
    const text = decode(raw).replace(/\s+/g, ' ');
    if (text === '') return;
    const run = { text };
    if (bold) run.bold = true;
    if (href) run.href = href;
    const last = runs.at(-1);
    if (last && last.bold === run.bold && last.href === run.href) last.text += text;
    else runs.push(run);
  };
  const tag = /<(\/?)(strong|a|em|code|span|br)\b([^>]*)>/g;
  let cursor = 0;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    push(html.slice(cursor, match.index));
    cursor = tag.lastIndex;
    const [, closing, name, attrs] = match;
    if (name === 'strong') bold = !closing;
    if (name === 'a') href = closing ? undefined : toAppHref(/href="([^"]*)"/.exec(attrs)?.[1] ?? '');
  }
  push(html.slice(cursor));
  if (runs.length > 0) {
    runs[0].text = runs[0].text.trimStart();
    runs.at(-1).text = runs.at(-1).text.trimEnd();
  }
  return runs.filter((run) => run.text !== '');
}

const plain = (html) => parseRuns(html).map((run) => run.text).join('');

function parseDocument(html) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1];
  if (!main) throw new Error('página sin <main>');
  const body = main.replace(/<!--[\s\S]*?-->/g, '').replace(/<nav\b[\s\S]*?<\/nav>/g, '');

  let title = '';
  let effective = '';
  const blocks = [];
  const block = /<(h1|h2|p|ul|ol|table)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (let match = block.exec(body); match; match = block.exec(body)) {
    const [, name, attrs, inner] = match;
    if (name === 'h1') title = plain(inner);
    else if (name === 'h2') blocks.push({ type: 'heading', text: plain(inner) });
    else if (name === 'p' && attrs.includes('class="meta"')) effective = plain(inner);
    else if (name === 'p') blocks.push({ type: 'paragraph', runs: parseRuns(inner) });
    else if (name === 'table') {
      const cells = (row, cell) => [...row.matchAll(new RegExp(`<${cell}\\b[^>]*>([\\s\\S]*?)</${cell}>`, 'g'))].map((m) => m[1]);
      const headers = cells(/<thead\b[\s\S]*?<\/thead>/.exec(inner)?.[0] ?? '', 'th').map(plain);
      const rows = [...(/<tbody\b[\s\S]*?<\/tbody>/.exec(inner)?.[0] ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
        cells(row[1], 'td').map(parseRuns)
      );
      blocks.push({ type: 'table', headers, rows });
    } else {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((item) => parseRuns(item[1]));
      blocks.push({ type: 'list', items });
    }
  }
  if (!title || !effective || blocks.length === 0) throw new Error('página legal incompleta');
  return { title, effective, blocks };
}

/** Contenido del archivo generado, siempre con saltos LF. */
export function buildLegalDocuments() {
  const documents = {};
  for (const [locale, pages] of Object.entries(SOURCES)) {
    documents[locale] = {};
    for (const [key, path] of Object.entries(pages)) {
      documents[locale][key] = parseDocument(readFileSync(resolve(SITE, path), 'utf8').replace(/\r\n/g, '\n'));
    }
  }
  return `// GENERADO por scripts/build-legal-documents.mjs a partir de site/. No editar: npm run legal:build.
import type { LegalDocuments } from './legal-document-types';

export const LEGAL_DOCUMENTS: LegalDocuments = ${JSON.stringify(documents, null, 2)};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, buildLegalDocuments());
  console.log('Textos legales generados.');
}
