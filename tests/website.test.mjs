import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as contract from '../contract.js';

/** The slice of the DOM a page component touches while rendering: the inline custom properties on <html>. */
function documentStub() {
  const inline = new Map();
  const style = { setProperty: (k, v) => inline.set(k, v), removeProperty: k => inline.delete(k), getPropertyValue: k => inline.get(k) || '' };
  return { inline, documentElement: { style } };
}

async function component(page, expression = 'new Component()', globals = {}) {
  const html = await fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { props = {}; setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); } }
  return vm.runInNewContext(source + '\n' + expression, { DCLogic, console, Date, setTimeout, clearTimeout, structuredClone, document: documentStub(), ...globals });
}

const PAGES = ['index.html', 'spec.html', 'evidence.html', 'assembler.html'];

for (const page of PAGES) {
  test(`${page}: embedded component compiles and renders`, async () => {
    const view = await component(page);
    assert.equal(typeof view.renderVals(), 'object');
  });
}

test('where the header hides the nav row, every page offers a menu button that opens the same links', async () => {
  for (const page of PAGES) {
    const html = await fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
    const header = html.match(/<header[\s\S]*?<\/header>/)[0];
    assert.ok(header.includes('<nav id="sitenav" data-open="{{ menuOpen }}"'), `${page}: the nav opens from component state`);
    assert.ok(header.includes('<button id="hdrmenu" onClick="{{ toggleMenu }}" aria-controls="sitenav" aria-expanded="{{ menuOpen }}"'), `${page}: the menu button controls the nav`);
    assert.ok(html.includes('#hdrmenu { display: inline-block !important; }'), `${page}: the menu button shows where the nav row is hidden`);
    assert.ok(html.includes('#sitenav[data-open="true"] { display: flex !important; }'), `${page}: the open nav is shown`);
    const NAV = ['index.html', 'spec.html', 'assembler.html', 'evidence.html'];
    const links = [...header.matchAll(/<a href="\.\/([a-z]+\.html)"( aria-current="page")?/g)];
    assert.deepEqual(links.map(m => m[1]), (page === 'index.html' ? [] : ['index.html']).concat(NAV), `${page}: the logo links home and the nav lists Home, Spec, Assembler and Placement`);
    assert.deepEqual(links.filter(m => m[2]).map(m => m[1]), NAV.includes(page) ? [page] : [], `${page}: only its own link is current`);
    const view = await component(page);
    assert.equal(view.renderVals().menuOpen, 'false');
    assert.equal(view.renderVals().menuLabel.toLowerCase(), 'menu');
    view.renderVals().toggleMenu();
    assert.equal(view.renderVals().menuOpen, 'true');
    assert.equal(view.renderVals().menuLabel.toLowerCase(), 'close');
    view.renderVals().toggleMenu();
    assert.equal(view.renderVals().menuOpen, 'false');
  }
});

