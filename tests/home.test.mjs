import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The home page shows a real app at work: the 01-docs-qa bot's code before and after CWA, the request its model
// receives, the trace of what was left out, and one measured result (docs/plans/reader-feedback/home-page.md).

const read = name => fs.readFile(new URL('../' + name, import.meta.url), 'utf8');
const GLOSSARY = new Set(JSON.parse(await read('site/glossary.json')).map(e => e.id));
const TERM_STYLE = 'color: var(--fg); text-decoration: underline dotted var(--muted); text-decoration-thickness: 1px; text-underline-offset: 3px;';

test('a term\'s first use is a term link that opens the glossary at it, once per page and one new term per slide', async () => {
  const html = await read('index.html');
  const links = [...html.matchAll(/<a class="term" href="#glossary\/([a-z0-9-]+)" style="([^"]*)"[^>]*>([^<]+)<\/a>/g)];
  assert.equal(links.length, (html.match(/class="term"/g) || []).length, 'every term link has the recipe\'s shape');
  for (const [, id, style, word] of links) {
    assert.ok(GLOSSARY.has(id), `${word} links a glossary entry`);
    assert.ok(style.startsWith(TERM_STYLE), `${word} is styled as a term`);
  }
  const ids = links.map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'a term is linked at its first use only');
  for (const [, id, body] of html.matchAll(/<section id="([a-z]+)" data-slide="\d"[^>]*>([\s\S]*?)<\/section>/g)) {
    assert.ok((body.match(/class="term"/g) || []).length <= 1, `${id} brings in one new term at most`);
  }
});
