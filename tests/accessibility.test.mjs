import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// The site's accessibility floor, WCAG 2.2 AA as the yardstick: every colour the pages use as text clears 4.5:1 on
// both page backgrounds in both themes; every page carries a reduced-motion rule, and the Assembler page's simulator
// starts still under it; every page falls back without JavaScript to a note that names the readable files; the
// simulator announces what a visitor changed
// and marks its pressed tabs; and the header logo meets the 24px target size.

const PAGES = ['index.html', 'start.html', 'spec.html', 'producers.html', 'evidence.html', 'assembler.html', 'about.html'];
const read = page => fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
const styleOf = html => html.match(/<style>([\s\S]*?)<\/style>/)[1];

/** A page component in a DOM stub with what mounting and the tour touch: the theme attribute, focus and the clocks. */
async function component(page, { reduceMotion = false, setInterval = globalThis.setInterval } = {}) {
  const html = await read(page);
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { props = {}; setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); if (cb) cb(); } }
  const focusable = () => ({ focused: 0, focus() { this.focused += 1; } });
  const byId = { tournext: focusable() };
  const document = {
    documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, setAttribute() {} },
    activeElement: focusable(), getElementById: id => byId[id] ?? null, querySelector: () => null, addEventListener() {}, removeEventListener() {},
  };
  const window = { matchMedia: () => ({ matches: reduceMotion }), addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800, scrollTo() {} };
  const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, Date, setTimeout, clearTimeout, setInterval, clearInterval() {}, structuredClone, document, window, location: { hash: '' } });
  return { view, document, byId };
}

