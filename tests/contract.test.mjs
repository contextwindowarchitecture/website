import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { checkItem, checkTrace, checkProfile, checkProducerBatch } from '../contract.js';
import { validateItemSchema, validateTraceSchema } from '../generated/schema-validators.js';
import { SCAFFOLDS } from '../scaffolds.js';

const read = async path => JSON.parse(await fs.readFile(new URL('../' + path, import.meta.url), 'utf8'));
const item = await read('examples/context-item.json');
const trace = await read('examples/trace.json');
const profiles = await read('examples/profiles.json');
const batch = await read('examples/producer-batch.json');
const context = { assemblyTime: '2026-09-22T12:00:00Z' };
const copy = value => structuredClone(value);

test('downloaded item and schema are the canonical published data', async () => {
  const example = JSON.parse(SCAFFOLDS.find(s => s.filename === 'context_item.yaml').text);
  assert.deepEqual(example, item);
  assert.deepEqual(JSON.parse(SCAFFOLDS.find(s => s.filename.endsWith('.schema.json')).text), await read('schema/context_item.schema.json'));
  assert.equal(checkItem(example, context).valid, true);
});

for (const value of [null, [], 42, true, 'text', {}]) {
  test(`rejects invalid top-level items and traces: ${JSON.stringify(value)}`, () => {
    assert.equal(checkItem(value, context).valid, false);
    assert.equal(checkTrace(value).valid, false);
  });
}

const itemMutations = {
  'missing body': item => delete item.body,
  'null source': item => item.source = null,
  'invalid trust': item => item.trust = 'certain',
  'obsolete authority': item => item.authority = 'reference',
  'prototype authority': item => item.authority = 'constructor',
  'prototype slot': item => item.slot = '__proto__',
  'ambiguous timestamp alias': item => item.as_of = item.freshness,
  'impossible date': item => item.freshness = '2026-02-30T12:00:00Z',
  'missing timezone': item => item.freshness = '2026-09-12T15:30:00',
  'missing retrieval score': item => delete item.relevance,
  'negative token budget': item => item.token_budget = -1,
  'unknown field': item => item.surprise = true,
  'unmarked retrieved content': item => item.injection_risk = 'none',
  'duplicate variant IDs': item => item.variants = [1, 2].map(() => ({ id: 'short', body: 'Quote.', method: 'extract', lineage: 'extracted' }))
};
for (const [name, mutate] of Object.entries(itemMutations)) {
  test(name, () => { const candidate = copy(item); mutate(candidate); assert.equal(checkItem(candidate, context).valid, false); });
}

test('past freshness is not expiry; expiry equality is excluded', () => {
  assert.equal(checkItem(item, context).valid, true);
  assert.equal(checkItem({ ...item, expires: context.assemblyTime }, context).findings[0].reason, 'expired');
  assert.equal(checkItem(item, { assemblyTime: '2027-01-01T00:00:00Z' }).valid, false);
  assert.equal(checkItem(item).valid, false);
});

test('memory requires expiry and records revocation without emitting the body again', () => {
  const memory = { ...item, slot: 'interaction.memory', authority: 'generated', revoked_by: 'turn:19' };
  assert.equal(checkItem(memory, context).findings[0].reason, 'revoked');
  delete memory.expires;
  assert.equal(validateItemSchema(memory), false);
  assert.equal(checkProducerBatch(batch).valid, true);
  assert.equal(batch.excluded[0].body, undefined);
});

test('producer batch rejects ambiguous identity and non-producer rejection stages', () => {
  assert.equal(checkProducerBatch({ ...batch, excluded: [{ item_id: item.id, reason: 'expired', stage: 'producer' }] }).valid, false);
  assert.equal(checkProducerBatch({ ...batch, excluded: [{ item_id: 'other', reason: 'expired', stage: 'assembler' }] }).valid, false);
});

test('defaults are deterministic, schema-valid, and do not mutate candidates', () => {
  const candidate = copy(item);
  for (const field of ['variants', 'conflict_policy', 'eligibility', 'injection_risk', 'lineage', 'token_budget']) delete candidate[field];
  const before = copy(candidate);
  const result = checkItem(candidate, context);
  assert.equal(result.valid, true);
  assert.equal(result.filled.length, 6);
  assert.equal(validateItemSchema(result.item), true);
  assert.deepEqual(candidate, before);
  assert.deepEqual(result, checkItem(candidate, context));
});

