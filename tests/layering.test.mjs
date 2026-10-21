import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// The site reads in layers: the home page hooks and orients, the deeper pages carry the material, and a reader who
// lands anywhere can pull back a layer. These tests hold the navigation, the home page's shape, and the glossary to
// that (docs/plans/layering.md).

const PAGES = ['index.html', 'spec.html', 'evidence.html', 'assembler.html'];
const read = page => fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
const header = html => html.match(/<header[\s\S]*?<\/header>/)[0];

/** A page component in a DOM stub with what mounting, the tour and the glossary touch. */
async function component(page, { setInterval = () => 0 } = {}) {
  const html = await read(page);
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { props = {}; setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); if (cb) cb(); } }
  const focusable = () => ({ focused: 0, focus() { this.focused += 1; } });
  const byId = { tournext: focusable(), glossarysearch: focusable() };
  const document = {
    documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, setAttribute() {} },
    activeElement: focusable(), getElementById: id => byId[id] ?? null, querySelector: () => null,
    listeners: {}, addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }, removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn); },
  };
  const location = { hash: '', pathname: '/' + page, search: '', assigned: [], assign(url) { this.assigned.push(url); } };
  const media = { listeners: [], matches: false, addEventListener(type, fn) { this.listeners.push(fn); }, removeEventListener(type, fn) { this.listeners = this.listeners.filter(f => f !== fn); } };
  const window = { location, matchMedia: () => media, addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800, scrollTo() {} };
  const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, Date, setTimeout, clearTimeout, setInterval, clearInterval() {}, structuredClone, document, window, location, history: { replaceState() {} } });
  return { view, document, byId, location, media };
}

test('the nav calls the placement page Placement, the spec page is Spec everywhere, and the home page opens doors only to nav pages', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    const nav = header(html).match(/<a href="\.\/evidence\.html"[^>]*>([^<]+)<\/a>/);
    assert.equal(nav?.[1], 'Placement', `${page}: the nav names the placement page by its job`);
    assert.ok(!html.includes('>Docs</a>') && !html.includes('Read the docs'), `${page}: the spec page is called Spec`);
  }
  const index = await read('index.html');
  assert.ok(!index.includes('<a href="./start.html"'), 'the home page opens doors only to pages the nav lists');
});

// The glossary: every term the site uses, defined in the specification's own words, in a panel every page opens; a
// term link where a page first uses a term opens the panel at it.
const GLOSSARY = JSON.parse(await fs.readFile(new URL('../site/glossary.json', import.meta.url), 'utf8'));
const glossaryModule = await import('../site/glossary.js');
const normalize = md => md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/\\([\\*<_])/g, '$1').replace(/`/g, '').replace(/\s+/g, ' ');

test('every glossary entry is complete, relates to terms that exist, names where the site defines it, and quotes the specification exactly', async () => {
  const ids = new Set(GLOSSARY.map(e => e.id));
  assert.equal(ids.size, GLOSSARY.length, 'ids are unique');
  const spec = normalize(await read('SPEC.md'));
  const requirements = JSON.parse(await read('contract/requirements.json')).length;
  const pages = Object.fromEntries(await Promise.all(PAGES.map(async p => [p, await read(p)])));
  for (const e of GLOSSARY) {
    assert.match(e.id, /^[a-z0-9-]+$/, e.id);
    assert.ok(e.term && e.plain && /[.]$/.test(e.plain), `${e.id} has a term and a plain definition`);
    assert.ok(e.plain.split(' ').length <= 60, `${e.id}: the plain definition stays short`);
    for (const r of e.related ?? []) assert.ok(ids.has(r) && r !== e.id, `${e.id} relates to ${r}`);
    if (e.spec) assert.ok(spec.includes(normalize(e.spec)), `${e.id} quotes SPEC.md: ${e.spec}`);
    assert.ok(e.where && pages[e.where.page] && e.where.label, `${e.id} says where the site defines it`);
    if (e.where.anchor) {
      const rendered = e.where.page === 'spec.html' && /^R-\d+$/.test(e.where.anchor) && Number(e.where.anchor.slice(2)) <= requirements;
      assert.ok(rendered || pages[e.where.page].includes(`id="${e.where.anchor}"`), `${e.id}: ${e.where.page}#${e.where.anchor} exists`);
    }
  }
  // The planes and slots the model lists each have a home in the glossary.
  const model = JSON.parse(await read('contract/model.json'));
  const mentions = e => [e.id, e.term, ...(e.aliases ?? []), e.plain].join(' ');
  for (const plane of model.planes) assert.ok(GLOSSARY.some(e => e.id === plane.id || e.id === plane.id + '-plane'), `plane ${plane.id}`);
  for (const slot of model.slots) assert.ok(GLOSSARY.some(e => mentions(e).includes(slot.id)), `slot ${slot.id} is mentioned`);
});

