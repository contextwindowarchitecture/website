import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// The site reads in layers: the home page hooks and orients, the deeper pages carry the material, and a reader who
// lands anywhere can pull back a layer. These tests hold the navigation, the home page's shape, and the glossary to
// that (docs/plans/layering.md).

const PAGES = ['index.html', 'start.html', 'spec.html', 'producers.html', 'evidence.html', 'assembler.html', 'about.html'];
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

test('the nav calls the placement page Placement, the spec page is Spec everywhere, and the home page routes builders to Getting started', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    const nav = header(html).match(/<a href="\.\/evidence\.html"[^>]*>([^<]+)<\/a>/);
    assert.equal(nav?.[1], 'Placement', `${page}: the nav names the placement page by its job`);
    assert.ok(!html.includes('>Docs</a>') && !html.includes('Read the docs'), `${page}: the spec page is called Spec`);
  }
  const index = await read('index.html');
  assert.ok(index.includes('If you are building, start with <a href="./start.html">Getting started</a>.'), 'builders start at Getting started');
  assert.ok(index.includes('What CWA is not: <a href="./about.html">About</a>.'), 'the router surfaces what CWA is not');
  assert.ok(index.includes('Read the placement evidence →'), 'the Go deeper card says placement');
  assert.match(await read('start.html'), /<a href="\.\/evidence\.html"[^>]*><span[^>]*>Placement<\/span>/, 'the Start page\'s Next card says Placement');
  assert.ok((await read('about.html')).includes('The Placement page cites what is measured and stops there.'), 'About names the Placement page');
});

test('the hero offers two actions, the tour under one name and then the demo, and the tour hands on to Getting started', async () => {
  const html = await read('index.html');
  const hero = html.slice(html.indexOf('<div id="hero"'), html.indexOf('What it is'));
  const actions = hero.match(/<div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px;">([\s\S]*?)\n        <\/div>/)[1];
  assert.deepEqual([...actions.matchAll(/<(button|a) ([^>]*)>([^<]+)<\/(?:button|a)>/g)].map(m => [m[1], m[3], m[2].includes('onClick="{{ startTour }}') ? 'tour' : m[2].match(/href="([^"]+)"/)[1]]),
    [['button', 'Take the tour', 'tour'], ['a', 'Watch it assemble', '#assemble']]);
  assert.ok(!html.includes('Take the guided tour'), 'the tour has one name');
  assert.ok(header(html).includes('>Take the tour</button>'), 'the header uses the same name');
  const { view, location } = await component('index.html');
  view.state.tour = view.tourSteps().length - 1;
  const vals = view.renderVals();
  assert.equal(vals.tourNextLabel, 'Get started');
  vals.tourNext();
  assert.deepEqual(location.assigned, ['./start.html']);
  assert.equal(view.renderVals().tourOn, false);
});
