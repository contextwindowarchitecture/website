import { ITEM_SCHEMA, SLOT_DEFAULTS } from './generated/contract-data.js';
import { validateItemSchema, validateTraceSchema, validateProfileSchema, validateProducerBatchSchema, validateConflictGroupSchema, validateSnapshotSchema } from './generated/schema-validators.js';

export { SLOT_DEFAULTS, REASONS, ITEM_EXAMPLE, TRACE_EXAMPLE } from './generated/contract-data.js';

const policyFields = ['token_budget', 'variants', 'conflict_policy', 'lineage', 'eligibility', 'injection_risk'];
const TIER_RANK = { droppable: 0, compressible: 1, protected: 2 };
// A slot's default tier, raised by trusted route policy (tierUpgrades); never lowered (R-16).
const effectiveTier = (slot, tierUpgrades) => [SLOT_DEFAULTS[slot].tier, tierUpgrades?.[slot]]
  .filter(tier => tier in TIER_RANK).reduce((a, b) => TIER_RANK[b] > TIER_RANK[a] ? b : a);
// An item's tier: its own tier when it set one, else its slot's. An item may lower its own tier only in a slot
// that is not protected by default; admission excludes the rest (R-16).
const itemTier = (slot, id, context) => {
  const slotTier = effectiveTier(slot, context.tierUpgrades);
  const own = context.itemTiers?.[id];
  return own in TIER_RANK && SLOT_DEFAULTS[slot].tier !== 'protected' && TIER_RANK[own] <= TIER_RANK[slotTier] ? own : slotTier;
};
const failure = (reason, text, rule) => ({ reason, text, rule, level: 'error' });
const schemaErrors = (validator, rule) => (validator.errors || []).map(error =>
  failure('invalid_structure', `${error.instancePath || '/'} ${error.message}`, rule));

// Item schema errors map to the specific codes in contract/reasons.json.
function itemSchemaErrors() {
  const errors = (validateItemSchema.errors || []).filter(error => error.keyword !== 'if');
  return errors.map(error => {
    const text = `${error.instancePath || '/'} ${error.message}`;
    // missing_field names the item's own fields; a variant missing one is invalid_structure.
    if (error.keyword === 'required' && error.instancePath === '') return failure(`missing_field:${error.params.missingProperty}`, text, 2);
    if (error.keyword === 'enum' && error.instancePath === '/slot') return failure('unknown_slot', text, 1);
    if (error.keyword === 'enum' && error.instancePath === '/authority') return failure('unknown_authority', text, 1);
    return failure('invalid_structure', text, 2);
  });
}

