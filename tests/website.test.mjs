import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as contract from '../contract.js';
import { SCAFFOLDS } from '../scaffolds.js';

async function component(page, expression = 'new Component()') {
  const html = await fs.readFile(new URL('../' + page, import.meta.url), 'utf8');
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { props = {}; setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); } }
  return vm.runInNewContext(source + '\n' + expression, { DCLogic, console, Date, setTimeout, clearTimeout, structuredClone });
}

for (const page of ['index.html', 'start.html', 'spec.html', 'producers.html', 'evidence.html', 'assembler.html', 'about.html']) {
  test(`${page}: embedded component compiles and renders`, async () => {
    const view = await component(page);
    assert.equal(typeof view.renderVals(), 'object');
  });
}

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

const IMPORTED = [['Python', 'contract/assembler-conformance.json'], ['TypeScript', 'contract/assembler-ts-conformance.json']];
const readJson = async path => JSON.parse(await fs.readFile(new URL('../' + path, import.meta.url), 'utf8'));
// A case's digest, computed here independently of scripts/conformance-reports.mjs: SHA-256 over its files' paths and SHA-256s.
async function caseDigest(dir) {
  const root = new URL(`../conformance/${dir}/`, import.meta.url);
  const names = (await fs.readdir(root)).sort();
  const files = await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(new URL(name, root))).digest('hex')]));
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

test('the status matrix counts, per implementation, the published cases each imported report passes and has run as they are now', async () => {
  const statuses = await component('assembler.html', 'RULES');
  const published = [];
  for (const dir of ['cases', 'rejections']) {
    const root = new URL(`../conformance/${dir}/`, import.meta.url);
    for (const name of await fs.readdir(root)) published.push({ ...await readJson(`conformance/${dir}/${name}/case.json`), digest: await caseDigest(`${dir}/${name}`) });
  }
  assert.equal(new Set(published.map(c => c.id)).size, published.length, 'case and rejection ids are distinct');
  const { caseLines } = (await component('assembler.html')).renderVals();
  assert.equal(caseLines.length, IMPORTED.length);
  for (const [n, [label, file]] of IMPORTED.entries()) {
    const { source, cases_at_run: atRun, ...report } = await readJson(file);
    assert.match(source.commit, /^[0-9a-f]{40}$/, file);
    const outcomes = new Map([...report.cases.map(c => [c.id, c.outcome === 'passed']), ...(report.rejections ?? []).map(c => [c.id, c.outcome === 'rejected'])]);
    const passing = new Set(published.filter(c => outcomes.get(c.id) && atRun?.[c.id] === c.digest).map(c => c.id));
    const stale = published.filter(c => outcomes.has(c.id) && atRun?.[c.id] !== c.digest).length;
    statuses.forEach((row, i) => {
      const tagged = published.filter(c => c.rules.includes(`R-${i + 1}`));
      assert.equal(row[5], tagged.length, `R-${i + 1} total`);
      assert.equal(row[6][n], tagged.filter(c => passing.has(c.id)).length, `${label} R-${i + 1}`);
    });
    const line = caseLines[n].text;
    assert.ok(line.startsWith(`${label} · ${passing.size} of ${published.length} published conformance cases pass`), line);
    assert.ok(line.includes(`assembler ${source.commit.slice(0, 7)}`), line);
    assert.ok(line.includes(`cases at ${report.contract.website_commit.slice(0, 7)}`), line);
    assert.equal(line.includes('changed since its run'), stale > 0, line);
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
