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
    activeElement: focusable(), getElementById: id => byId[id] ?? null, querySelector: () => null, addEventListener() {}, removeEventListener() {},
  };
  const location = { hash: '', pathname: '/' + page, search: '', assigned: [], assign(url) { this.assigned.push(url); } };
  const window = { location, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800, scrollTo() {} };
  const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, Date, setTimeout, clearTimeout, setInterval, clearInterval() {}, structuredClone, document, window, location, history: { replaceState() {} } });
  return { view, document, byId, location };
}

test('the nav calls the placement page Placement, the spec page is Spec everywhere, and the home page opens doors only to nav pages', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    const nav = header(html).match(/<a href="\.\/evidence\.html"[^>]*>([^<]+)<\/a>/);
    assert.equal(nav?.[1], 'Placement', `${page}: the nav names the placement page by its job`);
    assert.ok(!html.includes('>Docs</a>') && !html.includes('Read the docs'), `${page}: the spec page is called Spec`);
  }
  const index = await read('index.html');
  assert.ok(!index.includes('<a href="./start.html"') && index.includes('>Evaluating</span>') && index.includes('>Checking</span>'), 'the home page opens doors only to pages the nav lists');
});

// The glossary: every term the site uses, defined in the specification's own words, in a panel every page opens, with
// a prerequisite strip under each page's lede whose pills open the panel at a term.
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

test('every page opens the same glossary panel from its nav, and shows a prerequisite strip whose terms the glossary defines', async () => {
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
    assert.ok(html.includes('<sc-for list="{{ prereq }}" as="p"'), `${page} has the prerequisite strip`);
    const { view } = await component(page);
    const ids = view.constructor.name && vm.runInNewContext('PREREQUISITES', { PREREQUISITES: undefined }) === undefined ? null : null; // placeholder to keep vm imported
    const prereq = html.match(/const PREREQUISITES = (\[[^\]]*\]);/);
    assert.ok(prereq, `${page} names its prerequisites`);
    const list = JSON.parse(prereq[1]);
    assert.ok(list.length >= 3 && list.length <= 6, `${page}: ${list.length} prerequisites`);
    for (const id of list) assert.ok(GLOSSARY.some(e => e.id === id), `${page} assumes ${id}, which the glossary defines`);
    assert.deepEqual([...view.renderVals().prereq].map(p => p.term), list.map(id => id.replace(/-/g, ' ')), `${page}: before the glossary loads the strip shows the ids as words`);
  }
  assert.equal(blocks.size, 1, 'the panel markup is identical on every page');
  assert.equal(glue.size, 1, 'the glossary logic is identical on every page');
});

test('the panel opens from the nav or a pill, searches, follows #glossary/<term>, and returns focus when it closes', async () => {
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
  view.renderVals().prereq[0].open();
  assert.equal(view.state.glossaryOpen, true, 'a prerequisite pill opens the panel');
  view.renderVals().closeGlossary();
  location.hash = '#glossary/tier';
  view.glossaryHash();
  assert.deepEqual([view.state.glossaryOpen, view.state.glossaryTerm], [true, 'tier'], 'a deep link opens the panel at its term');
  location.hash = '#assemble';
  view.renderVals().closeGlossary();
  view.glossaryHash();
  assert.equal(view.state.glossaryOpen, false, 'another hash leaves the panel alone');
});

// The home page is layer 1: three slides that hook and orient (tests/three-slides.test.mjs), and the material it used to
// repeat lives on the deeper pages.
test('the home page is layer 1: a plain hero with no preview widget, and none of the material the deeper pages carry', async () => {
  const html = await read('index.html');
  assert.ok(!html.includes('{{ heroBlocks }}') && !html.includes('toggleHero') && !html.includes('startHeroClock'), 'no hero preview widget');
  const lede = html.match(/<h1[^>]*>Context isn't a prompt[^<]*<\/h1>\s*<p[^>]*>([^<]+)<\/p>/)[1];
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
  assert.ok(demo.includes('>Live assembly</div>') && demo.includes(">The slots aren't the point. The assembly is.</h2>") && demo.includes('{{ ucTabs }}') && demo.includes('{{ announce }}'), 'the live assembly simulator sits where the matrix was');
  assert.ok(assembler.indexOf('>Reference implementations</div>') < assembler.indexOf('<section id="assemble"') && assembler.indexOf('<section id="assemble"') < assembler.indexOf('>Tell us what it must do.</h2>'), 'after the implementations, before the closing band');
});