// Compare RFC 3339 instants at full stated precision (R-2); Date.parse alone truncates to milliseconds.
const INSTANT = /^(\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/;
export function compareInstants(a, b) {
  const [ma, mb] = [INSTANT.exec(a), INSTANT.exec(b)];
  if (!ma || !mb) return NaN;
  const [sa, sb] = [Date.parse(ma[1] + ma[3]), Date.parse(mb[1] + mb[3])];
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return NaN;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const width = Math.max((ma[2] || '').length, (mb[2] || '').length);
  const [fa, fb] = [(ma[2] || '').padEnd(width, '0'), (mb[2] || '').padEnd(width, '0')];
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

function fillDefaults(item) {
  const defaults = SLOT_DEFAULTS[item.slot];
  const filled = policyFields.filter(field => item[field] === undefined);
  return {
    item: { ...Object.fromEntries(filled.map(field => [field, structuredClone(defaults[field])])), ...item },
    filled
  };
}

// R-1: only these slots may carry untrusted instead of their own role. Not governance or knowledge, not state,
// which the application writes (R-8), and not the query, which always carries user.
const UNTRUSTED_ALLOWED = new Set(['evidence.tool_results', 'interaction.memory', 'interaction.history']);

function checkAuthority(item) {
  const expected = SLOT_DEFAULTS[item.slot].authority;
  const governing = item.slot.startsWith('governance.');
  const lowerable = UNTRUSTED_ALLOWED.has(item.slot);
  if (item.authority !== expected && !(lowerable && item.authority === 'untrusted')) {
    return [failure('authority_not_allowed', `This slot requires ${expected}${lowerable ? ' or untrusted' : ''}.`, 1)];
  }
  if (item.slot === 'interaction.history' && item.lineage === 'generated' && item.authority !== 'untrusted') {
    return [failure('authority_not_allowed', 'Prior model turns in history carry untrusted authority.', 1)];
  }
  if (governing && (item.injection_risk !== 'none' || item.trust !== 'verified')) {
    return [failure('untrusted_in_governance', 'Governance items need trust: verified and injection_risk: none (R-10).', 10)];
  }
  return [];
}

// Move an instant back by whole seconds, keeping its fraction, so the result compares at full precision (R-2).
function minusSeconds(instant, seconds) {
  const match = INSTANT.exec(instant);
  if (!match || !seconds) return instant;
  const base = new Date(Date.parse(match[1] + match[3]) - seconds * 1000).toISOString().slice(0, 19);
  return `${base}${match[2] ? `.${match[2]}` : ''}Z`;
}

function checkLifetime(item, assemblyTime, clockSkewSeconds = 0) {
  // Assembly never reads an ambient clock (R-23); a snapshot without a valid assembly_time is rejected (R-17).
  if (!assemblyTime || Number.isNaN(compareInstants(assemblyTime, assemblyTime))) {
    throw new TypeError('checkItem needs context.assemblyTime, a valid RFC 3339 date-time');
  }
  if (item.revoked_by) return [failure('revoked', `Revoked by ${item.revoked_by}.`, 9)];
  if (item.expires && compareInstants(item.expires, assemblyTime) <= 0) {
    return [failure('expired', `Expired at ${item.expires}.`, 9)];
  }
  // The route's clock_skew_seconds lets producer clocks run ahead of assembly_time by that much.
  if (compareInstants(minusSeconds(item.freshness, clockSkewSeconds), assemblyTime) > 0) {
    return [failure('future_freshness', 'Freshness is later than the assembly snapshot, beyond the route\'s clock skew.', 2)];
  }
  return [];
}

function checkProducer(item, context) {
  // Identity must come from trusted application context, never from item.source.
  if (!context.producer) return [];
  const producer = context.producer;
  if (!producer.authenticated) return [failure('producer_not_authenticated', 'Authenticate the producer outside the item.', 15)];
  if (!producer.slots?.includes(item.slot)) return [failure('producer_slot_not_allowed', 'This producer cannot emit this slot.', 15)];
  // R-8: state comes only from producers of kind state, whatever else the route lists.
  if (item.slot.startsWith('state.') && producer.kind !== 'state') {
    return [failure('producer_slot_not_allowed', 'Only a producer of kind state may emit state.', 8)];
  }
  // R-13: retrieval producers emit only the evidence slots. R-14: memory producers emit only memory. R-15: MCP output
  // enters evidence slots, never governance; a tool specification it sends to governance.capabilities falls to the
  // capability check below.
  if (producer.kind === 'retrieval' && !item.slot.startsWith('evidence.')) {
    return [failure('producer_slot_not_allowed', 'A producer of kind retrieval may emit only evidence slots.', 13)];
  }
  if (producer.kind === 'memory' && item.slot !== 'interaction.memory') {
    return [failure('producer_slot_not_allowed', 'A producer of kind memory may emit only interaction.memory.', 14)];
  }
  if (producer.kind === 'mcp' && !item.slot.startsWith('evidence.') && item.slot !== 'governance.capabilities') {
    return [failure('producer_slot_not_allowed', 'A producer of kind mcp may emit only evidence slots.', 15)];
  }
  // The route capability policy is the grant's producer, listed with kind capability_policy (R-15).
  if (item.slot === 'governance.capabilities' &&
      (producer.kind !== 'capability_policy' || producer.id !== context.capabilityPolicyId || !context.allowedCapabilityIds?.includes(item.id))) {
    return [failure('capability_not_allowed', 'The authenticated capability policy must admit this tool for this route and user.', 15)];
  }
  return [];
}

export function checkItem(candidate, context = {}) {
  if (!validateItemSchema(candidate)) return { valid: false, findings: itemSchemaErrors(), filled: [], item: null };
  const { item, filled } = fillDefaults(candidate);
  const findings = [...checkAuthority(item), ...checkLifetime(item, context.assemblyTime, context.clockSkewSeconds), ...checkProducer(item, context)];
  const verifiedMcp = context.producer?.authenticated && context.producer.kind === 'mcp' && context.verifiedServer === true;
  if (SLOT_DEFAULTS[item.slot].injection_risk === 'untrusted_content' && item.injection_risk !== 'untrusted_content' && !verifiedMcp) {
    findings.push(failure('untrusted_content_unmarked', 'Items in this slot must be marked injection_risk: untrusted_content unless a verified MCP server produced them (R-10, R-15).', 10));
  }
  if (item.variants.some(variant => variant.id === item.id) || new Set(item.variants.map(v => v.id)).size !== item.variants.length) {
    findings.push(failure('duplicate_variant_id', 'Variants need distinct IDs, different from the item ID.', 18));
  }
  if (SLOT_DEFAULTS[item.slot].tier === 'protected' && item.tier && item.tier !== 'protected') {
    findings.push(failure('protected_tier_changed', 'An item cannot downgrade its protected slot.', 16));
  }
  // Only trusted route policy (context.tierUpgrades) may raise a slot's tier; an item may lower a non-protected one.
  const slotTier = effectiveTier(item.slot, context.tierUpgrades);
  if (item.tier && TIER_RANK[item.tier] > TIER_RANK[slotTier]) {
    findings.push(failure('tier_upgrade_not_allowed', `This item claims ${item.tier}, above its slot's ${slotTier} tier; only route policy can raise it.`, 16));
  }
  return { valid: findings.length === 0, findings, filled, item };
}

function checkRenderedBudget(trace, context) {
  const findings = [];
  if (!trace.refused.bool) {
    for (const slot of ['governance.instructions', 'interaction.query']) {
      if (!trace.included.some(item => item.slot === slot)) findings.push(failure('required_slot_not_included', `A trace that was not refused includes nothing in ${slot}.`, 4));
    }
    const includedTokens = trace.included.reduce((sum, item) => sum + item.tokens, 0);
    // The payload fits when its count, charged with budget.margin_percent and rounded up, is within budget.input (R-16).
    const charged = Math.floor((trace.result.input_tokens * (100 + (trace.budget.margin_percent ?? 0)) + 99) / 100);
    if (trace.result.input_tokens < includedTokens || charged > trace.budget.input) {
      findings.push(failure('invalid_token_accounting', 'Rendered input must include all item tokens and fit the input ceiling.', 16));
    }
  } else if (trace.included.length || trace.compressed.length) {
    findings.push(failure('refused_payload_included', 'A refused assembly has no rendered included or compressed items.', 17));
  }
  for (const item of trace.excluded) {
    if (item.reason === 'over_budget' && item.slot && itemTier(item.slot, item.item_id, context) === 'protected') {
      findings.push(failure('protected_omitted', `A protected ${item.slot} item cannot be omitted for budget.`, 16));
    }
    if (['conflict_deferred', 'conflict_lost'].includes(item.reason) && item.slot && itemTier(item.slot, item.item_id, context) === 'protected') {
      findings.push(failure('protected_conflict_excluded', `Conflict resolution cannot exclude a protected ${item.slot} item; its group escalates.`, 11));
    }
    if (item.reason === 'source_diversity_cap' && item.slot && itemTier(item.slot, item.item_id, context) === 'protected') {
      findings.push(failure('protected_diversity_excluded', `The source diversity cap cannot exclude a protected ${item.slot} item; it counts toward the cap.`, 26));
    }
    if (item.reason === 'superseded' && item.slot && itemTier(item.slot, item.item_id, context) === 'protected') {
      findings.push(failure('protected_superseded_excluded', `Supersession cannot exclude a protected ${item.slot} item; it is kept.`, 25));
    }
    if (item.reason === 'duplicate_content' && item.slot && itemTier(item.slot, item.item_id, context) === 'protected') {
      findings.push(failure('protected_duplicate_excluded', `Deduplication cannot exclude a protected ${item.slot} item; it is kept.`, 24));
    }
  }
  return findings;
}

// context.tierUpgrades is the route policy's tier_upgrades; without it, slots keep their default tiers.
// context.itemTiers maps item ids to the tiers items set themselves; without it, each item takes its slot's tier.
export function checkTrace(trace, context = {}) {
  if (!validateTraceSchema(trace)) return { valid: false, findings: schemaErrors(validateTraceSchema, 21) };
  const findings = checkRenderedBudget(trace, context);
  for (const item of trace.compressed) {
    if (item.to >= item.from || itemTier(item.slot, item.item_id, context) !== 'compressible') {
      findings.push(failure('invalid_compression', 'Compression must shorten a compressible item.', 16));
    }
  }
  for (const conflict of trace.conflicts) {
    if (conflict.kind === 'fact' && conflict.decided_by === 'authority') {
      findings.push(failure('factual_authority_inversion', 'Instruction authority cannot decide factual precedence.', 6));
    }
    if (conflict.winner !== undefined && !conflict.items.includes(conflict.winner)) {
      findings.push(failure('unknown_conflict_winner', `The winner ${conflict.winner} is not a member of its conflict group.`, 11));
    }
  }
  return { valid: findings.length === 0, findings };
}

export const CONTRACT_SCOPE = 'Local checks only. The assembler admits items against the route, its scope and eligibility rules included; the application must authenticate provenance, authorize tools, and verify the rendered payload.';
export const ITEM_FIELDS = ITEM_SCHEMA.required;

export function checkProfile(profile, { parser = false, protectedSlots = [] } = {}) {
  if (!validateProfileSchema(profile)) return { valid: false, findings: schemaErrors(validateProfileSchema, 19) };
  const required = new Set(['governance.instructions', 'interaction.query', ...protectedSlots]);
  if (parser) required.add('governance.output_contract');
  const placed = new Set(profile.placement.map(entry => entry.slot));
  const findings = [...required].filter(slot => !placed.has(slot)).map(slot =>
    failure('protected_slot_omitted', `Profile omits ${slot}.`, 20));
  return { valid: findings.length === 0, findings, evaluated: profile.evaluation.status === 'evaluated' };
}

export function checkProducerBatch(batch) {
  if (!validateProducerBatchSchema(batch)) return { valid: false, findings: schemaErrors(validateProducerBatchSchema, 9) };
  const ids = [...batch.items.map(item => item.id), ...batch.excluded.map(item => item.item_id)];
  const findings = new Set(ids).size === ids.length ? [] : [failure('duplicate_item_id', 'Batch item IDs must be unique across candidates and exclusions.', 2)];
  const candidates = new Set(batch.items.map(item => item.id));
  for (const row of batch.excluded) for (const [field, rule] of [['duplicate_of', 13], ['superseded_by', 9]]) {
    if (row[field] !== undefined && !candidates.has(row[field])) {
      findings.push(failure(`unknown_${field}`, `${row.item_id} names ${row[field]} as kept, which is not a candidate in this batch.`, rule));
    }
  }
  return { valid: findings.length === 0, findings };
}

// itemIds: candidate and producer-exclusion ids in the snapshot. facts: the route policy's facts.
export function checkConflictGroup(group, { itemIds, facts } = {}) {
  if (!validateConflictGroupSchema(group)) return { valid: false, findings: schemaErrors(validateConflictGroupSchema, 11) };
  const known = itemIds && new Set(itemIds);
  const findings = known ? group.items.filter(id => !known.has(id)).map(id =>
    failure('unknown_conflict_item', `Conflict group ${group.id} names ${id}, which is not a candidate in this snapshot.`, 11)) : [];
  if (facts && group.kind === 'fact' && !Object.hasOwn(facts, group.fact)) {
    findings.push(failure('unknown_fact', `Conflict group ${group.id} names fact ${group.fact}, which the route policy does not define.`, 11));
  }
  return { valid: findings.length === 0, findings };
}

// A snapshot's groups: each valid on its own, with distinct ids, and no item in two groups (R-11).
export function checkConflictGroups(groups, options = {}) {
  const findings = groups.flatMap(group => checkConflictGroup(group, options).findings);
  const ids = groups.map(group => group.id);
  if (new Set(ids).size !== ids.length) findings.push(failure('duplicate_conflict_group', 'Conflict group ids must be unique.', 11));
  const seen = new Map();
  for (const group of groups) for (const id of group.items ?? []) {
    if (seen.has(id)) findings.push(failure('overlapping_conflict_groups', `${id} belongs to both ${seen.get(id)} and ${group.id}; an item belongs to at most one group.`, 11));
    else seen.set(id, group.id);
  }
  return { valid: findings.length === 0, findings };
}

// Placements a renderer can realize (conformance/README.md, Tokenizers and renderers). An unknown renderer is
// skipped by the caller, not judged here. cwa-message-blocks/v1 realizes exactly what cwa-messages/v1 does.
const XML_WRAP = /^xml:[A-Za-z_][A-Za-z0-9_.-]*$/;
const REALIZE = {
  'fixture-xml/v1': placement => placement.flatMap(({ wrap }, i) => XML_WRAP.test(wrap) ? [] : [`placement[${i}] wrap ${wrap} is not an xml:<name> wrap`]),
  'cwa-messages/v1': placement => {
    let seenXml = false;
    return placement.flatMap(({ slot, wrap }, i) => {
      const problems = [];
      if (wrap !== 'system' && wrap !== 'tools' && !XML_WRAP.test(wrap)) problems.push(`placement[${i}] wrap ${wrap} is not system, tools or xml:<name>`);
      else if (wrap === 'system' && !slot.startsWith('governance.')) problems.push(`placement[${i}] puts ${slot} in system`);
      else if (wrap === 'tools' && slot !== 'governance.capabilities') problems.push(`placement[${i}] puts ${slot} in tools`);
      else if (wrap === 'system' && seenXml) problems.push(`placement[${i}] puts system after an xml: placement`);
      seenXml ||= wrap.startsWith('xml:');
      return problems;
    });
  },
};
REALIZE['cwa-message-blocks/v1'] = REALIZE['cwa-messages/v1'];

// I-JSON (RFC 7493): well-formed strings and numbers a double can hold, so RFC 8785 can serialize the snapshot.
// JSON.parse reads a number beyond the double range, such as 1e400, as Infinity.
const wellFormed = value => typeof value === 'number' ? Number.isFinite(value)
  : typeof value === 'string' ? value.isWellFormed()
  : Array.isArray(value) ? value.every(wellFormed)
  : value !== null && typeof value === 'object' ? Object.entries(value).every(([k, v]) => k.isWellFormed() && wellFormed(v)) : true;

// A snapshot is valid when it passes its schemas and every snapshot check; an invalid one is rejected before
// assembly, with no payload and no trace (R-17; conformance/README.md, Snapshot checks).
export function checkSnapshot(snapshot) {
  if (!validateSnapshotSchema(snapshot)) return { valid: false, findings: schemaErrors(validateSnapshotSchema, 17) };
  const findings = [];
  if (!wellFormed(snapshot)) findings.push(failure('not_i_json', 'Every string must be well-formed Unicode and every number within the IEEE 754 double range.', 17));
  const producers = snapshot.batches.map(batch => batch.producer.id);
  for (const id of new Set(producers.filter((id, i) => producers.indexOf(id) !== i))) {
    findings.push(failure('duplicate_producer', `Producer ${id} heads more than one batch.`, 15));
  }
  const itemIds = snapshot.batches.flatMap(batch => [...batch.items.map(item => item?.id), ...batch.excluded.map(row => row.item_id)]);
  findings.push(...checkConflictGroups(snapshot.conflicts, { itemIds, facts: snapshot.route_policy.facts ?? {} }).findings);
  for (const batch of snapshot.batches) {
    const candidates = new Set(batch.items.map(item => item?.id));
    for (const row of batch.excluded) for (const [field, rule] of [['duplicate_of', 13], ['superseded_by', 9]]) {
      if (row[field] !== undefined && !candidates.has(row[field])) {
        findings.push(failure(`unknown_${field}`, `${row.item_id} names ${row[field]} as kept, which is not a candidate in ${batch.producer.id}'s batch.`, rule));
      }
    }
  }
  const { profile, route_policy: policy } = snapshot;
  if (profile.route !== policy.route) findings.push(failure('profile_route_mismatch', `The profile is for route ${profile.route}, the route policy for ${policy.route}.`, 20));
  if (profile.route_policy_version !== policy.version) {
    findings.push(failure('profile_route_policy_mismatch', `The profile expects route policy ${profile.route_policy_version}, the snapshot has ${policy.version}.`, 20));
  }
  findings.push(...checkProfile(profile, { parser: policy.parser === true }).findings);
  for (const problem of REALIZE[snapshot.renderer]?.(profile.placement) ?? []) {
    findings.push(failure('unrealizable_profile', `${snapshot.renderer} cannot realize this profile: ${problem}.`, 7));
  }
  return { valid: findings.length === 0, findings };
}
