import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Option A, "The window": the home page is three slides whose one visual is the payload, which fills, breaks and then
// holds; the demo, the failure cards and harness engineering live on a Demo page of their own
// (docs/plans/three-slides.md).

const PAGES = ['index.html', 'demo.html', 'start.html', 'spec.html', 'producers.html', 'evidence.html', 'assembler.html', 'about.html'];
const read = page => fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
const header = html => html.match(/<header[\s\S]*?<\/header>/)[0];

/** A page component in a DOM stub with what mounting and the tour touch. */
async function component(page, { hash = '' } = {}) {
  const html = await read(page);
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { props = {}; setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); if (cb) cb(); } }
  const focusable = () => ({ focused: 0, focus() { this.focused += 1; } });
  const byId = { tournext: focusable(), glossarysearch: focusable() };
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

test('the home page is three slides, each a full-height section with one heading, and nothing else of the old page', async () => {
  const html = await read('index.html');
  const slides = [...html.matchAll(/<section id="([a-z]+)" data-slide="(\d)" data-tour="([a-z]+)" style="([^"]*)"/g)];
  assert.deepEqual(slides.map(m => [m[1], m[2], m[3]]), [['top', '1', 'request'], ['shapes', '2', 'shapes'], ['assembly', '3', 'assembly']]);
  for (const m of slides) assert.ok(m[4].includes('min-height: calc(100vh - 68px)') && m[4].includes('scroll-snap-align: start'), `${m[1]} fills the viewport and snaps`);
  assert.ok(html.includes('scroll-snap-type: y proximity'), 'the page snaps between slides');
  assert.match(html, /<h1[^>]*>Context isn't a prompt\. It's an assembled request\.<\/h1>/);
  assert.ok(html.includes('>When nobody owns the payload, the failures have shapes.</h2>') && html.includes('>Name the parts. Fit them to a budget. Write down why.</h2>'));
  for (const gone of ['<section id="problem"', '<section id="why"', '<section id="assemble"', '<section id="deeper"', '<section id="harness"', '<section id="scaffold"', 'const UCS', 'frameworks()', '>What it is</div>', ">Who it's for</div>"]) {
    assert.ok(!html.includes(gone), `${gone} has left the home page`);
  }
  const counters = [...html.matchAll(/>0(\d) \/ 03</g)].map(m => m[1]);
  assert.deepEqual(counters, ['1', '2', '3'], 'each slide counts itself');
});