for (const [page, least] of [['index.html', 3], ['assembler.html', 5], ['evidence.html', 2], ['spec.html', 8]]) test(`${page} stacks its fixed multi-column grids on narrow viewports`, async () => {
  const html = await fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  if (page === 'evidence.html') {
    assert.ok(style.includes('@media (max-width: 1000px) { #layout { grid-template-columns: minmax(0, 1fr) !important; }'), 'the docs body collapses to one column below 1000px');
    assert.ok(style.includes('@media (max-width: 620px) { .rm { grid-template-columns: minmax(0, 1fr) !important; } }'), 'protocol rows stack below 620px');
  } else if (page === 'spec.html') {
    assert.ok(style.includes('@media (max-width: 620px) { .rm { grid-template-columns: minmax(0, 1fr) !important; }'), 'labelled rows stack below 620px');
    assert.ok(style.includes('.pln { grid-template-columns: 6px minmax(0, 1fr) !important;'), 'plane rows keep their colour bar and put the slots under the name below 620px');
    assert.ok(/<span style="overflow-wrap: anywhere;"><a href="https:\/\/github\.com\/[\w.-]+\/[\w.-]+" target="_blank" rel="noopener">/.test(html), 'the repository name in the meta row wraps');
    const statements = [...html.matchAll(/<div style="([^"]*)"><sc-for list="\{\{ r\.segs \}\}"/g)].map(m => m[1]);
    assert.ok(statements.length >= 5 && statements.every(s => s.includes('overflow-wrap: anywhere;')), 'requirement statements break long paths such as schema/conflict_group.schema.json');
  } else {
    assert.ok(style.includes('.g2, .g3') && style.includes('{ grid-template-columns: minmax(0, 1fr) !important; }'), 'two-column sections and three-column cards stack below 860px');
    assert.ok(style.includes('.g2c, .g4, .rm { grid-template-columns: minmax(0, 1fr) !important; }'), 'card pairs, four-column grids and removed-slot rows stack below 620px');
  }
  if (page === 'index.html') {
    assert.ok(style.includes('@media (max-width: 1000px) { .g4 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }'), 'four-column grids halve below 1000px');
    assert.ok(style.includes('#unitrow > div { position: static !important; }'), 'stacked columns stop sticking');
  }
  const markup = html.slice(html.indexOf('</style>'), html.indexOf('<script type="text/x-dc"'));
  const hooks = ['id="hero"', 'id="layout"', 'class="im"', 'class="g2"', 'class="g2c"', 'class="g3"', 'class="g4"', 'class="lyr"', 'class="lyrd"', 'class="pln"', 'class="rm"'];
  for (const hook of hooks) {
    const selector = hook.replace(/^id="/, '#').replace(/^class="/, '.').replace(/"$/, '');
    if (markup.includes(hook)) assert.ok(style.includes(selector + ' ') || style.includes(selector + ','), `${hook} has a responsive rule`);
  }
  const fixed = [...markup.matchAll(/<\w+ ([^>]*?grid-template-columns: ([^;"]+)[^>]*)>/g)]
    .map(m => ({ tag: m[1], tracks: m[2] }))
    .filter(g => !g.tracks.includes('auto-fit') && (/repeat\(\d/.test(g.tracks) || (g.tracks.match(/minmax\(/g) || []).length >= 2 || /\b[1-9]\d\dpx/.test(g.tracks) || g.tracks.endsWith(' auto')));
  assert.ok(fixed.length >= least, `found ${fixed.length} fixed multi-column grids`);
  for (const g of fixed) assert.ok(hooks.some(h => g.tag.includes(h)), `a "${g.tracks}" grid stacks on narrow viewports: ${g.tag.slice(0, 80)}`);
});

test('the landing page pins --accent inline only when the Claude Design accent prop is overridden, so the dark token applies otherwise', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const meta = JSON.parse(html.match(/<script type="text\/x-dc"[^>]*data-props="([^"]*)"/)[1].replaceAll('&quot;', '"'));
  const light = html.match(/:root \{[^}]*--accent: ([^;]+);/)[1];
  const dark = html.match(/html\[data-theme="dark"\] \{[^}]*--accent: ([^;]+);/)[1];
  assert.notEqual(dark, light, 'the dark theme has its own accent token');
  assert.equal(meta.accent.default, light, 'the prop default is the light :root token');
  assert.ok(/const ACCENT_DEFAULT = "([^"]+)"/.test(html) && html.match(/const ACCENT_DEFAULT = "([^"]+)"/)[1] === light, 'the component knows the same default');
  const document = documentStub();
  const view = await component('index.html', 'new Component()', { document });
  view.props.accent = meta.accent.default; // what the standalone runtime passes when nothing was overridden
  view.renderVals();
  assert.equal(document.inline.has('--accent'), false, 'the default leaves the stylesheet, and its dark rule, in charge');
  const override = meta.accent.options.find(o => o !== meta.accent.default);
  view.props.accent = override;
  view.renderVals();
  assert.equal(document.inline.get('--accent'), override, 'an override still pins the accent');
  view.props.accent = meta.accent.default;
  view.renderVals();
  assert.equal(document.inline.has('--accent'), false, 'returning to the default releases the pin');
});

// The six steps on the Getting started page each open a walkthrough of the Ada example: the sample prompt for step 1,
// then examples/messages-snapshot.json, its request and its trace. Snippets are built from those files when the page
// loads, so they cannot drift from what the assemblers produce.
async function walkData() {
  const file = name => fs.readFile(new URL('../examples/' + name, import.meta.url), 'utf8').then(JSON.parse);
  return { snapshot: await file('messages-snapshot.json'), payload: await file('messages-payload.json'), trace: await file('messages-trace.json') };
}
const snippet = frame => [...frame.lines].map(l => l.text).join('\n');
const marked = frame => [...frame.lines].filter(l => l.hl).map(l => l.text.trim());

// LICENSE and NOTICE put the specification, schemas, cases, scaffolds and site under Apache-2.0: anyone may use, copy,
// modify and implement them, and a copy they distribute keeps the licence and NOTICE. No page may waive that.
test('every page that speaks of the licence names Apache-2.0 and links it, and none waives its terms', async () => {
  const root = new URL('../', import.meta.url);
  const pages = (await fs.readdir(root)).filter(f => f.endsWith('.html'));
  assert.match(await fs.readFile(new URL('LICENSE', root), 'utf8'), /Apache License\s+Version 2\.0/);
  for (const page of pages) {
    const html = await fs.readFile(new URL(page, root), 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /without attribution|no attribution|no licen[cs]e|public domain/i, page);
    if (/\blicen[cs]e\b|Apache/i.test(text)) assert.ok(html.includes('href="./LICENSE"'), `${page} speaks of the licence without linking it`);
  }
});

test('the Placement page shows the first published profile in its format section, written by the build, and has no explorer', async () => {
  const html = await fs.readFile(new URL('../evidence.html', import.meta.url), 'utf8');
  const profiles = JSON.parse(await fs.readFile(new URL('../examples/profiles.json', import.meta.url), 'utf8'));
  const block = html.match(/<!-- CONTRACT_PROFILE_START -->([\s\S]*?)<!-- CONTRACT_PROFILE_END -->/)[1];
  assert.ok(block.includes(`<span>profile.yaml</span><span>${profiles[0].id}/v${profiles[0].version}</span>`), 'the panel names the profile');
  const shown = block.match(/overflow: auto;">([\s\S]*?)<\/div>/)[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  assert.deepEqual(JSON.parse(shown), profiles[0]);
  assert.equal(contract.checkProfile(JSON.parse(shown)).valid, true);
  for (const gone of ['<section id="explorer"', 'href="#explorer"', 'const PROFILES', '{{ a.yaml }}', 'Profile explorer']) assert.ok(!html.includes(gone), `${gone} has left the page`);
});

// CHANGES.md is the specification's revision history. The Spec page's draft date is written from it, SPEC.md states
// the same date, and the page shows no changelog: the history reads in CHANGES.md.
test('the Spec page is dated by the newest revision CHANGES.md holds, as SPEC.md is, and carries no changelog or future work', async () => {
  const changes = await fs.readFile(new URL('../CHANGES.md', import.meta.url), 'utf8');
  const html = await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8');
  const markdown = await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8');
  const dates = changes.split(/^## /m).slice(1).map(block => block.slice(0, 10));
  assert.ok(dates.length > 10);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  assert.ok(html.includes(`Specification · draft · ${dates[0]}<`), 'the page is dated by the newest revision');
  assert.ok(markdown.includes(`\nDraft of ${dates[0]}, `), 'SPEC.md states the same date');
  for (const gone of ['<section id="changelog"', '<section id="future"', 'href="#changelog"', 'href="#future"', 'Draft history', 'Future work']) assert.ok(!html.includes(gone), `${gone} is not on the page`);
  assert.ok(!html.includes('href="./producers.html">Producer contract') && !html.includes('Live assembler demo'), 'the contents hold the specification only');
});

test('the specification, its Markdown copy, the scope file and the Python status file share every permanent ID', async () => {
  const rules = await component('spec.html', 'RULES');
  const requirements = JSON.parse(await fs.readFile(new URL('../contract/requirements.json', import.meta.url), 'utf8'));
  assert.equal(rules.length, requirements.length);
  assert.ok(requirements.some(r => r.id === 'R-24'), 'R-24 is published');
  const scopes = JSON.parse(await fs.readFile(new URL('../contract/assembler-scope.json', import.meta.url), 'utf8'));
  assert.deepEqual(scopes.map(s => s.id), requirements.map(r => r.id));
  const imported = JSON.parse(await fs.readFile(new URL('../implementations/python.status.json', import.meta.url), 'utf8'));
  assert.deepEqual(imported.requirements.map(r => r.id), requirements.map(r => r.id));
  for (const r of imported.requirements) assert.ok(['implemented', 'boundary-checked', 'documented', 'in progress', 'planned'].includes(r.status), `${r.id}: ${r.status}`);
  assert.ok(!(await fs.readFile(new URL('../assembler.html', import.meta.url), 'utf8')).includes('const RULES'), 'the Assembler page no longer carries requirement rows');
  const markdown = await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8');
  for (const { id } of requirements) assert.ok(markdown.includes(`### ${id}:`));
});

const SPEC_SECTIONS = { model: 2, gov: 3, fit: 4, prof: 5, trace: 6 };
// A plain paragraph of the page to edit in the tests below: the first that is a bare <p> holding words only.
const plainParagraph = async source => {
  const { specBlocks } = await import('../scripts/spec-markdown.mjs');
  const block = specBlocks(source).blocks.find(b => b.kind === 'paragraph' && !/[\\*\[<&]/.test(b.md) &&
    source.html.slice(b.node.start, b.node.innerStart) === '<p style="margin: 0;">' && source.html.slice(b.node.innerStart, b.node.innerEnd) === b.md);
  assert.ok(block, 'the page has a plain paragraph');
  return block.md;
};
const specSource = async () => ({
  html: await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8'),
  markdown: await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8'),
  requirements: JSON.parse(await fs.readFile(new URL('../contract/requirements.json', import.meta.url), 'utf8')),
  site: 'https://' + (await fs.readFile(new URL('../CNAME', import.meta.url), 'utf8')).trim() + '/',
});

// SPEC.md is the normative text and the Spec page renders it: the page, read back as Markdown, is SPEC.md from its
// requirement index on, byte for byte once SPEC.md's generated markers are set aside, and carries the same draft date.
// An edit to either one alone fails here: SPEC.md's until a sync, the page's for good.
test('the Spec page, read back, says exactly what SPEC.md says from its requirement index to section 6; Future work stays in SPEC.md', async () => {
  const { specMarkdown, specBody } = await import('../scripts/spec-markdown.mjs');
  const { pageMatches } = await import('../scripts/spec-page.mjs');
  const source = await specSource();
  const body = specBody(source.markdown);
  assert.ok(body.startsWith('## Requirement index\n') && body.includes('\n## 6 ') && !body.includes('Future work') && source.markdown.includes('\n## Future work · non-normative\n'));
  assert.equal(specMarkdown(source), body);
  assert.equal(pageMatches(source), true);
  const sentence = await plainParagraph(source);
  assert.equal(pageMatches({ ...source, html: source.html.replace(`>${sentence}<`, `>${sentence} Edited.<`) }), false, 'page prose edited alone');
  assert.equal(pageMatches({ ...source, markdown: source.markdown.replace(/^Draft of \d{4}/m, 'Draft of 1999') }), false, 'another draft date');
});

test('a sync rewrites only the page blocks whose SPEC.md text changed, and lays out an added one as the page does', async () => {
  const { syncPage, pageMatches } = await import('../scripts/spec-page.mjs');
  const source = await specSource();
  assert.deepEqual(syncPage(source), { html: source.html, changed: [] }, 'nothing changed, nothing written');
  const outside = (html, inner) => html.replace(inner, '');
  const sentence = await plainParagraph(source);
  const paragraph = [null, sentence];

  const changed = { ...source, markdown: source.markdown.replace(sentence, 'Every implementation cites requirements by number, as **R-1** shows in [the README](https://contextwindowarchitecture.io/conformance/README.md).') };
  const after = syncPage(changed);
  assert.equal(after.changed.length, 1);
  assert.ok(after.html.includes('Every implementation cites requirements by number, as <strong><a href="#R-1">R-1</a></strong> shows in <a href="./conformance/README.md">the README</a>.</p>'));
  const newInner = after.html.match(/<p style="margin: 0;">([^<]*Every implementation cites[\s\S]*?)<\/p>/)[1];
  assert.equal(outside(after.html, newInner), outside(source.html, paragraph[1]), 'nothing outside that block moved');
  assert.equal(pageMatches({ ...changed, html: after.html }), true);

  const added = { ...source, markdown: source.markdown.replace(`${sentence}\n\n`, `${sentence}\n\nA paragraph SPEC.md added, citing R-9.\n\n`) };
  const grown = syncPage(added);
  assert.ok(grown.html.includes(`${sentence}</p>\n          <p style="margin: 0;">A paragraph SPEC.md added, citing <a href="#R-9">R-9</a>.</p>\n`), 'set as the paragraph before it');
  assert.equal(pageMatches({ ...added, html: grown.html }), true);

  const removed = { ...source, markdown: source.markdown.replace(`${paragraph[1]}\n\n`, '') };
  const shrunk = syncPage(removed);
  assert.ok(!shrunk.html.includes(sentence) && shrunk.html.length < source.html.length);
  assert.equal(pageMatches({ ...removed, html: shrunk.html }), true);

  assert.throws(() => syncPage({ ...source, markdown: source.markdown.replace('<!-- generated:tests -->', '<!-- generated:extra -->\n\nx\n\n<!-- /generated:extra -->\n\n<!-- generated:tests -->') }), /generated blocks/);
});

test('the Spec page shows the planes, slots, fields, authority, conflicts, stages and tests contract/model.json lists, in its order', async () => {
  const model = JSON.parse(await fs.readFile(new URL('../contract/model.json', import.meta.url), 'utf8'));
  const vals = JSON.parse(JSON.stringify((await component('spec.html')).renderVals()));
  const planeOf = slot => slot.split('.')[0];
  const color = { governance: 'var(--p-gov)', state: 'var(--p-state)', evidence: 'var(--p-evid)', interaction: 'var(--p-inter)' };
  assert.deepEqual(vals.planes, model.planes.map(p => ({ name: p.name, color: color[p.id], answers: p.answers, slots: model.slots.filter(s => planeOf(s.id) === p.id).map(s => s.id) })));
  assert.deepEqual(vals.slots, model.slots.map(s => ({ id: s.id, color: color[planeOf(s.id)], holds: s.holds, rule: s.rule })));
  assert.deepEqual([vals.mustFields, vals.shouldFields], [model.item_fields.must, model.item_fields.should]);
  assert.deepEqual(vals.itemFields, model.item_fields.described);
  assert.deepEqual(vals.authority.map(({ name, value, text }) => ({ name, value, text })), model.authority);
  assert.deepEqual(vals.conflicts, model.conflicts);
  assert.deepEqual(vals.stages.map(({ name, text }) => ({ name, text })), model.stages.map(({ name, text }) => ({ name, text })));
  assert.deepEqual(vals.tests.map(({ name, text, rule }) => ({ name, text, requirement: rule })), model.tests);
});

test('SPEC.md puts each requirement, text unchanged, in the section the Spec page puts it in, and indexes them all', async () => {
  const markdown = await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8');
  const requirements = JSON.parse(await fs.readFile(new URL('../contract/requirements.json', import.meta.url), 'utf8'));
  const escape = text => text.replace(/[\\*<]/g, '\\$&');
  const headings = [...markdown.matchAll(/^## (\d) /gm)].map(m => ({ n: Number(m[1]), at: m.index }));
  assert.deepEqual(headings.map(h => h.n), [1, 2, 3, 4, 5, 6]);
  for (const r of requirements) {
    const block = `### ${r.id}: ${escape(r.summary)}\n\n${escape(r.text)}\n`;
    const at = markdown.indexOf(block);
    assert.ok(at >= 0, `${r.id} is in SPEC.md as contract/requirements.json words it`);
    assert.equal(headings.findLast(h => h.at < at).n, SPEC_SECTIONS[r.section], `${r.id} is in section ${SPEC_SECTIONS[r.section]}`);
    assert.ok(markdown.includes(`| ${r.id} | ${r.keyword} | ${escape(r.summary)} |`), `${r.id} is in the index`);
  }
  assert.equal([...markdown.matchAll(/^### R-\d+:/gm)].length, requirements.length, 'no requirement is repeated or left over');
  assert.ok(markdown.indexOf('| R-1 |') < headings[0].at, 'the index comes before section 1');
});

test('SPEC.md reads the same outside this repository: page links are absolute, and file links name files beside it', async () => {
  const markdown = await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8');
  const site = 'https://' + (await fs.readFile(new URL('../CNAME', import.meta.url), 'utf8')).trim() + '/';
  const targets = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(targets.some(t => t === site + 'spec.html'), 'SPEC.md links the Spec page that renders it');
  for (const target of targets) {
    if (target.startsWith(site)) await fs.access(new URL('../' + target.slice(site.length).split('#')[0], import.meta.url));
    else {
      assert.doesNotMatch(target, /^[a-z]+:|\.html|^#/, `${target} is a file beside SPEC.md`);
      await fs.access(new URL('../' + target, import.meta.url));
    }
  }
});

// §1 lists the MUSTs aimed at producers and the ones no component can meet for the application. Assembly cannot
// check all of any of them, so none is an assembler row, which the Assembler page calls fully testable in assembly.
test('every requirement §1 lists as a producer or application duty is a boundary or application row', async () => {
  const html = await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8');
  const cited = (from, to) => [...html.split(from)[1].split(to)[0].matchAll(/href="#(R-\d+)"/g)].map(m => m[1]);
  const producers = cited('plus the MUSTs aimed at producers:', 'A <strong>conformant application</strong>');
  const application = cited('meets the MUSTs no component can meet for it:', '. It renders with');
  assert.ok(producers.length > 0 && application.length > 0);
  const scopes = JSON.parse(await fs.readFile(new URL('../contract/assembler-scope.json', import.meta.url), 'utf8'));
  const scope = Object.fromEntries(scopes.map(s => [s.id, s.scope]));
  for (const id of new Set([...producers, ...application])) assert.notEqual(scope[id], 'assembler', `§1 gives part of ${id} to a producer or the application`);
});

const IMPORTED = JSON.parse(await fs.readFile(new URL('../implementations/index.json', import.meta.url), 'utf8')).map(({ label, id }) => [label, `implementations/${id}.json`]);
const readJson = async path => JSON.parse(await fs.readFile(new URL('../' + path, import.meta.url), 'utf8'));
// A case's digest, computed here independently of scripts/conformance-reports.mjs: SHA-256 over its files' paths and SHA-256s.
async function caseDigest(dir) {
  const root = new URL(`../conformance/${dir}/`, import.meta.url);
  const names = (await fs.readdir(root)).sort();
  const files = await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(new URL(name, root))).digest('hex')]));
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

test('the implementations table counts, per implementation, the published cases each imported report passes and has run as they are now', async () => {
  const published = [];
  for (const dir of ['cases', 'rejections']) {
    const root = new URL(`../conformance/${dir}/`, import.meta.url);
    for (const name of await fs.readdir(root)) published.push({ ...await readJson(`conformance/${dir}/${name}/case.json`), digest: await caseDigest(`${dir}/${name}`) });
  }
  assert.equal(new Set(published.map(c => c.id)).size, published.length, 'case and rejection ids are distinct');
  const { implementations } = (await component('assembler.html')).renderVals();
  assert.equal(implementations.length, IMPORTED.length);
  for (const [n, [label, file]] of IMPORTED.entries()) {
    const { source, cases_at_run: atRun, report } = await readJson(file);
    assert.match(source.commit, /^[0-9a-f]{40}$/, file);
    const outcomes = new Map([...report.cases.map(c => [c.id, c.outcome === 'passed']), ...(report.rejections ?? []).map(c => [c.id, c.outcome === 'rejected'])]);
    const passing = new Set(published.filter(c => outcomes.get(c.id) && atRun?.[c.id] === c.digest).map(c => c.id));
    const stale = published.filter(c => outcomes.has(c.id) && atRun?.[c.id] !== c.digest).length;
    const row = implementations[n];
    assert.equal(row.language, label);
    assert.equal(row.name, report.implementation.name, file);
    assert.equal(row.version, report.implementation.version, file);
    assert.equal(row.repo, source.repository.split('/')[1], file);
    assert.equal(row.repoHref, `https://github.com/${source.repository}`, file);
    assert.equal(row.commit, source.commit.slice(0, 7), file);
    assert.equal(row.commitHref, `https://github.com/${source.repository}/commit/${source.commit}`, file);
    assert.deepEqual(JSON.parse(JSON.stringify(row.tags)), source.tags.map(name => ({ name, href: `https://github.com/${source.repository}/releases/tag/${encodeURIComponent(name)}` })), file);
    // The repository and commit the report's cases came from: the website's before the specification repository
    // became the author, that repository's since. A report in the older shape names only a website commit.
    const contract = { repository: 'contextwindowarchitecture/website', commit: report.contract.website_commit, ...report.contract };
    assert.equal(row.contract, { 'contextwindowarchitecture/website': 'website', 'contextwindowarchitecture/contextwindowarchitecture': 'spec' }[contract.repository], file);
    assert.equal(row.contractSha, contract.commit.slice(0, 7), file);
    assert.equal(row.contractHref, `https://github.com/${contract.repository}/commit/${contract.commit}`, file);
    assert.equal(row.cases, `${passing.size} of ${published.length} published cases pass`, file);
    assert.equal(row.caseNote, stale ? `${stale} changed since its run` : '', file);
  }
});

test('a case changed or published after a report\'s run does not count as passing', async () => {
  const { tally } = await import('../scripts/conformance-reports.mjs');
  const published = [{ id: 'a', digest: 'd1' }, { id: 'b', digest: 'd2' }, { id: 'c', digest: 'd3' }, { id: 'd', digest: 'd4' }];
  const report = { cases: [{ id: 'a', outcome: 'passed' }, { id: 'b', outcome: 'passed' }, { id: 'c', outcome: 'failed' }], rejections: [] };
  const outcomes = tally(report, { a: 'd1', b: 'old', c: 'd3' }, published);
  assert.deepEqual(Object.fromEntries(outcomes), { a: 'passed', b: 'stale', c: 'failed', d: 'not run' });
  assert.deepEqual(Object.fromEntries(tally(report, null, published)), { a: 'stale', b: 'stale', c: 'stale', d: 'not run' });
  const rejection = tally({ cases: [], rejections: [{ id: 'a', outcome: 'rejected' }] }, { a: 'd1' }, published.slice(0, 1));
  assert.deepEqual(Object.fromEntries(rejection), { a: 'passed' });
});

// llms.txt indexes the site for language models in the llms.txt format (https://llmstxt.org/): a title, a one-paragraph
// summary, then sections that each list links. The guides it links to, and llms-full.txt, link to the site and the
// website repository, so every such link must name a file or directory this repository publishes, and a fragment
// an id on that page.
const LLMS = ['llms.txt', 'llms-producers.txt', 'llms-assemblers.txt'];
const repoFile = file => fs.readFile(new URL('../' + file, import.meta.url), 'utf8');

test('llms.txt is an llms.txt index, the landing page links it, and every llms link names a published file', async () => {
  const index = await repoFile('llms.txt');
  const lines = index.split('\n');
  assert.match(lines[0], /^# \S/);
  assert.equal(lines[1], '');
  assert.match(lines[2], /^> \S/);
  const sections = index.split(/^## /m).slice(1);
  assert.ok(sections.length > 0, 'llms.txt has no link sections');
  for (const section of sections) {
    for (const line of section.split('\n').slice(1).filter(l => l.trim())) assert.match(line, /^- \[[^\]]+\]\(https:\/\/[^)\s]+\)/, line);
  }
  assert.ok((await repoFile('index.html')).includes('<a href="./llms.txt">llms.txt</a>'), 'the landing-page footer links llms.txt');
  const local = /https:\/\/(?:contextwindowarchitecture\.io|github\.com\/contextwindowarchitecture\/website\/tree\/main)\/([^\s)`>]*)/g;
  for (const file of [...LLMS, 'llms-full.txt']) {
    for (const [url, target] of (await repoFile(file)).matchAll(local)) {
      const [path, fragment] = target.replace(/[.,;:]+$/, '').split('#');
      const stat = await fs.stat(new URL('../' + (path || 'index.html'), import.meta.url)).catch(() => null);
      assert.ok(stat, `${file} links ${url}, which this repository does not publish`);
      if (fragment) assert.ok((await repoFile(path)).includes(`id="${fragment}"`), `${file} links ${url}, which has no such anchor`);
    }
  }
});

// The guides are written by hand, so a test holds them to the contract's spelling: every requirement they cite exists,
// and every snake_case identifier they name, a reason code, field or route rule, appears in a schema, the reason
// registry, the slot defaults, the requirements or the conformance README.
test('the llms guides cite only requirements and identifiers the contract defines', async () => {
  const requirements = JSON.parse(await repoFile('contract/requirements.json'));
  const schemas = await Promise.all((await fs.readdir(new URL('../schema/', import.meta.url))).map(f => repoFile('schema/' + f)));
  const defined = [...schemas, ...await Promise.all(['contract/reasons.json', 'contract/slot-defaults.json', 'contract/requirements.json',
    'conformance/README.md'].map(repoFile))].join('\n');
  for (const file of LLMS) {
    const text = await repoFile(file);
    for (const [cited, n] of text.matchAll(/\bR-(\d+)\b/g)) assert.ok(Number(n) >= 1 && Number(n) <= requirements.length, `${file} cites ${cited}`);
    for (const [, name] of text.matchAll(/`([a-z]+(?:_[a-z0-9]+)+)`/g)) assert.ok(defined.includes(name), `${file} names ${name}, which the contract does not define`);
  }
});

// A reader of the site can reach the specification's home: from the Spec page, from the About page's account of how
// the specification is maintained, and, for an agent, from the llms.txt index.
test('the Spec page and llms.txt link the specification repository', async () => {
  const REPOSITORY = 'https://github.com/contextwindowarchitecture/contextwindowarchitecture';
  for (const page of ['spec.html']) {
    const html = await fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
    assert.ok(html.includes(`<a href="${REPOSITORY}" target="_blank" rel="noopener">`), `${page} links the specification repository`);
  }
  const lock = JSON.parse(await fs.readFile(new URL('../spec.lock.json', import.meta.url), 'utf8'));
  assert.ok((await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8')).includes(`This page renders commit <a href="${REPOSITORY}/commit/${lock.commit}">${lock.commit.slice(0, 7)}</a>`), 'the Spec page names the commit it renders');
  const specification = (await fs.readFile(new URL('../llms.txt', import.meta.url), 'utf8')).split(/^## /m).find(section => section.startsWith('Specification\n'));
  assert.ok(specification.split('\n').some(line => line.startsWith(`- [Specification repository](${REPOSITORY}): `)), 'llms.txt lists it under Specification');
  assert.ok((await fs.readFile(new URL('../llms-full.txt', import.meta.url), 'utf8')).includes(`(${REPOSITORY})`), 'llms-full.txt carries the link');
  assert.ok((await fs.readFile(new URL('../README.md', import.meta.url), 'utf8')).includes(`(${REPOSITORY})`), 'the README names where the specification comes from');
});

// A reader deep in §4 should not have to scroll back to the index to learn what R-16 is about (FEEDBACK.md, Spec).
test('every rule card on the Spec page names its rule above the text, as contract/requirements.json words it', async () => {
  const html = await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8');
  const cards = [...html.matchAll(/<div id="\{\{ r\.id \}\}"[^>]*>([\s\S]*?)\n            <\/div>/g)].map(m => m[1]);
  assert.equal(cards.length, 5, 'one card template per section that lists rules');
  for (const card of cards) assert.ok(/<div style="font-size: 15px; font-weight: 600;[^"]*">\{\{ r\.summary \}\}<\/div><div style="font-family: var\(--mono\);[^"]*"><sc-for list="\{\{ r\.segs \}\}"/.test(card), 'the title, then the statement');
  const requirements = JSON.parse(await fs.readFile(new URL('../contract/requirements.json', import.meta.url), 'utf8'));
  const view = await component('spec.html');
  const vals = view.renderVals();
  const shown = ['rulesModel', 'rulesGov', 'rulesFit', 'rulesProf', 'rulesTrace'].flatMap(list => [...vals[list]]).map(r => [r.id, r.summary]);
  assert.deepEqual(shown.sort(), requirements.map(r => [r.id, r.summary]).sort(), 'every requirement once, with its own title');
});

test('the Spec page\'s lede says what the specification is, not how the page was made', async () => {
  const html = await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8');
  const lede = html.match(/<h1[^>]*>Context Window Architecture<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(lede, 'The rules an assembler, its producers and your application follow, numbered from R-1. A number is never changed or reused. Where another page disagrees with this one, this page is right.');
  assert.ok(!html.includes('the producer guide, or in the evidence notes'), 'no names the nav does not use');
});

// The reader feedback of 2026-10-21: seven systems were too many to take in, "Decisions it forces" asked about things
// the animation never showed, and a one-line chunk labelled ~1,500 tokens looked invented.
test('the Assembler simulator shows three systems, says its sizes are typical, and asks no unrelated questions', async () => {
  const html = await fs.readFile(new URL('../assembler.html', import.meta.url), 'utf8');
  const view = await component('assembler.html');
  assert.deepEqual([...view.renderVals().ucTabs].map(t => t.label), ['Support agent', 'Clinical triage', 'Weekly brief']);
  assert.ok(!html.includes('Decisions it forces') && !html.includes('questions:') && !html.includes('ucQuestions'));
  assert.ok(html.includes('>What this one teaches</div>'));
  const demo = html.slice(html.indexOf('<section id="assemble"'), html.indexOf('</section>', html.indexOf('<section id="assemble"')));
  assert.ok(demo.indexOf('sizes are typical for each slot, not counts of the line shown') > demo.indexOf('{{ payload }}') && demo.indexOf('sizes are typical') < demo.indexOf('Symptom you'), 'the note sits under the request it explains');
  const lede = demo.match(/<h2[^>]*>Three requests, assembled\.<\/h2>\s*<p[^>]*>([^<]+)<\/p>/)[1];
  assert.ok(lede.split(/\s+/).length <= 30, lede);
  assert.ok(!html.includes('fmOpen') && !html.includes('openFailure'), 'the failure-card handlers left with the old home page');
});

// A reader asked how slots reach the model: brackets? training? (FEEDBACK.md, Spec). Placement shows the answer for
// the profile it prints, from the specification's own example request.
test('Placement shows the request its profile renders, from the specification\'s example', async () => {
  const html = await fs.readFile(new URL('../evidence.html', import.meta.url), 'utf8');
  const read = async name => JSON.parse(await fs.readFile(new URL('../' + name, import.meta.url), 'utf8'));
  const blocks = await import('../scripts/example-blocks.mjs');
  const [profile] = await read('examples/profiles.json');
  const snapshot = await read('examples/messages-snapshot.json'), payload = await read('examples/messages-payload.json');
  const block = html.match(/<!-- PROFILE_REQUEST_START -->([\s\S]*?)<!-- PROFILE_REQUEST_END -->/)[1];
  assert.equal(block, blocks.profileRequestBlock({ profile, snapshot, payload }).PROFILE_REQUEST);
  const text = block.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  assert.ok(text.startsWith('── system ──\nYou are Ada') && text.includes('\n── tool ──\n') && /\n── user ──\n<user_profile id="user:profile">\n/.test(text) && text.endsWith('</query>'));
  for (const { wrap } of profile.placement.filter(p => p.wrap.startsWith('xml:') && snapshot.batches.some(b => b.items.some(i => i.slot === p.slot)))) {
    assert.ok(text.includes(`<${wrap.slice(4)} id="`), `${wrap} becomes a tag the model reads`);
  }
  assert.ok(html.includes('The model receives ordinary messages with tagged text, so no training is needed.'));
  assert.ok(html.includes('<a href="./index.html#sent">The same step in a running app, on the home page →</a>'));
  assert.throws(() => blocks.profileRequestBlock({ profile: { ...profile, version: 99 }, snapshot, payload }), /not the profile Placement shows/);
});
