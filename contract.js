import { ITEM_SCHEMA, SLOT_DEFAULTS } from './generated/contract-data.js';
import { validateItemSchema, validateTraceSchema, validateProfileSchema, validateProducerBatchSchema } from './generated/schema-validators.js';

export { SLOT_DEFAULTS, ITEM_EXAMPLE, TRACE_EXAMPLE } from './generated/contract-data.js';

const policyFields = ['token_budget', 'variants', 'conflict_policy', 'lineage', 'eligibility', 'injection_risk'];
const failure = (reason, text, rule) => ({ reason, text, rule, level: 'error' });
const schemaErrors = (validator, rule) => (validator.errors || []).map(error =>
  failure('invalid_structure', `${error.instancePath || '/'} ${error.message}`, rule));

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
  if (governing && (item.injection_risk !== 'none' || item.trust !== 'verified')) {
    return [failure('untrusted_in_governance', 'Governance requires verified, trusted content.', 10)];
  }
  return [];
}

function checkLifetime(item, assemblyTime) {
  if (!assemblyTime || !Number.isFinite(Date.parse(assemblyTime))) {
    return [failure('assembly_time_required', 'Supply the assembly snapshot time explicitly.', 23)];
  }
  if (item.revoked_by) return [failure('revoked', `Revoked by ${item.revoked_by}.`, 9)];
  if (item.expires && Date.parse(item.expires) <= Date.parse(assemblyTime)) {
    return [failure('expired', `Expired at ${item.expires}.`, 9)];
  }
  if (Date.parse(item.freshness) > Date.parse(assemblyTime)) {
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
  if (!validateItemSchema(candidate)) return { valid: false, findings: schemaErrors(validateItemSchema, 2), filled: [], item: null };
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
  return { valid: findings.length === 0, findings, filled, item };
}

function checkRenderedBudget(trace) {
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
  return findings;
}

export function checkTrace(trace) {
  if (!validateTraceSchema(trace)) return { valid: false, findings: schemaErrors(validateTraceSchema, 21) };
  const findings = checkRenderedBudget(trace);
  for (const item of trace.compressed) {
    if (item.to > item.from || SLOT_DEFAULTS[item.slot].tier !== 'compressible') {
      findings.push(failure('invalid_compression', 'Compression must shorten a compressible item.', 16));
    }
  }
  for (const conflict of trace.conflicts) {
    if (conflict.kind === 'fact' && conflict.decided_by === 'tier') {
      findings.push(failure('factual_authority_inversion', 'Instruction authority cannot decide factual precedence.', 6));
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
