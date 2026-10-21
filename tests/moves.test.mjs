import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Where the site moved things, and where an old link lands: the simulator and harness engineering live on the Assembler
// page, the schema on Spec §2, there is no tour and no Demo page, and the nav lists every page there is. The home page's
// own shape is tests/home.test.mjs.

const PAGES = ['index.html', 'spec.html', 'evidence.html', 'assembler.html'];
const read = page => fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
const header = html => html.match(/<header[\s\S]*?<\/header>/)[0];

/** A page component in a DOM stub with what mounting touches. */
async function component(page, { hash = '' } = {}) {
  const html = await read(page);
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { props = {}; setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); if (cb) cb(); } }
  const focusable = () => ({ focused: 0, focus() { this.focused += 1; } });
  const byId = { glossarysearch: focusable() };
  const document = {
    documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, setAttribute() {} },
    activeElement: focusable(), getElementById: id => byId[id] ?? null, querySelector: () => null, addEventListener() {}, removeEventListener() {},
  };
  const location = { hash, pathname: '/' + page, search: '', assigned: [], replaced: [], assign(url) { this.assigned.push(url); }, replace(url) { this.replaced.push(url); } };
  const window = { location, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800, scrolls: [], scrollTo(o) { this.scrolls.push(typeof o === 'object' ? o.top : o); } };
  const timers = [];
  const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, Date, setTimeout: fn => { timers.push(fn); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, structuredClone, document, window, location, history: { replaceState() {} } });
  return { view, document, byId, location, timers, window };
}

test('harness engineering sits on the Assembler page below the simulator, as the example app\'s handoff to the SDK', async () => {
  const html = await read('assembler.html');
  const at = id => html.indexOf(`<section id="${id}"`);
  assert.ok(at('assemble') > 0 && at('harness') > at('assemble') && html.lastIndexOf('</section>', at('harness')) > at('assemble'), 'harness engineering follows the simulator');
  assert.ok(at('harness') < html.indexOf('>Tell us what it must do.</h2>'), 'and comes before the closing band');
  const harness = html.slice(at('harness'), html.indexOf('</section>', at('harness')));
  assert.ok(harness.includes('>The assembler sits just before your model call.</h2>') && harness.includes('<!-- EXAMPLE_HANDOFF_START -->') && harness.includes('<!-- EXAMPLE_PROVIDERS_START -->'), 'the handoff, from the example');
  assert.equal((harness.match(/>Skip it if</g) || []).length, 3, 'and when not to bother');
  // The framework picker showed one untested seam per framework; it returns only as tested integrations land.
  assert.ok(!html.includes('fwTabs') && !html.includes('frameworks()') && !html.includes('.g6') && !html.includes('Should you use CWA with'), 'no framework picker');
  const { DIR } = await import('../scripts/vendor-examples.mjs');
  const blocks = await import('../scripts/example-blocks.mjs');
  const after = await fs.readFile(new URL(`../${DIR}/${blocks.HANDOFF.file}`, import.meta.url), 'utf8');
  const shown = harness.match(/<!-- EXAMPLE_HANDOFF_START -->[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/)[1];
  const lines = [...shown.matchAll(/<span style="display: block;[^"]*">([\s\S]*?)<\/span>/g)].map(m => m[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.equal(lines.join('\n'), blocks.excerpt(after, blocks.HANDOFF.prefixes));
  assert.ok(lines.some(l => l.includes('if result.payload is None:')) && lines.some(l => l.includes('payload = json.loads(result.payload)')) && lines.some(l => l.includes('providers.ask(')), 'assemble, stop on a refusal, hand over');
  const lock = JSON.parse(await read('examples.lock.json'));
  assert.ok(harness.includes(`href="https://github.com/${lock.repository}/blob/${lock.commit}/01-docs-qa/providers.py"`), 'providers.py at the locked commit');
});

test('there is no tour and no Demo page; old demo anchors on the home page open the page that holds them, and a section anchor scrolls once rendered', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    assert.ok(!/tour/i.test(html.replace(/contour/gi, '')), `${page} has no tour`);
    assert.ok(!html.includes('demo.html'), `${page} does not link the Demo page`);
    for (const off of ['start.html', 'producers.html', 'about.html']) assert.ok(!html.includes(off), `${page} links only pages the nav lists, not ${off}`);
  }
  for (const off of ['demo.html', 'start.html', 'producers.html', 'about.html']) assert.equal(await fs.stat(new URL('../' + off, import.meta.url)).catch(() => null), null, `${off} is not published`);
  for (const [hash, target] of [['#assemble', './assembler.html#assemble'], ['#assemble/clinical-triage/blob', './assembler.html#assemble/clinical-triage/blob'], ['#problem', './assembler.html#assemble'], ['#spec/profiles', './spec.html#s5'], ['#planes', './spec.html#s2'], ['#shapes', './assembler.html#assemble'], ['#harness', './assembler.html#harness']]) {
    const { view, location } = await component('index.html', { hash });
    view.applyHash();
    assert.deepEqual(location.replaced, [target], hash);
  }
  for (const hash of ['#sent', '#assembly']) {
    const { view, location, byId, timers, window } = await component('index.html', { hash });
    byId.sent = { getBoundingClientRect: () => ({ top: 3000 }) };
    view.applyHash();
    for (const fn of timers.splice(0)) fn();
    assert.deepEqual([location.replaced, window.scrolls], [[], [3000 - 68, 3000 - 68]], `${hash}: a section anchor stays on the page and is scrolled to once it has rendered`);
  }
});

