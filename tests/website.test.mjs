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

test('specification, generated requirement reference, and status matrix share all 23 permanent IDs', async () => {
  const rules = await component('spec.html', 'RULES');
  const statuses = await component('assembler.html', 'RULES');
  assert.equal(rules.length, 23);
  assert.deepEqual(JSON.parse(JSON.stringify(statuses)), JSON.parse(JSON.stringify(rules.map(r => [r[1], r[2]]))));
  const markdown = await fs.readFile(new URL('../SPEC.md', import.meta.url), 'utf8');
  for (let i = 1; i <= 23; i++) assert.ok(markdown.includes(`## R-${i}:`));
});