test('the first slide offers the tour and the demo, the second links each failure shape to the system that reproduces it, and the third opens three doors', async () => {
  const html = await read('index.html');
  const first = html.slice(html.indexOf('<section id="top"'), html.indexOf('<section id="shapes"'));
  assert.deepEqual([...first.matchAll(/<(button|a) ([^>]*)>(Take the tour|Watch it assemble)<\/(?:button|a)>/g)].map(m => [m[1], m[3], m[2].includes('onClick="{{ startTour }}') ? 'tour' : m[2].match(/href="([^"]+)"/)[1]]),
    [['button', 'Take the tour', 'tour'], ['a', 'Watch it assemble', './demo.html#assemble']]);
  const second = html.slice(html.indexOf('<section id="shapes"'), html.indexOf('<section id="assembly"'));
  assert.deepEqual([...second.matchAll(/<a href="\.\/demo\.html#assemble\/([a-z-]+)\/blob"/g)].map(m => m[1]), ['clinical-triage', 'weekly-brief', 'support-agent'], 'three shapes, each reproducible');
  assert.ok(second.includes('href="./demo.html#problem"'), 'and the way to all seven');
  const third = html.slice(html.indexOf('<section id="assembly"'));
  const doors = third.match(/<div class="g3" style="display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^"]*">([\s\S]*?)\n      <\/div>/)[1];
  assert.deepEqual([...doors.matchAll(/<a href="\.\/([a-z]+\.html)"/g)].map(m => m[1]), ['demo.html', 'start.html', 'spec.html'], 'evaluating, building, checking');
  assert.ok(third.includes('<sc-for list="{{ prereq }}" as="p"') && third.includes('The words this site uses:'), 'the prerequisite strip sits on the last slide');
  assert.ok(third.includes('href="./spec.html#s2"'), 'the planes and slots are read on Spec §2');
});

test('the home tour is one step per slide and hands on to the demo\'s tour; old demo anchors on the home page open the Demo page', async () => {
  const { view, location } = await component('index.html');
  assert.deepEqual([...view.tourSteps().map(s => s.key)], ['request', 'shapes', 'assembly']);
  const html = await read('index.html');
  for (const step of view.tourSteps()) assert.ok(html.includes(`data-tour="${step.key}"`), `${step.key} has a target`);
  view.state.tour = 2;
  const vals = view.renderVals();
  assert.equal(vals.tourNextLabel, 'Watch it assemble');
  vals.tourNext();
  assert.deepEqual(location.assigned, ['./demo.html#tour']);
  assert.equal(view.renderVals().tourOn, false);
  for (const hash of ['#assemble', '#assemble/clinical-triage/blob', '#problem', '#harness', '#spec/profiles']) {
    const { view: v, location: l } = await component('index.html', { hash });
    v.applyHash();
    assert.deepEqual(l.replaced, [hash.startsWith('#spec') ? './spec.html#s5' : './demo.html' + hash], hash);
  }
  const { view: v, location: l } = await component('index.html', { hash: '#shapes' });
  v.applyHash();
  assert.deepEqual(l.replaced, [], 'a slide anchor stays on the page');
});

test('the Demo page holds the failure cards, the simulator and harness engineering, runs the tour from there, and starts it from #tour', async () => {
  const html = await read('demo.html');
  for (const id of ['problem', 'assemble', 'harness']) assert.ok(html.includes(`<section id="${id}"`), `${id} is on the Demo page`);
  assert.ok(!html.includes('data-props=') && !html.includes('ACCENT_DEFAULT'), 'the Demo page is not a canvas export with an accent prop');
  assert.match(html, /<title>Demo — Context Window Architecture<\/title>/);
  assert.ok(html.includes('<sc-for list="{{ prereq }}" as="p"') && html.includes('This page assumes you know:'), 'the strip');
  assert.match(html, /<div role="status" aria-live="polite" [^>]*>\{\{ announce \}\}<\/div>/);
  const { view, location, timers, byId } = await component('demo.html');
  const keys = [...view.tourSteps().map(s => s.key)];
  assert.deepEqual(keys.slice(0, 2), ['problem', 'intro']);
  assert.ok(keys.length >= 11 && !keys.includes('deeper') && !keys.includes('scaffold'));
  for (const key of keys) assert.ok(html.includes(`data-tour="${key}"`), `the tour step ${key} has a target`);
  view.state.tour = keys.length - 1;
  const vals = view.renderVals();
  assert.equal(vals.tourNextLabel, 'Get started');
  vals.tourNext();
  assert.deepEqual(location.assigned, ['./start.html']);
  const started = await component('demo.html', { hash: '#tour' });
  started.view.componentDidMount();
  for (const fn of started.timers.splice(0)) fn();
  assert.equal(started.view.renderVals().tourOn, true, '#tour opens the tour once the page has mounted');
  assert.equal(started.byId.tournext.focused, 1);
  const opened = await component('demo.html', { hash: '#assemble/clinical-triage/blob' });
  opened.view.applyHash();
  assert.deepEqual([opened.view.state.uc, opened.view.state.bad], [2, true], 'a failure link opens its system as the blob');
  const anchored = await component('demo.html', { hash: '#harness' });
  anchored.byId.harness = { getBoundingClientRect: () => ({ top: 8000 }) };
  anchored.view.applyHash();
  for (const fn of anchored.timers.splice(0)) fn();
  assert.deepEqual(anchored.window.scrolls, [8000 - 68, 8000 - 68], 'a plain anchor jumps to its section once the page has rendered, and again once it has settled');
});

test('every page lists Demo first in its nav, and llms.txt follows the moves', async () => {
  for (const page of PAGES) {
    const links = [...header(await read(page)).matchAll(/<a href="\.\/([a-z]+\.html)"( aria-current="page")?/g)];
    assert.deepEqual(links.map(m => m[1]), (page === 'index.html' ? [] : ['index.html']).concat(['demo.html', 'start.html', 'spec.html', 'evidence.html', 'producers.html', 'assembler.html', 'about.html']), page);
    assert.deepEqual(links.filter(m => m[2]).map(m => m[1]), page === 'index.html' ? [] : [page], `${page}: only its own link is current`);
  }
  const llms = await read('llms.txt');
  assert.match(llms, /^- \[Demo\]\(https:\/\/contextwindowarchitecture\.io\/demo\.html\)/m);
  assert.match(llms, /^- \[Agent frameworks\]\(https:\/\/contextwindowarchitecture\.io\/demo\.html#harness\)/m);
  assert.match(llms, /^- \[Landing page\]\(https:\/\/contextwindowarchitecture\.io\/index\.html\): three slides/m);
  assert.ok((await read('about.html')).includes('href="./demo.html#harness"'), 'the Agent frameworks card on About points at Demo');
  assert.ok((await read('spec.html')).includes('<a href="./demo.html#assemble">Live assembler demo →</a>'), 'the Spec page\'s cross link points at Demo');
});