test('a forged capability-policy prefix cannot authenticate a producer', () => {
  const capability = { ...item, slot: 'governance.capabilities', authority: 'governing', injection_risk: 'none', tier: 'protected', source: 'capability-policy:forged', id: 'tool:refund' };
  const allowed = { ...context, producer: { id: 'actual-policy', authenticated: true, slots: ['governance.capabilities'] }, capabilityPolicyId: 'actual-policy', allowedCapabilityIds: ['tool:refund'] };
  assert.equal(checkItem(capability, allowed).valid, true);
  assert.equal(checkItem(capability, { ...allowed, producer: { ...allowed.producer, id: 'mcp-adapter' } }).valid, false);
  assert.equal(checkItem(capability, { ...allowed, allowedCapabilityIds: [] }).valid, false);
  assert.equal(checkItem({ ...capability, trust: 'untrusted' }, allowed).valid, false);
  assert.equal(checkItem({ ...capability, tier: 'droppable' }, allowed).valid, false);
});

const traceMutations = {
  'wrong collection type': t => t.included = {},
  'null collection entry': t => t.excluded = [null],
  'missing exclusion reason': t => delete t.excluded[0].reason,
  'missing refusal reason': t => delete t.refused.reason,
  'string refusal flag': t => t.refused.bool = 'false',
  'negative tokens': t => t.result.input_tokens = -1,
  'above input ceiling': t => t.budget.input = 1,
  'missing query': t => t.included = t.included.filter(i => i.slot !== 'interaction.query'),
  'invalid digest': t => t.result.hash = '7f…c1',
  'missing assembly snapshot': t => delete t.context,
  'fact resolved by instruction rank': t => t.conflicts = [{ items: ['tool', 'document'], kind: 'fact', resolution: 'tool wins', decided_by: 'tier' }],
  'protected compression': t => t.compressed = [{ slot: 'governance.instructions', item_id: 'policy', from: 90, to: 20, method: 'summary', variant_id: 'short' }]
};
for (const [name, mutate] of Object.entries(traceMutations)) {
  test(`trace: ${name}`, () => { const candidate = copy(trace); mutate(candidate); assert.equal(checkTrace(candidate).valid, false); });
}

test('success and refusal shapes are mutually consistent', () => {
  assert.equal(checkTrace(trace).valid, true);
  const refused = { ...trace, result: null, included: [], refused: { bool: true, reason: 'protected_content_over_budget' } };
  assert.equal(validateTraceSchema(refused), true);
  assert.equal(checkTrace(refused).valid, true);
  assert.equal(checkTrace({ ...refused, result: trace.result }).valid, false);
  assert.equal(checkTrace({ ...refused, included: trace.included }).valid, false);
});

test('missing evidence requires an explicit recovery handoff, not an in-assembly model call', () => {
  const refused = { ...trace, result: null, included: [], refused: { bool: true, reason: 'evidence_required' } };
  assert.equal(checkTrace(refused).valid, false);
  assert.equal(checkTrace({ ...refused, recovery: { action: 'request_context' } }).valid, true);
});

test('factual precedence may report route policy or explicit escalation', () => {
  for (const decided_by of ['policy', 'freshness', 'escalated']) {
    const candidate = { ...trace, conflicts: [{ items: ['tool', 'document'], kind: 'fact', resolution: 'route-defined outcome', decided_by }] };
    assert.equal(checkTrace(candidate).valid, true);
  }
});

test('every example profile is a valid, explicitly unevaluated draft', () => {
  for (const profile of profiles) {
    assert.equal(checkProfile(profile).valid, true);
    assert.equal(checkProfile(profile).evaluated, false);
    assert.equal(profile.model_family, null);
  }
  const falseClaim = copy(profiles[0]); falseClaim.evaluation.status = 'evaluated';
  assert.equal(checkProfile(falseClaim).valid, false);
});

test('profiles cannot hide protected items or the parser contract', () => {
  const profile = { ...profiles[0], placement: profiles[0].placement.filter(p => p.slot !== 'governance.output_contract') };
  assert.equal(checkProfile(profile, { parser: true }).valid, false);
  assert.equal(checkProfile(profiles[1], { protectedSlots: ['governance.capabilities'] }).valid, false);
});

test('published trace hash and fixture token counts match the concrete sample payload', async () => {
  const profile = await read('examples/fixture-profile.json');
  assert.equal(checkProfile(profile).valid, true);
  assert.deepEqual(trace.profile, { id: profile.id, version: profile.version });
  assert.equal(trace.context.route_policy_version, profile.route_policy_version);
  assert.deepEqual(trace.included.map(item => item.slot), profile.placement.map(entry => entry.slot));
  const payload = await fs.readFile(new URL('../examples/payload.txt', import.meta.url));
  assert.equal(trace.result.hash, createHash('sha256').update(payload).digest('hex'));
  assert.equal(trace.result.input_tokens, payload.toString('utf8').match(/\S+/gu).length);
});