test('the Assembler page opens a system from a failure link and scrolls to it, and the nav, glossary and llms.txt follow the moves', async () => {
  const opened = await component('assembler.html', { hash: '#assemble/clinical-triage/blob' });
  opened.view.applyHash();
  assert.deepEqual([opened.view.state.uc, opened.view.state.bad], [1, true], 'a failure link opens its system as the blob');
  // The simulator shows three systems; a link to one it no longer shows opens the first, in the view the link asked for.
  for (const gone of ['voice-ordering', 'code-review-bot', 'incident-copilot', 'language-tutor']) {
    const old = await component('assembler.html', { hash: `#assemble/${gone}/blob` });
    old.view.applyHash();
    assert.deepEqual([old.view.state.uc, old.view.state.bad], [0, true], gone);
  }
  const anchored = await component('assembler.html', { hash: '#assemble' });
  anchored.byId.assemble = { getBoundingClientRect: () => ({ top: 1000 }) };
  anchored.view.applyHash();
  for (const fn of anchored.timers.splice(0)) fn();
  assert.deepEqual(anchored.window.scrolls, [1000 - 68, 1000 - 68], 'the hero link lands on the simulator once the page has rendered');
  for (const page of PAGES) {
    const nav = header(await read(page)).match(/<nav id="sitenav"[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>|<button id="navglossary"[^>]*>([^<]+)<\/button>/g)].map(m => m[2] ?? m[3]), ['Home', 'Spec', 'Assembler', 'Placement', 'Examples', 'Viability', 'Glossary'], page);
    assert.ok(nav.includes('<a href="https://examples.contextwindowarchitecture.io"'), `${page}: Examples opens the examples site`);
    assert.ok(nav.includes('<a href="https://benchmark.contextwindowarchitecture.io"'), `${page}: Viability opens the benchmark site`);
    assert.ok((await read(page)).match(/<footer[\s\S]*?<\/footer>/)?.[0].includes('<a href="./llms.txt">llms.txt</a>'), `${page} has the footer`);
    const head = header(await read(page));
    assert.ok(head.includes('<img id="logo-light" src="./site/logo-light.png" alt="Context Window Architecture" width="108" height="40"') && head.includes('<img id="logo-dark" src="./site/logo-dark.png" alt="Context Window Architecture" width="108" height="40"'), `${page}: the header shows the organisation's logo, one file per theme`);
    assert.ok(!head.includes('var(--p-gov)') && !head.includes('>CWA</span>'), `${page}: the plane-grid mark and wordmark are gone from the header`);
    assert.ok((await read(page)).includes('html[data-theme="dark"] #logo-dark { display: block !important; }'), `${page}: the dark theme swaps the logo`);
    assert.ok((await read(page)).includes('#logo-light, #logo-dark { width: 81px !important; height: 30px !important; }'), `${page}: the logo shrinks on narrow screens so the header fits`);
  }
  const llms = await read('llms.txt');
  const glossary = JSON.parse(await read('site/glossary.json'));
  assert.deepEqual(glossary.find(e => e.id === 'harness').where, { page: 'assembler.html', anchor: 'harness', label: 'harness engineering' });
  assert.match(llms, /^- \[Agent frameworks\]\(https:\/\/contextwindowarchitecture\.io\/assembler\.html#harness\)/m);
  assert.ok(!llms.includes('demo.html'), 'llms.txt no longer lists the Demo page');
  assert.match(llms, /^- \[Landing page\]\(https:\/\/contextwindowarchitecture\.io\/index\.html\): four slides/m);
  assert.match(llms, /^- \[Assembler page\]\(https:\/\/contextwindowarchitecture\.io\/assembler\.html\): .*live assembly simulator.*model-calling loop/m);
  assert.doesNotMatch(llms.match(/^- \[Landing page\].*$/m)[0], /framework/, 'the landing page entry no longer promises the frameworks section');
});
