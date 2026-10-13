import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// The home page is three slides whose one visual is the payload, which fills, breaks and then holds, followed by the
// schema section; the simulator lives on the Assembler page, and there is no tour (docs/plans/three-slides.md).

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

test('the home page is three slides, each a full-height section with one heading, then the schema section, and nothing else of the old page', async () => {
  const html = await read('index.html');
  const slides = [...html.matchAll(/<section id="([a-z]+)" data-slide="(\d)" style="([^"]*)"/g)];
  assert.deepEqual(slides.map(m => [m[1], m[2]]), [['top', '1'], ['shapes', '2'], ['assembly', '3']]);
  for (const m of slides) assert.ok(m[3].includes('min-height: calc(100vh - 68px)') && m[3].includes('scroll-snap-align: start'), `${m[1]} fills the viewport and snaps`);
  assert.ok(html.includes('scroll-snap-type: y proximity'), 'the page snaps between slides');
  assert.match(html, /<h1[^>]*>Context isn't a prompt\. It's an assembled request\.<\/h1>/);
  assert.ok(html.includes('>When nobody owns the payload, the failures have shapes.</h2>') && html.includes('>Name the parts. Fit them to a budget. Write down why.</h2>'));
  for (const gone of ['<section id="problem"', '<section id="why"', '<section id="assemble"', '<section id="deeper"', '<section id="scaffold"', 'const UCS', '>What it is</div>', ">Who it's for</div>"]) {
    assert.ok(!html.includes(gone), `${gone} has left the home page`);
  }
  assert.deepEqual([...html.matchAll(/>0(\d) \/ 03</g)].map(m => m[1]), ['1', '2', '3'], 'each slide counts itself');
  const schema = html.slice(html.indexOf('<section id="planes"'));
  assert.ok(html.indexOf('<section id="planes"') > html.indexOf('<section id="assembly"'), 'the schema section follows the third slide');
  assert.ok(schema.includes('<sc-for list="{{ prereq }}" as="p"') && schema.includes('The words this site uses:') && html.split('The words this site uses:').length === 2, 'the prerequisite strip sits at the top of the schema section');
  assert.ok(schema.includes('<button onClick="{{ setPlanesMode }}" aria-pressed="{{ planesPressed }}"') && schema.includes('<sc-for list="{{ layers }}" as="layer"'), 'the planes and slots explorer');
  const harness = html.slice(html.indexOf('<section id="harness"'));
  assert.ok(html.indexOf('<section id="harness"') > html.indexOf('<section id="planes"'), 'harness engineering follows the schema section');
  assert.ok(harness.includes('>Already using a framework? The assembler goes inside it.</h2>') && harness.includes('<button onClick="{{ t.on }}" aria-pressed="{{ t.pressed }}"') && harness.includes('{{ fwVerdict }}'), 'the framework picker');
  const { view } = await component('index.html');
  assert.deepEqual([...view.renderVals().fwTabs].map(t => t.pressed), ['true', 'false', 'false', 'false', 'false']);
  view.renderVals().fwTabs[2].on();
  assert.equal(view.renderVals().fwName, 'the Claude Agent SDK');
});

test('the first slide offers the simulator and the spec, the second links each failure shape to the system that reproduces it, and the third opens three doors', async () => {
  const html = await read('index.html');
  const first = html.slice(html.indexOf('<section id="top"'), html.indexOf('<section id="shapes"'));
  assert.deepEqual([...first.matchAll(/<a href="([^"]+)" style="font-size: 16px;[^>]*>(Watch it assemble|Read the spec)<\/a>/g)].map(m => [m[2], m[1]]),
    [['Watch it assemble', './assembler.html#assemble'], ['Read the spec', './spec.html']]);
  const second = html.slice(html.indexOf('<section id="shapes"'), html.indexOf('<section id="assembly"'));
  assert.deepEqual([...second.matchAll(/<a href="\.\/assembler\.html#assemble\/([a-z-]+)\/blob"/g)].map(m => m[1]), ['clinical-triage', 'weekly-brief', 'support-agent'], 'three shapes, each reproducible');
  assert.ok(second.includes('href="./assembler.html#assemble"'), 'and the way to all seven');
  const third = html.slice(html.indexOf('<section id="assembly"'), html.indexOf('<section id="planes"'));
  const doors = third.match(/<div class="g2c" style="display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^"]*">([\s\S]*?)\n      <\/div>/)[1];
  assert.deepEqual([...doors.matchAll(/<a href="\.\/([a-z]+\.html)"/g)].map(m => m[1]), ['assembler.html', 'spec.html'], 'evaluating, checking: only pages the nav lists');
  assert.ok(third.includes('href="./spec.html#s2"') && third.includes('href="#planes"'), 'the planes and slots are read on Spec §2 and on the schema section below');
});