test('the glossary module indexes entries and searches terms, aliases and definitions, terms that start with the query first', () => {
  const g = glossaryModule.index(GLOSSARY);
  assert.equal(g.byId.get('tier').term, 'tier');
  assert.equal(glossaryModule.search(g.entries, '').length, GLOSSARY.length);
  assert.equal(glossaryModule.search(g.entries, 'Tier')[0].id, 'tier', 'by term, case-insensitively');
  assert.equal(glossaryModule.search(g.entries, 'untrusted_content')[0].id, 'injection-risk', 'by alias');
  assert.ok(glossaryModule.search(g.entries, 'never calls a model').some(e => e.id === 'assembler'), 'by definition');
  assert.deepEqual(glossaryModule.search(g.entries, 'conformance').slice(0, 2).map(e => e.id), ['conformance', 'conformance-case'], 'starts-with first');
  assert.deepEqual(glossaryModule.search(g.entries, 'no such term'), []);
  assert.equal(glossaryModule.whereHref(g.byId.get('tier')), './spec.html#s4');
  assert.throws(() => glossaryModule.index([{ id: 'a', related: ['b'] }]), /relates to b/);
});

test('every page opens the same glossary panel from its nav, and links its terms inline instead of listing them first', async () => {
  const blocks = new Set(), glue = new Set();
  for (const page of PAGES) {
    const html = await read(page);
    assert.ok(header(html).includes('<button id="navglossary" onClick="{{ toggleGlossary }}" aria-expanded="{{ glossaryOpen }}" aria-controls="glossary"'), `${page}: the nav opens the glossary`);
    assert.ok(html.includes('#sitenav button {'), `${page}: the narrow nav styles the glossary button`);
    assert.ok(header(html).includes('<nav id="sitenav" data-open="{{ menuOpen }}" style="display: flex; align-items: center;'), `${page}: the nav centres its items`);
    const block = html.match(/<!-- GLOSSARY_START -->[\s\S]*?<!-- GLOSSARY_END -->/);
    assert.ok(block, `${page} has the panel`);
    blocks.add(block[0]);
    assert.ok(block[0].includes('<aside id="glossary" role="dialog" aria-labelledby="glossarytitle"') && !block[0].includes('aria-modal'), `${page}: a non-modal dialog`);
    assert.ok(block[0].includes('<input id="glossarysearch" type="search" value="{{ glossaryQuery }}" onChange="{{ setGlossaryQuery }}"'), `${page}: search`);
    const code = html.match(/\/\/ GLOSSARY_GLUE_START[\s\S]*?\/\/ GLOSSARY_GLUE_END/);
    assert.ok(code, `${page} has the glossary glue`);
    glue.add(code[0]);
    // No page opens with a list of terms to learn first: each links a term where it first uses it (STYLE.md, Term links).
    assert.ok(!html.includes('{{ prereq }}') && !html.includes('This page assumes you know') && !html.includes('const PREREQUISITES'), `${page} has no prerequisite strip`);
    assert.ok(html.includes('<a class="term" href="#glossary/'), `${page} links its terms`);
  }
  assert.equal(blocks.size, 1, 'the panel markup is identical on every page');
  assert.equal(glue.size, 1, 'the glossary logic is identical on every page');
});

