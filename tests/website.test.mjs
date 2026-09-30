import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as contract from '../contract.js';
import { SCAFFOLDS } from '../scaffolds.js';

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

const PAGES = ['index.html', 'start.html', 'spec.html', 'producers.html', 'evidence.html', 'assembler.html', 'about.html'];

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
    const links = [...header.matchAll(/<a href="\.\/([a-z]+\.html)"( aria-current="page")?/g)];
    assert.deepEqual(links.map(m => m[1]), (page === 'index.html' ? [] : ['index.html']).concat(['start.html', 'spec.html', 'evidence.html', 'producers.html', 'assembler.html', 'about.html']), `${page}: the home link and the nav list every page`);
    assert.deepEqual(links.filter(m => m[2]).map(m => m[1]), page === 'index.html' ? [] : [page], `${page}: only its own link is current`);
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

test('the landing page stacks its fixed multi-column grids on narrow viewports', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  assert.ok(style.includes('@media (max-width: 860px) {\n    #hero, .g2, .g3, .lyrd { grid-template-columns: minmax(0, 1fr) !important; }'), 'the hero, two-column sections and three-column cards stack below 860px');
  assert.ok(style.includes('@media (max-width: 620px) {\n    .g2c, .g4, .rm { grid-template-columns: minmax(0, 1fr) !important; }'), 'card pairs, four-column grids and removed-slot rows stack below 620px');
  assert.ok(style.includes('@media (max-width: 1000px) { .g4 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }'), 'four-column grids halve below 1000px');
  assert.ok(style.includes('#unitrow > div, #wirerow > div { position: static !important; }'), 'stacked columns stop sticking');
  const markup = html.slice(html.indexOf('</style>'), html.indexOf('<script type="text/x-dc"'));
  const hooks = ['id="hero"', 'class="g2"', 'class="g2c"', 'class="g3"', 'class="g4"', 'class="g6"', 'class="g6p"', 'class="lyr"', 'class="lyrd"', 'class="rm"'];
  for (const hook of hooks) {
    const selector = hook.replace(/^id="/, '#').replace(/^class="/, '.').replace(/"$/, '');
    assert.ok(style.includes(selector + ' ') || style.includes(selector + ','), `${hook} has a responsive rule`);
  }
  const fixed = [...markup.matchAll(/<\w+ ([^>]*?grid-template-columns: ([^;"]+)[^>]*)>/g)]
    .map(m => ({ tag: m[1], tracks: m[2] }))
    .filter(g => !g.tracks.includes('auto-fit') && (/repeat\(\d/.test(g.tracks) || (g.tracks.match(/minmax\(/g) || []).length >= 2 || /\b[2-9]\d\dpx/.test(g.tracks) || g.tracks.endsWith(' auto')));
  assert.ok(fixed.length >= 20, `found ${fixed.length} fixed multi-column grids`);
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

test('browser item and trace tools use the shared contract without crashing on valid non-object JSON', async () => {
  const view = await component('producers.html');
  view.state.contract = contract;
  for (const value of ['null', '[]', 'true', '42', '{}']) {
    assert.equal(view.lint(value).verdict, 'checks failed');
    assert.equal(view.validateTrace(value).verdict, 'checks failed');
  }
  view.state.validationTime = '2026-09-22T12:00:00Z';
  assert.equal(view.lint(JSON.stringify(contract.ITEM_EXAMPLE)).verdict, 'local checks passed');
  assert.equal(view.validateTrace(JSON.stringify(contract.TRACE_EXAMPLE)).verdict, 'structure and local invariants valid');
});

test('the migrator preserves long bodies and handles malformed message entries', async () => {
  const view = await component('start.html');
  const body = 'Please explain this technical passage. '.repeat(30);
  const result = view.migrate(JSON.stringify([{ role: 'user', content: body }]));
  assert.ok(result.yaml.includes(JSON.stringify(body)));
  assert.doesNotThrow(() => view.migrate('[null, 1, {"role":"user","content":"Hello"}]'));
  const turns = view.migrate(JSON.stringify([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello. How can I help?' }, { role: 'user', content: 'Refund please' }]));
  assert.match(turns.yaml, /slot: interaction\.history\n    authority: untrusted\n    lineage: generated/);
  assert.equal(turns.items[1].meta.startsWith('authority: untrusted'), true);
});

test('downloads and the static landing-page item preview use canonical examples', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('const SCAFFOLDS ='));
  const preview = html.match(/<!-- CONTRACT_ITEM_START -->\s*<pre[^>]*>([\s\S]*?)<\/pre>/)[1];
  const item = JSON.parse(preview.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
  assert.deepEqual(item, contract.ITEM_EXAMPLE);
  const view = await component('start.html');
  view.state.scaffolds = SCAFFOLDS;
  assert.equal(view.renderVals().scaffoldName, 'assemble.py');
});

test('exported profiles pass the same contract as published profile examples', async () => {
  const profiles = await component('evidence.html', 'PROFILES');
  const view = await component('evidence.html');
  for (const profile of profiles) {
    const exported = JSON.parse(view.yaml(profile));
    assert.equal(contract.checkProfile(exported).valid, true);
    assert.equal(exported.evaluation.status, 'unevaluated');
    const slots = await component('evidence.html', 'SLOTS');
    assert.deepEqual(exported.placement.map(p => p.slot), Array.from(profile.order, i => slots[i]));
  }
});

test('specification, generated requirement reference, and status matrix share every permanent ID', async () => {
  const rules = await component('spec.html', 'RULES');
  const statuses = await component('assembler.html', 'RULES');
  const requirements = JSON.parse(await fs.readFile(new URL('../contract/requirements.json', import.meta.url), 'utf8'));
  assert.equal(rules.length, requirements.length);
  assert.ok(requirements.some(r => r.id === 'R-24'), 'R-24 is published');
  assert.deepEqual(JSON.parse(JSON.stringify(statuses.map(r => r.slice(0, 2)))), JSON.parse(JSON.stringify(rules.map(r => [r[1], r[2]]))));
  const scopes = JSON.parse(await fs.readFile(new URL('../contract/assembler-scope.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(statuses.map(r => [r[2], r[3]]))), scopes.map(s => [s.scope, s.note]));
  const imported = JSON.parse(await fs.readFile(new URL('../contract/assembler-status.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(statuses.map(r => r[4]))), imported.requirements.map(r => r.status));
  const view = await component('assembler.html');
  const met = imported.requirements.filter(r => r.status === 'implemented' || r.status === 'boundary-checked').length;
  assert.equal(view.renderVals().counts, `${met} of ${scopes.filter(s => s.scope !== 'application').length} checkable requirements implemented.`);
  const markdown = await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8');
  for (const { id } of requirements) assert.ok(markdown.includes(`## ${id}:`));
});

// §1 lists the MUSTs aimed at producers and the ones no component can meet for the application. Assembly cannot
// check all of any of them, so none is an assembler row, which the Assembler page calls fully testable in assembly.
test('every requirement §1 lists as a producer or application duty is a boundary or application row', async () => {
  const html = await fs.readFile(new URL('../spec.html', import.meta.url), 'utf8');
  const cited = (from, to) => [...html.split(from)[1].split(to)[0].matchAll(/href="#(R-\d+)"/g)].map(m => m[1]);
  const producers = cited('plus the ones aimed at producers of its kind:', 'A <strong>conformant application</strong>');
  const application = cited('meets the MUSTs no component can meet for it:', '. It renders with');
  assert.ok(producers.length > 0 && application.length > 0);
  const scopes = JSON.parse(await fs.readFile(new URL('../contract/assembler-scope.json', import.meta.url), 'utf8'));
  const scope = Object.fromEntries(scopes.map(s => [s.id, s.scope]));
  for (const id of new Set([...producers, ...application])) assert.notEqual(scope[id], 'assembler', `§1 gives part of ${id} to a producer or the application`);
});

test('an implemented claim imports as boundary-checked on a row the site scopes boundary, and nothing is widened', async () => {
  const { claimsUnder } = await import('../scripts/conformance-reports.mjs');
  const scopes = ['assembler', 'boundary', 'boundary', 'boundary', 'assembler'].map((scope, i) => ({ id: `R-${i + 1}`, scope }));
  const claims = ['implemented', 'implemented', 'boundary-checked', 'in progress', 'boundary-checked'].map((status, i) => ({ id: `R-${i + 1}`, status, evidence: ['t'] }));
  const under = claimsUnder(scopes, claims);
  assert.deepEqual(under.map(c => c.status), ['implemented', 'boundary-checked', 'boundary-checked', 'in progress', 'boundary-checked']);
  assert.deepEqual(under.map(c => c.evidence), claims.map(c => c.evidence));
});

const IMPORTED = [['Python', 'contract/assembler-conformance.json'], ['TypeScript', 'contract/assembler-ts-conformance.json'], ['Go', 'contract/assembler-go-conformance.json']];
const readJson = async path => JSON.parse(await fs.readFile(new URL('../' + path, import.meta.url), 'utf8'));
// A case's digest, computed here independently of scripts/conformance-reports.mjs: SHA-256 over its files' paths and SHA-256s.
async function caseDigest(dir) {
  const root = new URL(`../conformance/${dir}/`, import.meta.url);
  const names = (await fs.readdir(root)).sort();
  const files = await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(new URL(name, root))).digest('hex')]));
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

test('the implementations table and status matrix count, per implementation, the published cases each imported report passes and has run as they are now', async () => {
  const statuses = await component('assembler.html', 'RULES');
  const published = [];
  for (const dir of ['cases', 'rejections']) {
    const root = new URL(`../conformance/${dir}/`, import.meta.url);
    for (const name of await fs.readdir(root)) published.push({ ...await readJson(`conformance/${dir}/${name}/case.json`), digest: await caseDigest(`${dir}/${name}`) });
  }
  assert.equal(new Set(published.map(c => c.id)).size, published.length, 'case and rejection ids are distinct');
  const { implementations } = (await component('assembler.html')).renderVals();
  assert.equal(implementations.length, IMPORTED.length);
  const website = await component('assembler.html', 'WEBSITE');
  assert.match(website, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  for (const [n, [label, file]] of IMPORTED.entries()) {
    const { source, cases_at_run: atRun, report } = await readJson(file);
    assert.match(source.commit, /^[0-9a-f]{40}$/, file);
    const outcomes = new Map([...report.cases.map(c => [c.id, c.outcome === 'passed']), ...(report.rejections ?? []).map(c => [c.id, c.outcome === 'rejected'])]);
    const passing = new Set(published.filter(c => outcomes.get(c.id) && atRun?.[c.id] === c.digest).map(c => c.id));
    const stale = published.filter(c => outcomes.has(c.id) && atRun?.[c.id] !== c.digest).length;
    statuses.forEach((row, i) => {
      const tagged = published.filter(c => c.rules.includes(`R-${i + 1}`));
      assert.equal(row[5], tagged.length, `R-${i + 1} total`);
      assert.equal(row[6][n], tagged.filter(c => passing.has(c.id)).length, `${label} R-${i + 1}`);
    });
    const row = implementations[n];
    assert.equal(row.language, label);
    assert.equal(row.name, report.implementation.name, file);
    assert.equal(row.version, report.implementation.version, file);
    assert.equal(row.repo, source.repository.split('/')[1], file);
    assert.equal(row.repoHref, `https://github.com/${source.repository}`, file);
    assert.equal(row.commit, source.commit.slice(0, 7), file);
    assert.equal(row.commitHref, `https://github.com/${source.repository}/commit/${source.commit}`, file);
    assert.equal(row.website, report.contract.website_commit.slice(0, 7), file);
    assert.equal(row.websiteHref, `${website}/commit/${report.contract.website_commit}`, file);
    assert.equal(row.cases, `${passing.size} of ${published.length} published cases pass`, file);
    assert.equal(row.caseNote, stale ? `${stale} changed since its run` : '', file);
  }
});

test('an imported report is stored whole, valid against its schema, beside its source and the digests of the cases it ran', async () => {
  const { validateConformanceReportSchema } = await import('../generated/schema-validators.js');
  for (const [, file] of IMPORTED) {
    const { source, cases_at_run: atRun, report, ...rest } = await readJson(file);
    assert.deepEqual(Object.keys(rest), [], `${file} carries only source, cases_at_run and report`);
    assert.match(source.commit, /^[0-9a-f]{40}$/, file);
    assert.ok(atRun === null || typeof atRun === 'object', file);
    assert.equal(validateConformanceReportSchema(report), true, `${file}: ${JSON.stringify(validateConformanceReportSchema.errors)}`);
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

test('an imported report names its GitHub repository as owner/repo, from the checkout\'s remote', async () => {
  const { repositoryOf } = await import('../scripts/conformance-reports.mjs');
  for (const url of ['https://github.com/contextwindowarchitecture/assembler-python', 'https://github.com/contextwindowarchitecture/assembler-python.git',
    'git@github.com:contextwindowarchitecture/assembler-python.git', 'ssh://git@github.com/contextwindowarchitecture/assembler-python']) {
    assert.equal(repositoryOf(url), 'contextwindowarchitecture/assembler-python', url);
  }
  assert.equal(repositoryOf('https://gitlab.example.org/team/assembler.git'), 'https://gitlab.example.org/team/assembler.git');
  assert.equal(repositoryOf(null), null);
  for (const [, file] of IMPORTED) {
    const { source } = await readJson(file);
    assert.match(source.repository ?? '', /^[\w.-]+\/[\w.-]+$/, file);
  }
});
