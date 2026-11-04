import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { emailLinkRedirectUrl, readUrlParams, toFlow } from './auth-callback-plan.ts';

const repo = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), 'utf8');
const LEGAL_LINKS = read('frontend/src/lib/legal-links.ts');

describe('enlaces de los emails', () => {
  it('apuntan a la página puente y conservan el flujo', () => {
    const url = emailLinkRedirectUrl('https://kitom.example/auth/callback.html', 'recovery');
    assert.equal(url, 'https://kitom.example/auth/callback.html?flow=recovery');
    assert.equal(toFlow(readUrlParams(`${url}&code=abc`).flow), 'recovery');
  });

  it('la constante de la app es la página que existe en site/', () => {
    assert.match(LEGAL_LINKS, /EMAIL_LINK_BRIDGE_URL = `\$\{LEGAL_SITE_URL\}\/auth\/callback\.html`/);
    assert.ok(read('site/auth/callback.html').includes('kitom://auth-callback'));
  });

  it('la página puente abre la app que se publica y solo esa', () => {
    const page = read('site/auth/callback.html');
    const config = JSON.parse(read('frontend/app.json')).expo;
    assert.ok(page.includes(`scheme=${config.scheme};package=${config.android.package};`));
    assert.doesNotMatch(page, /location\.(href|assign|replace)\s*(=|\()\s*(read|query|hash)/);
  });
});

describe('plantillas de email', () => {
  const links = ['confirmation', 'recovery', 'email_change'];

  it('usan el enlace que respeta el redirect de la app', () => {
    for (const name of links) {
      const html = read(`supabase/templates/${name}.html`);
      assert.ok(html.includes('{{ .ConfirmationURL }}'), name);
      assert.doesNotMatch(html, /\.SiteURL|\.TokenHash/, name);
    }
  });

  it('la reautenticación lleva el código', () => {
    assert.ok(read('supabase/templates/reauthentication.html').includes('{{ .Token }}'));
  });

  it('están enlazadas en config.toml y hablan de Kitom', () => {
    const config = read('supabase/config.toml');
    for (const name of [...links, 'reauthentication']) {
      assert.ok(config.includes(`content_path = "./supabase/templates/${name}.html"`), name);
      assert.ok(read(`supabase/templates/${name}.html`).includes('Kitom'), name);
    }
  });
});