test('the panel opens from the nav or a related term, searches, follows #glossary/<term>, and returns focus when it closes', async () => {
  const { view, document, byId, location } = await component('evidence.html');
  view._glossary = glossaryModule;
  view.state.glossary = glossaryModule.index(GLOSSARY);
  byId['glossary-tier'] = { focused: 0, focus() { this.focused += 1; } };
  const trigger = document.activeElement;
  let vals = view.renderVals();
  assert.deepEqual([vals.glossaryOn, vals.glossaryOpen, vals.glossaryCount], [false, 'false', `${GLOSSARY.length} terms`]);
  vals.toggleGlossary();
  vals = view.renderVals();
  assert.deepEqual([vals.glossaryOn, vals.glossaryOpen, byId.glossarysearch.focused], [true, 'true', 1], 'opening focuses the search field');
  assert.equal([...vals.glossaryEntries].length, GLOSSARY.length);
  vals.setGlossaryQuery({ target: { value: 'budget' } });
  vals = view.renderVals();
  assert.equal(vals.glossaryEntries[0].term, 'budget');
  assert.equal(vals.glossaryCount, `${glossaryModule.search(view.state.glossary.entries, 'budget').length} of ${GLOSSARY.length} terms`);
  assert.ok(vals.glossaryEntries[0].spec.startsWith('“') && vals.glossaryEntries[0].whereHref === './spec.html#R-16' && vals.glossaryEntries[0].where === 'Defined on Spec R-16 →');
  vals.setGlossaryQuery({ target: { value: 'zzz' } });
  assert.deepEqual([view.renderVals().glossaryEntries.length, view.renderVals().glossaryEmpty], [0, 'No term matches zzz.']);
  vals.glossaryEntries[0]; // the budget entry's related pills open their terms
  view.renderVals().setGlossaryQuery({ target: { value: 'budget' } });
  view.renderVals().glossaryEntries[0].related.find(r => r.term === 'tier').open();
  vals = view.renderVals();
  assert.deepEqual([view.state.glossaryTerm, vals.glossaryQuery, byId['glossary-tier'].focused], ['tier', '', 1], 'a related pill opens the panel at that term');
  assert.ok(vals.glossaryEntries.find(e => e.id === 'glossary-tier').style.includes('var(--accent)'), 'the opened term is marked');
  vals.glossaryKey({ key: 'Escape', preventDefault() {} });
  assert.deepEqual([view.renderVals().glossaryOn, trigger.focused], [false, 1], 'Escape closes and returns focus');
  location.hash = '#glossary/tier';
  view.glossaryHash();
  assert.deepEqual([view.state.glossaryOpen, view.state.glossaryTerm], [true, 'tier'], 'a deep link opens the panel at its term');
  location.hash = '#assemble';
  view.renderVals().closeGlossary();
  view.glossaryHash();
  assert.equal(view.state.glossaryOpen, false, 'another hash leaves the panel alone');
});