// OKLCH to sRGB as CSS Color 4 defines it, then WCAG 2 relative luminance and contrast.
function srgb(oklch) {
  const m = oklch.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  assert.ok(m, `${oklch} is an oklch() literal`);
  const [L, C, h] = m.slice(1).map(Number);
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s];
  return linear.map(v => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; });
}
const luminance = rgb => { const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); const [r, g, b] = rgb.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(srgb(a)), luminance(srgb(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hex = oklch => '#' + srgb(oklch).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

/** The custom properties a stylesheet declares under one selector. */
function tokens(css, selector) {
  const block = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(block, `${selector} declares tokens`);
  return Object.fromEntries([...block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const TEXT = ['--fg', '--muted', '--accent', '--p-gov', '--p-state', '--p-evid', '--p-inter'];
const BACKGROUNDS = ['--bg', '--surface'];
const COLOURS = [...BACKGROUNDS, ...TEXT, '--line', '--accent-soft'];

test('every colour the pages use as text clears 4.5:1 on both page backgrounds, in both themes, on every page', async () => {
  const reference = {};
  for (const page of PAGES) {
    const css = styleOf(await read(page));
    const light = tokens(css, ':root');
    const dark = { ...light, ...tokens(css, 'html[data-theme="dark"]') };
    for (const [theme, t] of [['light', light], ['dark', dark]]) {
      for (const name of TEXT) for (const bg of BACKGROUNDS) {
        const ratio = contrast(t[name], t[bg]);
        assert.ok(ratio >= 4.5, `${page}, ${theme}: ${name} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
      // The token block is repeated on every page, so every page carries the same values.
      const colours = Object.fromEntries(COLOURS.map(name => [name, t[name]]));
      if (reference[theme]) assert.deepEqual(colours, reference[theme], `${page}, ${theme}: the tokens differ from index.html's`);
      else reference[theme] = colours;
    }
  }
});

test('STYLE.md lists the token values the pages declare, with their sRGB hex, and its block to copy matches them', async () => {
  const style = await fs.readFile(new URL('../STYLE.md', import.meta.url), 'utf8');
  const css = styleOf(await read('index.html'));
  const light = tokens(css, ':root'), dark = tokens(css, 'html[data-theme="dark"]');
  for (const name of COLOURS) {
    const row = style.match(new RegExp('^\\| `' + name + '` \\|[^|]*\\| `([^`]+)` \\| `([^`]+)` \\| `([^`]+)` \\| `([^`]+)` \\|$', 'm'));
    assert.ok(row, `STYLE.md lists ${name}`);
    assert.deepEqual(row.slice(1), [light[name], hex(light[name]), dark[name], hex(dark[name])], name);
  }
  const block = style.match(/```css\n([\s\S]*?)```/)[1];
  assert.deepEqual(tokens(block, ':root'), light);
  assert.deepEqual(tokens(block, 'html[data-theme="dark"]'), dark);
  assert.ok(block.includes('@media (prefers-reduced-motion: reduce)'), 'the block carries the reduced-motion rule');
});

test('every page carries a reduced-motion rule, and the Assembler page starts its simulator still under it', async () => {
  for (const page of PAGES) {
    const css = styleOf(await read(page));
    const rule = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n  \}/);
    assert.ok(rule, `${page} has a reduced-motion rule`);
    assert.ok(rule[1].includes('scroll-behavior: auto'), `${page} stops smooth scrolling`);
    assert.ok(rule[1].includes('animation-duration: 0.01ms !important') && rule[1].includes('transition-duration: 0.01ms !important'), `${page} stops animation and transitions`);
  }
  for (const page of ['assembler.html']) for (const reduceMotion of [false, true]) {
    const { view } = await component(page, { reduceMotion, setInterval: () => 0 });
    view.componentDidMount();
    assert.equal(view.state.playing, !reduceMotion, `the demo ${reduceMotion ? 'starts paused' : 'plays'}`);
    if (reduceMotion) assert.equal(view.state.step, 99, 'the demo shows the whole payload at once');
  }
});

for (const page of ['assembler.html']) test(`${page}: the simulator announces what a visitor changed through a live region, and marks its pressed controls`, async () => {
  const html = await read(page);
  const demo = html.slice(html.indexOf('<section id="assemble"'), html.indexOf('</section>', html.indexOf('<section id="assemble"')));
  assert.match(demo, /<div role="status" aria-live="polite" [^>]*>\{\{ announce \}\}<\/div>/);
  assert.ok(demo.includes('<button onClick="{{ tab.select }}" aria-pressed="{{ tab.pressed }}"'), 'system tabs');
  assert.ok(demo.includes('<button onClick="{{ b.select }}" aria-pressed="{{ b.pressed }}"'), 'budget buttons');
  assert.ok(demo.includes('onClick="{{ toggleBad }}" aria-pressed="{{ badPressed }}"'), 'the blob toggle');
  const { view } = await component(page);
  let vals = view.renderVals();
  assert.equal(vals.announce, '');
  assert.deepEqual([...vals.ucTabs].map(t => t.pressed), ['true', 'false', 'false', 'false', 'false', 'false', 'false']);
  assert.deepEqual([...vals.budgets].map(b => b.pressed), ['true', 'false', 'false', 'false']);
  assert.equal(vals.badPressed, 'false');
  vals.slots[1].click();
  assert.equal(view.renderVals().announce, 'User facts removed from the payload. 8 of 11 admitted.');
  view.renderVals().slots[1].click();
  assert.equal(view.renderVals().announce, 'User facts added back to the payload. 9 of 11 admitted.');
  view.renderVals().slots[0].click();
  assert.equal(view.renderVals().announce, 'Instructions removed. The assembly is refused with required_slot_missing: governance.instructions is never omitted (R-4).');
  view.renderVals().restoreAll();
  assert.equal(view.renderVals().announce, 'All slots restored. 9 of 11 admitted.');
  view.renderVals().budgets[2].select();
  assert.equal(view.renderVals().announce, 'Input budget set to 2k tokens.');
  assert.equal(view.renderVals().budgets[2].pressed, 'true');
  view.renderVals().ucTabs[2].select();
  assert.equal(view.renderVals().announce, 'Showing Clinical triage.');
  assert.equal(view.renderVals().ucTabs[2].pressed, 'true');
  view.renderVals().toggleBad();
  assert.deepEqual([view.renderVals().badPressed, view.renderVals().announce], ['true', 'Showing the unassembled blob.']);
  view.renderVals().togglePlay();
  assert.equal(view.renderVals().announce, 'Playing.');
});

test('every page falls back without JavaScript to a note naming SPEC.md and llms.txt, hides the unrendered template, and declares one viewport', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    assert.ok(noscript && html.indexOf('<noscript>') > html.indexOf('</x-dc>'), `${page} has a no-script note after the template`);
    assert.ok(noscript[1].includes('<style>x-dc { display: none; }</style>'), `${page} hides the template`);
    assert.ok(noscript[1].includes('href="./SPEC.md"') && noscript[1].includes('href="./llms.txt"'), `${page} names the readable files`);
    assert.equal((html.match(/name="viewport"/g) || []).length, 1, `${page} declares one viewport`);
  }
});

test('the header logo link is at least 24px tall, the WCAG 2.2 target size', async () => {
  for (const page of PAGES) {
    const logo = (await read(page)).match(/<a href="(?:\.\/index\.html|#top)" style="([^"]*)"/);
    assert.ok(logo && logo[1].includes('min-height: 24px'), page);
  }
});
