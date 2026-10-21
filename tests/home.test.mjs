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

const blocks = await import('../scripts/example-blocks.mjs');
const { DIR, LOCK } = await import('../scripts/vendor-examples.mjs');
const vendored = name => read(`${DIR}/${name}`);
/** A generated block's text as a reader sees it: its <pre> with the markup stripped and the entities decoded. */
const shown = (html, name) => {
  const block = html.match(new RegExp(`<!-- ${name}_START -->([\\s\\S]*?)<!-- ${name}_END -->`))?.[1];
  assert.ok(block, `index.html has the ${name} block`);
  const pre = block.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? block;
  return pre.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
};

test('an excerpt is the named top-level statements in source order, each whole, and a missing one is an error', () => {
  const source = 'import x\n\nA = 1\nB = (\n    2,\n)\n\n\ndef f(a):\n    """Doc."""\n\n    return a\n\n\n# a comment\ndef g():\n    pass\n';
  assert.equal(blocks.excerpt(source, ['def f(', 'A =']), 'A = 1\n\ndef f(a):\n    """Doc."""\n\n    return a');
  assert.equal(blocks.excerpt(source, ['B =', 'import']), 'import x\n\nB = (\n    2,\n)', 'a closing bracket at the margin belongs to its statement');
  assert.equal(blocks.excerpt(source, ['import', 'A =']), 'import x\nA = 1', 'single lines stay together');
  assert.throws(() => blocks.excerpt(source, ['def h(']), /No top-level statement starts with "def h\("/);
  assert.throws(() => blocks.panel({ label: 'x', meta: '', aria: 'x', text: 'a {{ b }}' }), /template binding/);
});

test('the code slide shows build_request() from before.py and its CWA counterpart from context.py, as vendored', async () => {
  const html = await read('index.html');
  const lock = JSON.parse(await read(LOCK));
  const before = shown(html, 'EXAMPLE_BEFORE'), after = shown(html, 'EXAMPLE_AFTER');
  assert.equal(before, blocks.excerpt(await vendored(blocks.BEFORE.file), blocks.BEFORE.prefixes));
  assert.equal(after, blocks.excerpt(await vendored(blocks.AFTER.file), blocks.AFTER.prefixes));
  assert.ok(before.startsWith('TOP_K = 5\nMAX_HISTORY_MESSAGES = 6\n\ndef build_request('), 'the five articles and six messages the caption names');
  assert.ok(after.includes('def snapshot(') && after.includes('def assemble(') && after.includes('cwa_assemble(Snapshot.from_json(document))'));
  const code = html.slice(html.indexOf('<section id="code"'), html.indexOf('</section>', html.indexOf('<section id="code"')));
  assert.ok(code.includes(`<a href="https://github.com/contextwindowarchitecture/examples/tree/${lock.commit}/01-docs-qa" target="_blank" rel="noopener"`) && code.includes(`at ${lock.commit.slice(0, 7)} →</a>`), 'the whole app, at the locked commit');
  assert.ok(code.includes('>Paste the top five articles into the system prompt, keep the last six messages, send.</p>'));
  assert.equal([...code.matchAll(/<pre tabindex="0" aria-label="[^"]+"/g)].length, 2, 'both panels scroll from the keyboard and are named');
});

test('a term link opens the glossary scrolled to its entry, on every page, and leaves the page where it was', async () => {
  const vm = await import('node:vm');
  for (const page of ['index.html', 'spec.html', 'evidence.html', 'assembler.html']) {
    const source = (await read(page)).match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
    class DCLogic { props = {}; setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); if (cb) cb(); } }
    const list = { offsetTop: 120, scrollTop: 0 };
    const entry = { offsetTop: 1500, parentElement: list, focused: null, focus(options) { this.focused = options; } };
    const document = { activeElement: null, documentElement: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {} }, getElementById: id => id === 'glossary-trace' ? entry : null, addEventListener() {}, removeEventListener() {} };
    const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, document, window: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) }, location: { hash: '' }, history: { replaceState() {} }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} });
    view.openGlossary('trace');
    assert.deepEqual([view.state.glossaryOpen, view.state.glossaryTerm, list.scrollTop, entry.focused?.preventScroll], [true, 'trace', 1380, true], page);
  }
});