// The home page is layer 1: four slides that show a real app at work and one measured result (tests/home.test.mjs). Its
// request and trace come from the vendored example, not from a generated payload of its own, and the model, the
// simulator and the profiles live on the deeper pages.
test('the home page is layer 1: a plain hero with no preview widget, and none of the material the deeper pages carry', async () => {
  const html = await read('index.html');
  assert.ok(!html.includes('{{ heroBlocks }}') && !html.includes('toggleHero') && !html.includes('startHeroClock'), 'no hero preview widget');
  const lede = html.match(/<h1[^>]*>Decide what your model sees[^<]*<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
  assert.ok(lede.split(' ').length <= 50, `the hero lede stays short: ${lede.split(' ').length} words`);
  for (const word of ['authority', 'lifecycle', 'deterministic', 'payload', 'slot']) assert.ok(!lede.toLowerCase().includes(word), `the hero lede avoids ${word}`);
  for (const gone of ['{{ itemFields }}', 'const ITEM_FIELDS', 'const EVIDENCE_STAGES', '<section id="evidence"', '<section id="payload"', 'CONTRACT_PAYLOAD_START', 'const HERO_BUDGET', 'CONTRACT_MATURITY_START', 'CONTRACT_ITEM_START']) assert.ok(!html.includes(gone), `${gone} has left the home page`);
  const assembler = await read('assembler.html');
  assert.ok(!assembler.includes('>Deterministic assembly</div>') && !assembler.includes('Rule zero (R-5):'), 'the Assembler page restates neither what-it-is card nor rule zero as a footnote');
});

test('the maturity sentence the build computes from the implementations\' reports reads as one', async () => {
  const { maturitySentence } = await import('../scripts/conformance-reports.mjs');
  assert.equal(maturitySentence('2026-01-01', [{ label: 'Python', total: 10, passed: 10 }, { label: 'Go', total: 10, passed: 9 }]),
    'Draft of 2026-01-01. Two assemblers, in Python and Go, pass between 9 and 10 of 10 published cases, rejections included, and the Assembler page shows which; none has a versioned release yet, and we want to hear what they must do.');
});

test('the Assembler page speaks of released assemblers with no hand-written date, and holds the simulator where the matrix was', async () => {
  const assembler = await read('assembler.html');
  assert.ok(assembler.includes('>Reference assemblers</div>') && !assembler.includes('Updated: 20') && assembler.includes('>Four assemblers, released as drafts.</h1>'), 'assemblers, plural, released, and no date to go stale');
  assert.ok(!assembler.includes('No release yet') && assembler.includes('Status: <span style="color: var(--fg);">released</span>'), 'the page no longer calls the assemblers unreleased');
  assert.ok(!assembler.includes('example.py') && !assembler.includes('One call in, payload and trace out.'), 'the example payload section has gone');
  assert.ok(!assembler.includes('Conformance matrix') && !assembler.includes('class="mx'), 'the conformance matrix has gone');
  const demo = assembler.slice(assembler.indexOf('<section id="assemble"'), assembler.indexOf('</section>', assembler.indexOf('<section id="assemble"')));
  assert.ok(demo.includes('>Live assembly</div>') && demo.includes('>Three requests, assembled.</h2>') && demo.includes('{{ ucTabs }}') && demo.includes('{{ announce }}'), 'the live assembly simulator sits where the matrix was');
  assert.ok(assembler.indexOf('>Reference implementations</div>') < assembler.indexOf('<section id="assemble"') && assembler.indexOf('<section id="assemble"') < assembler.indexOf('>Tell us what it must do.</h2>'), 'after the implementations, before the closing band');
});

// Two nav links leave CWA: Examples, the showcase, and Viability, the benchmark site. A plain click on either first
// says what is there, counts down, and goes unless the reader chooses to stay. One notice serves both.
const VIABILITY = 'https://benchmark.contextwindowarchitecture.io';
const EXAMPLES = 'https://examples.contextwindowarchitecture.io';

test('every page asks before Examples or Viability leaves CWA, with the same modal box and logic', async () => {
  const blocks = new Set(), glue = new Set();
  for (const page of PAGES) {
    const html = await read(page);
    assert.ok(header(html).includes(`<a href="${EXAMPLES}" onClick="{{ openExamples }}"`), `${page}: the Examples link opens the notice and still names the site`);
    assert.ok(header(html).includes(`<a href="${VIABILITY}" onClick="{{ openViability }}"`), `${page}: the Viability link opens the notice and still names the site`);
    const block = html.match(/<!-- LEAVING_START -->[\s\S]*?<!-- LEAVING_END -->/);
    assert.ok(block, `${page} has the notice`);
    blocks.add(block[0]);
    assert.ok(block[0].includes('role="dialog" aria-modal="true" aria-labelledby="leavingtitle" aria-describedby="leavingbody"'), `${page}: a named, described modal dialog`);
    assert.ok(block[0].includes('>Stay here</button>') && block[0].includes('<a id="leavinggo" href="{{ leavingUrl }}"'), `${page}: a way to stay and a way to go now`);
    assert.ok(!/VIABILITY_START|viabilityVals/.test(html), `${page}: the Viability-only notice is gone`);
    const code = html.match(/\/\/ LEAVING_GLUE_START[\s\S]*?\/\/ LEAVING_GLUE_END/);
    assert.ok(code, `${page} has the notice glue`);
    glue.add(code[0]);
    assert.ok(/this\.leavingVals\(\)\);/.test(html), `${page}: renders the notice's values`);
    assert.ok(/componentWillUnmount\(\) \{[^}]*this\.leavingStop\(\);/.test(html), `${page}: stops the countdown when it unmounts`);
  }
  assert.equal(blocks.size, 1, 'the notice markup is identical on every page');
  assert.equal(glue.size, 1, 'the notice logic is identical on every page');
});

