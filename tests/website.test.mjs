import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
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

test('the status matrix counts the published cases the imported conformance report passes', async () => {
  const statuses = await component('assembler.html', 'RULES');
  const { cases: outcomes } = JSON.parse(await fs.readFile(new URL('../contract/assembler-conformance.json', import.meta.url), 'utf8'));
  const passed = new Set(outcomes.filter(c => c.outcome === 'passed').map(c => c.id));
  const root = new URL('../conformance/cases/', import.meta.url);
  const published = await Promise.all((await fs.readdir(root)).map(async name => JSON.parse(await fs.readFile(new URL(`${name}/case.json`, root), 'utf8'))));
  statuses.forEach((row, i) => {
    const tagged = published.filter(c => c.rules.includes(`R-${i + 1}`));
    assert.deepEqual([row[5], row[6]], [tagged.filter(c => passed.has(c.id)).length, tagged.length], `R-${i + 1}`);
  });
  const { caseLine } = (await component('assembler.html')).renderVals();
  assert.ok(caseLine.startsWith(`${published.filter(c => passed.has(c.id)).length} of ${published.length} published conformance cases pass`), caseLine);
});
