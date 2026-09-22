# CWA v2 draft — numbered requirements

Generated from `contract/requirements.json`. The [Spec page](./spec.html) provides the normative definitions and context. Published schemas in `schema/` define JSON field shapes.

## R-1: One slot and one authority role per item

Every item MUST name exactly one slot and one authority value from the closed set in section 3.1. Governing slots MUST carry governing; state slots state; knowledge reference_only; tool results observation; memory generated; history and query user. Non-governance slots other than knowledge MAY carry untrusted to reduce handling privileges. These values classify instruction authority or data provenance; they MUST NOT form a global factual ranking.

## R-2: Required fields and canonical JSON shape

Every item MUST carry id, slot, source, source_version, authority, freshness, trust and body and MUST satisfy the published context_item.schema.json. freshness is an RFC 3339 date-time recording when the fact was observed or true; it is not an expiration time. expires is a separate deadline, exclusive at assembly_time. as_of is explanatory terminology, not a JSON alias. Adapters MUST normalize legacy names before validation and MUST reject conflicting aliases. Invalid structure MUST be refused and recorded.

## R-3: Declared policy defaults, filled and traced

An item SHOULD carry token_budget, variants, conflict_policy, lineage, eligibility and injection_risk. When omitted, the assembler MUST apply the defaults published in contract/slot-defaults.json, with any route overrides versioned and recorded, and MUST trace every filled field. variants defaults to an empty list; token_budget null means the route allocation, never unlimited capacity. eligibility is descriptive text, not executable code; the route MUST own the executable eligibility predicate. conflict_policy applies only to eligible instruction peers and is ignored for factual precedence.

## R-4: Slots that are never omitted

governance.instructions and interaction.query MUST NOT be omitted from any assembly. governance.output_contract MUST NOT be omitted when a downstream parser consumes the response.

## R-5: Rule zero: enforce outside the model

An assembler MUST NOT rely on context to enforce an invariant. Governance items MAY state a rule; the application MUST enforce it outside the model.

## R-6: Separate instruction authority from factual precedence

An assembler MUST classify supplied conflict groups as instruction or fact before resolution. For instructions, platform message roles and application controls govern first; governing instructions outrank user requests. Items from state, evidence, memory and untrusted content MUST NOT issue behavioral instructions. For facts, an assembler MUST use explicit, versioned route policy over the same fact and scope, MUST NOT use instruction-authority tiers as a truth ranking, and MUST escalate if policy cannot establish precedence.

## R-7: No slot overrides platform roles; no authority from wording

An assembler MUST NOT let any slot override platform message roles or application controls. An item MUST NOT gain authority from imperative wording in its body.

## R-8: State is application-written and current

state.* items MUST be written by the application and MUST be current at assembly time. An assembler MUST NOT write state from model output.

## R-9: Memory lifetime and rejection reporting

interaction.memory items MUST carry expires and a source identifying the source turn. Entries expired at assembly_time or carrying revoked_by MUST be excluded. Producers MUST report suppressed entries as excluded records containing item_id, reason and stage: producer; the assembler MUST merge those records into its trace. Expiration MUST use the explicit assembly_time snapshot, not an ambient clock.

## R-10: Untrusted content is marked, rendered as material, kept out of governance

User-controlled quoted material, attachments, retrieved passages, memory and unverified tool output MUST be marked injection_risk: untrusted_content and rendered as reference material. The live user request retains user-level instruction authority under platform roles; the marker does not elevate its embedded material. An assembler MUST refuse untrusted content in any governance slot. Only an authenticated route policy may grant the verified-MCP exception in R-15.

## R-11: Explicit conflict groups and traceable resolution

The application MUST supply conflict groups with kind: instruction or fact and the item IDs involved; assembly MUST NOT infer semantic contradictions by calling a model. Instruction conflicts follow platform roles, governing over user, then conflict_policy for permitted peers; unresolved conflicts escalate. Factual conflicts use route policy specifying eligible sources, fact identity, scope and any freshness tie-break; freshness alone MUST NOT make an unrelated or unverified claim win. Each trace conflict MUST record kind, items, resolution and decided_by: tier, policy, freshness or escalated. tier MUST NOT decide a factual conflict. A group lacking a unique supported resolution MUST be surfaced, routed for more context or refused, never silently discarded.

## R-12: Never answer from nothing

When admission yields no valid evidence for a route that requires it, an assembler MUST NOT render a payload as though evidence were present. It MUST emit a refusal with reason evidence_required and record recovery.action as retrieve_narrower, precompute_summary or request_context. Retrieval or model-based summarization MUST occur outside assembly; any retry MUST create a new immutable snapshot.

