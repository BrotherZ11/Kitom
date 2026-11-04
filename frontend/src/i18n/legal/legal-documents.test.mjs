import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildLegalDocuments, OUTPUT } from '../../../scripts/build-legal-documents.mjs';
import { LEGAL_DOCUMENTS } from './legal-documents.generated.ts';

const texts = (document) => JSON.stringify(document);

describe('textos legales de la app', () => {
  it('coinciden con las páginas públicas de site/ (si falla: npm run legal:build)', () => {
    assert.equal(readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n'), buildLegalDocuments());
  });

  it('cada documento tiene título, fecha, secciones y párrafos en los dos idiomas', () => {
    for (const locale of ['es', 'en']) {
      for (const id of ['privacy', 'terms']) {
        const document = LEGAL_DOCUMENTS[locale][id];
        assert.ok(document.title.length > 0);
        assert.match(document.effective, /2026/);
        assert.ok(document.blocks.filter((block) => block.type === 'heading').length >= 10, `${locale}/${id}`);
        assert.ok(document.blocks.some((block) => block.type === 'paragraph'));
      }
    }
  });

  it('las tablas de la política conservan todas sus columnas', () => {
    const tables = LEGAL_DOCUMENTS.es.privacy.blocks.filter((block) => block.type === 'table');
    assert.equal(tables.length, 3);
    for (const table of tables) {
      assert.ok(table.rows.length > 0);
      for (const row of table.rows) assert.equal(row.length, table.headers.length);
    }
  });

  it('no arrastra HTML, entidades ni el índice del sitio', () => {
    for (const locale of ['es', 'en']) {
      for (const id of ['privacy', 'terms']) {
        const text = texts(LEGAL_DOCUMENTS[locale][id]);
        assert.doesNotMatch(text, /<\/?[a-z]+[ >]/);
        assert.doesNotMatch(text, /&[a-z]+;/);
        assert.doesNotMatch(text, /CONFIRM/);
      }
    }
  });

  it('los enlaces entre documentos y de contacto son los que la app sabe abrir', () => {
    const hrefs = new Set(texts(LEGAL_DOCUMENTS.es.privacy).match(/"href":"[^"]+"/g));
    assert.ok(hrefs.has('"href":"doc:terms"'));
    assert.ok([...hrefs].some((href) => href.includes('mailto:')));
    for (const href of hrefs) assert.match(href, /"href":"(doc:(privacy|terms)|mailto:|https?:)/);
  });

  it('nunca usa los términos que la marca prohíbe', () => {
    assert.doesNotMatch(texts(LEGAL_DOCUMENTS), /diagn[oó]stic|diagnos(e|is)/i);
  });
});
