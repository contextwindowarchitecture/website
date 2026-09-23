import { ITEM_SCHEMA, SLOT_DEFAULTS } from './generated/contract-data.js';
import { validateItemSchema, validateTraceSchema, validateProfileSchema, validateProducerBatchSchema, validateConflictGroupSchema } from './generated/schema-validators.js';

export { SLOT_DEFAULTS, REASONS, ITEM_EXAMPLE, TRACE_EXAMPLE } from './generated/contract-data.js';

const policyFields = ['token_budget', 'variants', 'conflict_policy', 'lineage', 'eligibility', 'injection_risk'];
const TIER_RANK = { droppable: 0, compressible: 1, protected: 2 };
// A slot's default tier, raised by trusted route policy (tierUpgrades); never lowered (R-16).
const effectiveTier = (slot, tierUpgrades) => [SLOT_DEFAULTS[slot].tier, tierUpgrades?.[slot]]
  .filter(tier => tier in TIER_RANK).reduce((a, b) => TIER_RANK[b] > TIER_RANK[a] ? b : a);
const failure = (reason, text, rule) => ({ reason, text, rule, level: 'error' });
const schemaErrors = (validator, rule) => (validator.errors || []).map(error =>
  failure('invalid_structure', `${error.instancePath || '/'} ${error.message}`, rule));

// Item schema errors map to the specific codes in contract/reasons.json.
function itemSchemaErrors() {
  const errors = (validateItemSchema.errors || []).filter(error => error.keyword !== 'if');
  return errors.map(error => {
    const text = `${error.instancePath || '/'} ${error.message}`;
    if (error.keyword === 'required') return failure(`missing_field:${error.params.missingProperty}`, text, 2);
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

function checkAuthority(item) {
  const expected = SLOT_DEFAULTS[item.slot].authority;
  const governing = item.slot.startsWith('governance.');
  if (item.authority !== expected && (governing || item.authority !== 'untrusted')) {
    return [failure('authority_not_allowed', `This slot requires ${expected}${governing ? '' : ' or untrusted'}.`, 1)];
  }
  if (item.slot === 'interaction.history' && item.lineage === 'generated' && item.authority !== 'untrusted') {
    return [failure('authority_not_allowed', 'Prior model turns in history carry untrusted authority.', 1)];
  }
  if (governing && (item.injection_risk !== 'none' || item.trust !== 'verified')) {
    return [failure('untrusted_in_governance', 'Governance requires verified, trusted content.', 10)];
  }
  return [];
}

function checkLifetime(item, assemblyTime) {
  if (!assemblyTime || Number.isNaN(compareInstants(assemblyTime, assemblyTime))) {
    return [failure('assembly_time_required', 'Supply the assembly snapshot time explicitly.', 23)];
  }
  if (item.revoked_by) return [failure('revoked', `Revoked by ${item.revoked_by}.`, 9)];
  if (item.expires && compareInstants(item.expires, assemblyTime) <= 0) {
    return [failure('expired', `Expired at ${item.expires}.`, 9)];
  }
  if (compareInstants(item.freshness, assemblyTime) > 0) {
    return [failure('future_freshness', 'Freshness is later than the assembly snapshot.', 2)];
  }
  return [];
}

function checkProducer(item, context) {
  // Identity must come from trusted application context, never from item.source.
  if (!context.producer) return [];
  const producer = context.producer;
  if (!producer.authenticated) return [failure('producer_not_authenticated', 'Authenticate the producer outside the item.', 5)];
  if (!producer.slots?.includes(item.slot)) return [failure('producer_slot_not_allowed', 'This producer cannot emit this slot.', 7)];
  if (item.slot === 'governance.capabilities' &&
      (producer.id !== context.capabilityPolicyId || !context.allowedCapabilityIds?.includes(item.id))) {
    return [failure('capability_not_allowed', 'The authenticated capability policy must admit this tool for this route and user.', 15)];
  }
  return [];
}

export function checkItem(candidate, context = {}) {
  if (!validateItemSchema(candidate)) return { valid: false, findings: itemSchemaErrors(), filled: [], item: null };
  const { item, filled } = fillDefaults(candidate);
  const findings = [...checkAuthority(item), ...checkLifetime(item, context.assemblyTime), ...checkProducer(item, context)];
  const verifiedMcp = context.producer?.authenticated && context.producer.kind === 'mcp' && context.verifiedServer === true;
  if (SLOT_DEFAULTS[item.slot].injection_risk === 'untrusted_content' && item.injection_risk !== 'untrusted_content' && !verifiedMcp) {
    findings.push(failure('untrusted_content_unmarked', 'User-controlled and retrieved content must remain marked as untrusted content.', 10));
  }
  if (item.slot === 'evidence.knowledge' && item.authority !== 'reference_only') {
    findings.push(failure('authority_not_allowed', 'Retrieval packets carry reference_only authority.', 13));
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

function checkRenderedBudget(trace, tierUpgrades) {
  const findings = [];
  if (!trace.refused.bool) {
    for (const slot of ['governance.instructions', 'interaction.query']) {
      if (!trace.included.some(item => item.slot === slot)) findings.push(failure('missing_required_slot', `Missing ${slot}.`, 4));
    }
    const includedTokens = trace.included.reduce((sum, item) => sum + item.tokens, 0);
    if (trace.result.input_tokens < includedTokens || trace.result.input_tokens > trace.budget.input) {
      findings.push(failure('invalid_token_accounting', 'Rendered input must include all item tokens and fit the input ceiling.', 16));
    }
  } else if (trace.included.length) findings.push(failure('refused_payload_included', 'A refused assembly has no rendered included items.', 17));
  for (const item of trace.excluded) {
    if (item.reason === 'over_budget' && item.slot && effectiveTier(item.slot, tierUpgrades) === 'protected') {
      findings.push(failure('protected_omitted', `A protected ${item.slot} item cannot be omitted for budget.`, 16));
    }
    if (['conflict_deferred', 'conflict_lost'].includes(item.reason) && item.slot && effectiveTier(item.slot, tierUpgrades) === 'protected') {
      findings.push(failure('protected_conflict_excluded', `Conflict resolution cannot exclude a protected ${item.slot} item; its group escalates.`, 11));
    }
  }
  return findings;
}

// context.tierUpgrades is the route policy's tier_upgrades; without it, slots keep their default tiers.
export function checkTrace(trace, context = {}) {
  if (!validateTraceSchema(trace)) return { valid: false, findings: schemaErrors(validateTraceSchema, 21) };
  const findings = checkRenderedBudget(trace, context.tierUpgrades);
  for (const item of trace.compressed) {
    if (item.to >= item.from || effectiveTier(item.slot, context.tierUpgrades) !== 'compressible') {
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

export const CONTRACT_SCOPE = 'Local checks only. The application must authenticate provenance, enforce scope and eligibility, authorize tools, and verify the rendered payload.';
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
  const findings = new Set(ids).size === ids.length ? [] : [failure('duplicate_item_id', 'Batch item IDs must be unique across candidates and exclusions.', 9)];
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