test('the notice says what each site holds: Viability is data heavy and holds the runs this site cites, Examples is the showcase', async () => {
  const { view } = await component('index.html');
  const click = { button: 0, preventDefault() {} };
  view.renderVals().openViability(click);
  let vals = view.renderVals();
  assert.deepEqual([vals.leavingUrl, vals.leavingGoLabel, vals.leavingCountdown], [VIABILITY, 'Go to Viability now', 'Opening Viability in 20 seconds']);
  assert.ok(/data heavy/.test(vals.leavingLead) && vals.leavingNote === 'It holds the runs behind the numbers this site cites, with their intervals and how to replay them.', 'Viability: data heavy, and where the cited numbers come from');
  view.renderVals().leavingStay();
  view.renderVals().openExamples(click);
  vals = view.renderVals();
  assert.deepEqual([vals.leavingUrl, vals.leavingGoLabel, vals.leavingCountdown], [EXAMPLES, 'Go to Examples now', 'Opening Examples in 20 seconds']);
  assert.ok(/showcase/.test(vals.leavingLead) && /Compare/.test(vals.leavingLead) && /ranks none of them/.test(vals.leavingNote), 'Examples: the showcase, opening on Compare, ranking no model');
  assert.match(vals.leavingKicker, /^Examples · /);
  assert.notEqual(vals.leavingTitle, '');
});

for (const [name, url, open] of [['Viability', VIABILITY, 'openViability'], ['Examples', EXAMPLES, 'openExamples']]) {
  test(`the notice counts down to ${name}, and Stay here, Escape or a click outside keeps the reader`, async () => {
    const ticks = [];
    const { view, document, byId, location } = await component('spec.html', { setInterval: fn => { ticks.push(fn); return ticks.length; } });
    byId.leavingstay = { focused: 0, focus() { this.focused += 1; } };
    const trigger = document.activeElement;
    let vals = view.renderVals();
    assert.equal(vals.leavingOn, false, 'closed until the link is clicked');

    let prevented = 0;
    const click = extra => Object.assign({ button: 0, preventDefault() { prevented += 1; } }, extra);
    vals[open](click({ metaKey: true }));
    vals[open](click({ button: 1 }));
    assert.deepEqual([prevented, view.renderVals().leavingOn, ticks.length], [0, false, 0], 'a modified or middle click opens the link as the browser would');

    vals[open](click());
    vals = view.renderVals();
    assert.deepEqual([prevented, vals.leavingOn, byId.leavingstay.focused], [1, true, 1], 'a plain click opens the notice and focuses Stay here');
    assert.equal(vals.leavingCountdown, `Opening ${name} in 20 seconds`);
    assert.match(vals.leavingBarStyle, /width: 100%/);
    for (let i = 0; i < 19; i++) ticks[0]();
    vals = view.renderVals();
    assert.equal(vals.leavingCountdown, `Opening ${name} in 1 second`);
    assert.deepEqual(location.assigned, [], 'not before the count ends');
    ticks[0]();
    assert.deepEqual([location.assigned, view.renderVals().leavingOn], [[url], false], 'at zero it goes');

    vals = view.renderVals();
    vals[open](click());
    view.renderVals().leavingStay();
    assert.deepEqual([view.renderVals().leavingOn, trigger.focused], [false, 1], 'Stay here closes it and returns focus to the link');
    ticks[1]();
    assert.deepEqual([view.state.leavingLeft, location.assigned.length], [0, 1], 'a stale tick after Stay here neither reopens it nor goes');

    view.renderVals()[open](click());
    view.renderVals().leavingKey({ key: 'Escape', preventDefault() {} });
    assert.equal(view.renderVals().leavingOn, false, 'Escape stays');

    view.renderVals()[open](click());
    const box = {}, backdrop = {};
    view.renderVals().leavingBackdrop({ target: box, currentTarget: backdrop });
    assert.equal(view.renderVals().leavingOn, true, 'a click inside the box does not close it');
    view.renderVals().leavingBackdrop({ target: backdrop, currentTarget: backdrop });
    assert.equal(view.renderVals().leavingOn, false, 'a click outside it stays');

    view.renderVals()[open](click());
    view.renderVals().leavingGo({ preventDefault() {} });
    assert.deepEqual(location.assigned, [url, url], `Go to ${name} now goes at once`);
  });
}