test('there is no tour and no Demo page; old demo anchors on the home page open the page that holds them, and a section anchor scrolls once rendered', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    assert.ok(!/tour/i.test(html.replace(/contour/gi, '')), `${page} has no tour`);
    assert.ok(!html.includes('demo.html'), `${page} does not link the Demo page`);
    for (const off of ['start.html', 'producers.html', 'about.html']) assert.ok(!html.includes(off), `${page} links only pages the nav lists, not ${off}`);
  }
  for (const off of ['demo.html', 'start.html', 'producers.html', 'about.html']) assert.equal(await fs.stat(new URL('../' + off, import.meta.url)).catch(() => null), null, `${off} is not published`);
  for (const [hash, target] of [['#assemble', './assembler.html#assemble'], ['#assemble/clinical-triage/blob', './assembler.html#assemble/clinical-triage/blob'], ['#problem', './assembler.html#assemble'], ['#spec/profiles', './spec.html#s5']]) {
    const { view, location } = await component('index.html', { hash });
    view.applyHash();
    assert.deepEqual(location.replaced, [target], hash);
  }
  const { view, location, byId, timers, window } = await component('index.html', { hash: '#planes' });
  byId.planes = { getBoundingClientRect: () => ({ top: 3000 }) };
  view.applyHash();
  for (const fn of timers.splice(0)) fn();
  assert.deepEqual([location.replaced, window.scrolls], [[], [3000 - 68, 3000 - 68]], 'a section anchor stays on the page and is scrolled to once it has rendered');
});

test('the Assembler page opens a system from a failure link and scrolls to it, and the nav, glossary and llms.txt follow the moves', async () => {
  const opened = await component('assembler.html', { hash: '#assemble/clinical-triage/blob' });
  opened.view.applyHash();
  assert.deepEqual([opened.view.state.uc, opened.view.state.bad], [2, true], 'a failure link opens its system as the blob');
  const anchored = await component('assembler.html', { hash: '#assemble' });
  anchored.byId.assemble = { getBoundingClientRect: () => ({ top: 1000 }) };
  anchored.view.applyHash();
  for (const fn of anchored.timers.splice(0)) fn();
  assert.deepEqual(anchored.window.scrolls, [1000 - 68, 1000 - 68], 'the hero link lands on the simulator once the page has rendered');
  for (const page of PAGES) {
    const nav = header(await read(page)).match(/<nav id="sitenav"[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>|<button id="navglossary"[^>]*>([^<]+)<\/button>/g)].map(m => m[2] ?? m[3]), ['Home', 'Spec', 'Assembler', 'Placement', 'Viability', 'Glossary'], page);
    assert.ok(nav.includes('<a href="https://benchmark.contextwindowarchitecture.io"'), `${page}: Viability opens the benchmark site`);
    assert.ok((await read(page)).match(/<footer[\s\S]*?<\/footer>/)?.[0].includes('<a href="./llms.txt">llms.txt</a>'), `${page} has the footer`);
  }
  const llms = await read('llms.txt');
  const glossary = JSON.parse(await read('site/glossary.json'));
  assert.deepEqual(glossary.find(e => e.id === 'harness').where, { page: 'index.html', anchor: 'harness', label: 'harness engineering' });
  assert.match(llms, /^- \[Agent frameworks\]\(https:\/\/contextwindowarchitecture\.io\/index\.html#harness\)/m);
  assert.ok(!llms.includes('demo.html'), 'llms.txt no longer lists the Demo page');
  assert.match(llms, /^- \[Landing page\]\(https:\/\/contextwindowarchitecture\.io\/index\.html\): three slides/m);
  assert.match(llms, /^- \[Assembler page\]\(https:\/\/contextwindowarchitecture\.io\/assembler\.html\): .*live assembly simulator/m);
});