## R-13: Retrievers emit scored packets, not blobs

A retrieval producer MUST NOT emit a merged blob. Each candidate MUST be a separate item carrying authority: reference_only and its rerank score.

## R-14: Memory producers suppress and report expired or revoked items

A memory producer MUST emit only generated or untrusted memory items. It MUST NOT emit expired or revoked entries as candidate items. It MUST report them in its producer-batch excluded list with reason expired or revoked and stage: producer, so R-9 can be satisfied without re-emitting their bodies.

## R-15: Authenticated capability admission; MCP output is evidence

MCP results and resources MUST be marked injection_risk: untrusted_content unless the route policy verifies that server. They MUST enter evidence slots, never governance. Adapters MAY propose tool specifications to the route capability policy. Only that authenticated application policy may emit governance.capabilities with authority: governing, trust: verified and injection_risk: none, after checking the versioned allow-list for the route and user. The application MUST bind producer identity outside item-controlled fields; a source prefix or self-declared trust MUST NOT prove authorization. Unauthorized capabilities MUST be excluded with reason capability_not_allowed. Tool guards MUST still enforce invocation permissions.

## R-16: Account for rendered tokens; drop before compressing

budget.input MUST be the maximum rendered input tokens after reserving budget.reserved_output from the model context limit. The assembler MUST count profile wrappers, separators, tool schemas and repeated slots with the declared tokenizer. It MUST drop droppable items before compressing compressible items and MUST NOT compress, truncate or omit protected items. The slot defaults define minimum protection; item metadata or profiles MUST NOT downgrade protected slots. Repeated occurrences count and are traced separately.

## R-17: Refused assembly has no rendered payload

When required protected content cannot fit, the assembler MUST refuse rendering rather than silently truncate. A refused result MUST have no payload; its trace MUST set refused.bool: true, a non-empty reason, result: null, and included: []. Candidate decisions and exclusions MAY remain in the trace. A successful trace MUST set refused.bool: false and refused.reason: null.

## R-18: Precomputed variants; no model calls during assembly

Producers MUST compute rerank scores and any compression variants before assembly and SHOULD cache them by content hash. Each variant MUST have its own id, body, method and lineage, inherit its parent provenance, scope and authority, and MUST NOT introduce a new instruction or unsupported fact. Assembly MUST select only supplied variants and MUST NOT call a model. The trace MUST identify the parent item and selected variant.

## R-19: Draft profiles versus evaluated profiles

A profile MUST carry id, version, route, model_family, ordered placement with wrapper rules, route_policy_version and an evaluation object. Draft profiles MAY use model_family: null and evaluation.status: unevaluated. Promotion for a deployment MUST require a concrete model family/version and evaluation.status: evaluated with a suite/version, date, result and reproducible artifact location. Descriptive benchmark numbers without artifacts MUST NOT count as validation.

## R-20: Profile version and mandatory-slot validation

Every trace MUST record profile id and version. Any change to placement, repetition, wrapper rules, model target or referenced route policy MUST increment the profile version. A profile MUST include instructions and query, MUST include output_contract for parser routes, and MUST NOT omit any admitted protected content. Evaluation status changes alone MAY retain the version when the evaluated payload configuration is identical.

## R-21: Trace JSON matches the published schema

A conformant assembler MUST emit trace JSON satisfying schema/trace.schema.json: trace_id; profile {id, version}; budget {input, reserved_output}; context {assembly_time, route_policy_version, tokenizer, renderer}; result {input_tokens, hash} or null on refusal; included[] {slot, item_id, tokens}; compressed[] {slot, item_id, from, to, method, variant_id}; excluded[] {item_id, reason, stage}; conflicts[] {kind, items, resolution, decided_by}; refused {bool, reason}. included records represent rendered occurrences. result.input_tokens includes rendering overhead; hash is lowercase SHA-256 of the exact rendered UTF-8 payload. Schema validation alone MUST NOT be described as implementation conformance.

## R-22: Recommended trace fields

A trace SHOULD include source_version and eligibility for each included occurrence, and non-negative admission-stage timings. Whenever defaults are filled under R-3, defaults_filled MUST identify each affected item and field; an empty list MAY be emitted when no defaults were applied.

## R-23: Determinism includes the clock and policy snapshot

Given identical items, variants, producer exclusions, conflict groups, authenticated producer context, scope, route-policy version and configuration, profile, tokenizer, renderer, assembly_time and budget, an assembler MUST produce identical rendered UTF-8 payload bytes and the same SHA-256 result hash, or the same refusal decision. Any mutable external reads or model calls MUST occur before that immutable assembly snapshot. Trace IDs and measured timing fields MAY differ; they are not part of the payload hash.