// The header's right end links to GitHub with three line icons in place of the old GitHub button: the organisation,
// the spec repository to star, and a pre-titled issue that a workflow in contextwindowarchitecture/.github answers with an invitation. A phone header has
// no room for them, so below 620px the same three move into the menu panel with their names.
const ORG = 'https://github.com/contextwindowarchitecture';
const GITHUB_LINKS = [
  [ORG, 'GitHub organization', 'GitHub'],
  [ORG + '/contextwindowarchitecture', 'Star the spec on GitHub', 'Star'],
  [ORG + '/.github/issues/new?title=Join%20the%20organization', 'Join the GitHub organization', 'Join'],
];

test('every page links to GitHub from three header icons, which move into the menu on phones', async () => {
  const headers = new Set();
  for (const page of PAGES) {
    const html = await read(page);
    const head = header(html);
    assert.ok(!head.includes('>GitHub</a>'), `${page}: the GitHub button is gone`);
    const icons = head.match(/<div id="hdrgh"[\s\S]*?<\/div>/)?.[0];
    assert.ok(icons, `${page}: the header has the icon group`);
    assert.ok(head.indexOf('{{ themeLabel }}') < head.indexOf('<div id="hdrgh"'), `${page}: the icons follow the theme toggle`);
    const links = [...icons.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener" aria-label="([^"]+)" title="\2"[^>]*><svg [^>]*aria-hidden="true"/g)].map(m => [m[1], m[2]]);
    assert.deepEqual(links, GITHUB_LINKS.map(([href, label]) => [href, label]), `${page}: organisation, star, join, each named for screen readers`);
    const panel = head.match(/<div id="navgh" style="display: none;[\s\S]*?<\/div>/)?.[0];
    assert.ok(panel && head.match(/<nav id="sitenav"[\s\S]*?<\/nav>/)[0].includes(panel), `${page}: the menu panel holds a hidden copy`);
    assert.deepEqual([...panel.matchAll(/<a href="([^"]+)"[^>]*><svg [^>]*aria-hidden="true"[\s\S]*?<\/svg><span>([^<]+)<\/span><\/a>/g)].map(m => [m[1], m[2]]), GITHUB_LINKS.map(([href, , text]) => [href, text]), `${page}: the panel names each link`);
    assert.ok(html.includes('@media (max-width: 620px) { #hdrgh { display: none !important; } #sitenav #navgh { display: flex !important; }'), `${page}: phones swap the icons into the panel`);
    headers.add(icons + panel);
  }
  assert.equal(headers.size, 1, 'the icons are identical on every page');
  assert.match(await read('THIRD_PARTY_NOTICES.md'), /## Feather[\s\S]*Cole Bemis/, 'the Feather licence travels with its icons');
});

// Below 1200px the nav is a panel under the header. It reads as one left-aligned column, fits the screen and scrolls
// inside itself, and closes the way a phone menu does: on choosing anything in it, on a tap outside it, on Escape, and
// when the window widens back to the nav row. The menu logic is one block, identical on every page.
test('the phone menu panel is one left-aligned column that closes the way a phone menu does', async () => {
  const glue = new Set();
  for (const page of PAGES) {
    const html = await read(page);
    assert.ok(html.includes('#sitenav { align-items: stretch !important; max-height: calc(100vh - 68px); max-height: calc(100dvh - 68px); overflow-y: auto; overscroll-behavior: contain; }'), `${page}: the panel stretches its rows and scrolls inside the screen`);
    assert.ok(html.includes('#sitenav #navgh a { padding: 13px 0 !important; border: 0 !important; }'), `${page}: the GitHub row's links are as tall as the others`);
    const code = html.match(/\/\/ MENU_GLUE_START[\s\S]*?\/\/ MENU_GLUE_END/);
    assert.ok(code, `${page} has the menu glue`);
    glue.add(code[0]);
    assert.ok(!/menuLabel: this\.state\.menu/.test(html), `${page}: the labels come from the shared glue`);
    assert.ok(/componentDidMount\(\) \{\s*this\.menuMount\(\);/.test(html) && /componentWillUnmount\(\) \{\s*this\.menuUnmount\(\);/.test(html), `${page}: mounts and unmounts the menu`);

    const { view, document, byId, media } = await component(page);
    view.componentDidMount();
    const vals = () => view.renderVals();
    assert.deepEqual([vals().menuLabel, vals().themeLabel], ['Menu', 'Dark'], `${page}: the header labels read the same on every page`);
    const button = { focused: 0, focus() { this.focused += 1; } };
    byId.hdrmenu = Object.assign(button, { contains: t => t === button });
    byId.sitenav = { contains: t => !!t.inNav };
    const link = { inNav: true, closest: () => ({}) }, gap = { inNav: true, closest: () => null }, outside = { closest: () => null };
    const click = target => { for (const fn of document.listeners.click) fn({ target }); };
    const open = () => { vals().toggleMenu(); click(button); assert.equal(vals().menuOpen, 'true', `${page}: the button opens the panel`); assert.equal(vals().menuLabel, 'Close'); };
    open(); click(gap); assert.equal(vals().menuOpen, 'true', `${page}: a tap on the panel between rows keeps it open`);
    click(link); assert.equal(vals().menuOpen, 'false', `${page}: choosing a link or Glossary closes it`);
    open(); click(outside); assert.equal(vals().menuOpen, 'false', `${page}: a tap outside closes it`);
    open(); for (const fn of document.listeners.keydown) fn({ key: 'Escape' });
    assert.equal(vals().menuOpen, 'false', `${page}: Escape closes it`);
    assert.equal(button.focused, 1, `${page}: and hands focus back to the button`);
    open(); for (const fn of media.listeners) fn({ matches: false });
    assert.equal(vals().menuOpen, 'false', `${page}: widening to the nav row closes it`);
    const hidden = { offsetParent: null, focus() { assert.fail(`${page}: focus went to a hidden menu item`); } };
    document.activeElement = hidden; vals().toggleGlossary(); vals().closeGlossary();
    assert.equal(button.focused, 2, `${page}: closing the glossary opened from the menu focuses the Menu button`);
    document.activeElement = hidden; vals().openExamples({ button: 0, preventDefault() {} }); vals().leavingStay();
    assert.equal(button.focused, 3, `${page}: staying after Examples from the menu focuses the Menu button`);
    view.componentWillUnmount();
    assert.deepEqual([document.listeners.click.length, document.listeners.keydown.length, media.listeners.length], [0, 0, 0], `${page}: unmounting removes the listeners`);
  }
  assert.equal(glue.size, 1, 'the menu logic is identical on every page');
});

test('on every page, a term link names a glossary entry, is styled as a term, and comes at the term\'s first use only', async () => {
  const style = 'color: var(--fg); text-decoration: underline dotted var(--muted); text-decoration-thickness: 1px; text-underline-offset: 3px;';
  for (const page of PAGES) {
    const html = await read(page);
    const links = [...html.matchAll(/<a class="term" href="#glossary\/([a-z0-9-]+)" style="([^"]*)"[^>]*>([^<]+)<\/a>/g)];
    assert.equal(links.length, (html.match(/class="term"/g) || []).length, `${page}: every term link has the recipe's shape`);
    for (const [, id, css, word] of links) assert.ok(GLOSSARY.some(e => e.id === id) && css.startsWith(style), `${page}: ${word}`);
    assert.equal(new Set(links.map(m => m[1])).size, links.length, `${page}: a term is linked once`);
  }
});

test('the Assembler and Placement ledes are short and say what the page holds', async () => {
  for (const [page, says] of [['assembler.html', 'Four open-source'], ['evidence.html', 'CWA fixes what each slot means, not where it goes in the request.']]) {
    const html = await read(page);
    const lede = html.match(/<h1[^>]*>[^<]*<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
    assert.ok(lede.startsWith(says), page);
    assert.ok(lede.split(/\s+/).length <= 60, `${page}: ${lede.split(/\s+/).length} words`);
    for (const sentence of lede.split(/(?<=\.)\s+/)) assert.ok(sentence.split(/\s+/).length <= 25, `${page}: ${sentence}`);
  }
  assert.ok(!(await read('assembler.html')).includes('tracks their status against every requirement'), 'the matrix that claim described is gone');
});
