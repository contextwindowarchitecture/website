# CWA draft — numbered requirements

Generated from `contract/requirements.json`. The [Spec page](./spec.html) provides the normative definitions and context. Published schemas in `schema/` define JSON field shapes.

## R-1: One slot and one authority role per item

Every item MUST name exactly one slot and one authority value from the closed set in section 3.1. Governing slots MUST carry governing; state slots state; knowledge reference_only; tool results observation; memory generated; history and query user, except that prior model turns in history, marked lineage: generated, MUST carry untrusted. Non-governance slots other than knowledge MAY carry untrusted to reduce handling privileges. These values classify instruction authority or data provenance; they MUST NOT form a global factual ranking.

## R-2: Required fields and canonical JSON shape

Every item MUST carry id, slot, source, source_version, authority, freshness, trust and body and MUST satisfy the published context_item.schema.json. freshness is an RFC 3339 date-time recording when the fact was observed or true; it is not an expiration time. expires is a separate deadline, exclusive at assembly_time. as_of is explanatory terminology, not a JSON alias. Adapters MUST normalize legacy names before validation and MUST reject conflicting aliases. An item with invalid structure MUST be excluded and recorded. An item MUST be excluded with duplicate_item_id when another candidate or producer exclusion in the snapshot uses its id. An item MUST be excluded as out_of_scope when a scope key it carries has a value other than the request's, including a key the request lacks, or when it lacks a key its slot's required_scope lists; a missing key is never a wildcard. An item whose freshness is later than assembly_time by more than the route's clock_skew_seconds MUST be excluded with future_freshness. An item without a non-blank string id MUST be recorded as {producer id}#invalid-{n}, where n counts such items from 0 in the order their batch supplied them. Assemblers and validators MUST compare timestamps as instants at their full stated precision and MUST NOT truncate fractional seconds.

## R-3: Declared policy defaults, filled and traced

An item SHOULD carry token_budget, variants, conflict_policy, lineage, eligibility and injection_risk. When omitted, the assembler MUST apply the defaults published in contract/slot-defaults.json, with any route overrides versioned and recorded, and MUST trace every filled field. variants defaults to an empty list; token_budget caps the tokens of the item's rendered body; null sets no per-item cap, and budget.input and any max_tokens the route sets for the item's slot still bound it. eligibility is descriptive text, not executable code; the route MUST own the executable eligibility predicate. The route's slot rules are part of that predicate: an item observed longer ago than its slot's max_age_seconds MUST be excluded, as stale_state in a state slot (R-8) and as not_eligible elsewhere, and an item whose source does not start with its slot's source_prefix MUST be excluded with source_invalid. conflict_policy applies only to eligible instruction peers and is ignored for factual precedence.

## R-4: Slots that are never omitted

governance.instructions and interaction.query MUST NOT be omitted from any assembly. governance.output_contract MUST NOT be omitted when a downstream parser consumes the response.

## R-5: Rule zero: enforce outside the model

An assembler MUST NOT rely on context to enforce an invariant. Governance items MAY state a rule; the application MUST enforce it outside the model.

## R-6: Separate instruction authority from factual precedence

An assembler MUST classify supplied conflict groups as instruction or fact before resolution. For instructions, platform message roles and application controls govern first; governing instructions outrank user requests. Items from state, evidence, memory and untrusted content MUST NOT issue behavioral instructions. For facts, an assembler MUST use explicit, versioned route policy over the same fact and scope, MUST NOT use instruction-authority tiers as a truth ranking, and MUST escalate if policy cannot establish precedence.

## R-7: No slot overrides platform roles; no authority from wording

An assembler MUST NOT let any slot override platform message roles or application controls. An item MUST NOT gain authority from imperative wording in its body. Prior turns in interaction.history MUST render inside the profile's history wrapper as a transcript, never as platform user or assistant messages; only interaction.query renders as the live user turn.

## R-8: State is application-written and current

state.* items MUST be written by the application and MUST be current at assembly time. An assembler MUST admit state items only from producers of kind state, whatever else a route policy lists. An assembler MUST NOT write state from model output.

## R-9: Memory lifetime and producer exclusion reporting

interaction.memory items MUST carry expires and a source identifying the source turn. Any item expired at assembly_time or carrying revoked_by MUST be excluded, memory or not. Producers MUST report suppressed entries as excluded records containing item_id, reason and stage: producer; the assembler MUST merge those records into its trace, including those from a batch whose producer the route does not admit. Expiration MUST use the explicit assembly_time snapshot, not an ambient clock.

## R-10: Untrusted content is marked, rendered as material, kept out of governance

User-controlled quoted material, attachments, retrieved chunks, memory and unverified tool output MUST be marked injection_risk: untrusted_content and rendered as reference material. The live user request retains user-level instruction authority under platform roles; the marker does not elevate its embedded material. An assembler MUST exclude untrusted content from every governance slot. Only an authenticated route policy may grant the verified-MCP exception in R-15.

## R-11: Explicit conflict groups and traceable resolution

The application MUST supply conflict groups satisfying schema/conflict_group.schema.json: a group id unique in the snapshot, kind: instruction or fact, the IDs of candidates or producer exclusions in the snapshot, each in at most one group, and, for fact groups, a fact key that the route policy defines; assembly MUST NOT infer semantic contradictions by calling a model. Instruction conflicts follow platform roles, governing over user, then conflict_policy for permitted peers: resolving authority excludes nothing, and members that cannot instruct remain as material. Among two or more peers at the highest authority present that may instruct, when exactly one governs and the rest defer, the assembler MUST exclude the deferring peers with reason conflict_deferred; any other pattern escalates. Factual conflicts use the route policy for that fact key, which lists eligible producers by authenticated identity in precedence order, the scope keys members must carry and any freshness tie-break; the other members are excluded with reason conflict_lost, and freshness alone MUST NOT make an unrelated or unverified claim win. Conflict resolution MUST NOT exclude a protected item; such a group escalates. Each trace conflict MUST record kind, items, resolution and decided_by: authority, policy, freshness, escalated or moot, and SHOULD record group_id and, when one member prevails, winner. policy means the peers' conflict_policy for instruction groups and the route's fact policy for fact groups. authority MUST NOT decide a factual conflict. moot records a group left with fewer than two admitted items and MUST NOT be used while two or more remain. A group lacking a unique supported resolution MUST be surfaced, routed for more context or refused as route policy directs, never silently discarded; a surfaced group's members are marked as conflicting in the payload.

## R-12: Never answer from nothing

When admission and fitting leave no valid evidence, or fewer evidence items than the route's versioned minimum, for a route that requires evidence, an assembler MUST NOT render a payload as though sufficient evidence were present. It MUST emit a refusal with reason evidence_required and record recovery.action as retrieve_narrower, precompute_summary or request_context. Retrieval or model-based summarization MUST occur outside assembly; any retry MUST create a new immutable snapshot.

## R-13: Retrievers emit one scored item per chunk, never a blob

A retrieval producer MUST NOT emit a merged blob. Each candidate MUST be a separate item carrying authority: reference_only and its rerank score. An assembler MUST exclude with below_threshold an item scoring below its slot's min_relevance, or carrying no score in a slot that sets one; a score equal to the threshold passes. A retrieval producer that drops a candidate as a near-duplicate of another MUST report it in its batch's excluded list with reason duplicate_content, stage producer and duplicate_of naming the candidate it kept, which MUST be a candidate in the same batch.

## R-14: Memory producers suppress and report expired or revoked items

A memory producer MUST emit only generated or untrusted memory items. It MUST NOT emit expired or revoked entries as candidate items. It MUST report them in its producer-batch excluded list with reason expired or revoked and stage: producer, so R-9 can be satisfied without re-emitting their bodies.

## R-15: Authenticated capability admission; MCP output is evidence

MCP results and resources MUST be marked injection_risk: untrusted_content unless the route policy verifies that server. They MUST enter evidence slots, never governance. Adapters MAY propose tool specifications to the route capability policy. Only that authenticated application policy may emit governance.capabilities with authority: governing, trust: verified and injection_risk: none, after checking the versioned allow-list for the route and user. The application MUST bind producer identity outside item-controlled fields, and a snapshot MUST hold at most one batch per producer; items from a producer the route does not list, or lists with another kind, MUST be excluded with producer_not_authenticated; a source prefix or self-declared trust MUST NOT prove authorization. Unauthorized capabilities MUST be excluded with reason capability_not_allowed. Tool guards MUST still enforce invocation permissions.

## R-16: Account for rendered tokens; shed in tier order

budget.input MUST be the maximum rendered input tokens after reserving budget.reserved_output from the model context limit. The assembler MUST count profile wrappers, separators, tool schemas and repeated slots with the declared tokenizer. budget.margin_percent MAY reserve a safety margin for a tokenizer that estimates: the payload then fits only when its token count times (100 + margin_percent) / 100, rounded up, is at most budget.input, and the trace's budget MUST repeat it. Token caps, slot caps and floors, and traced token counts are not scaled by the margin. Under budget pressure it MUST shed in tier order: it MUST omit droppable items before reducing any compressible item, except droppable items a slot floor holds, and it MAY then reduce compressible items by selecting supplied variants or by omitting items, in the order given by the route's versioned fitting policy with a stable tie-break. When the route declares no order, the assembler MUST select variants before omitting any compressible item. It MUST NOT compress, truncate or omit protected items. An item whose rendered body exceeds its token_budget MUST be reduced whether or not the payload fits: a compressible item to a supplied variant within the cap, and otherwise it is omitted; a droppable item is omitted; a protected item over its cap is never truncated, and the assembler MUST refuse the assembly. The route MAY cap a slot with max_tokens: the rendered bodies of the slot's included items, every occurrence counted, MUST then total at most max_tokens whether or not the payload fits. After token_budget caps and before budget pressure, the assembler MUST reduce the slot's own items in the same tier order until the slot is within its cap, and MUST refuse the assembly when the slot's protected items alone exceed it. The route MAY set a slot's min_tokens: during budget pressure the assembler MUST NOT make a reduction that leaves the slot's included tokens below it, and MUST NOT reduce that slot again once such a reduction is withheld; tier order still holds within the slot. Each omission for budget MUST be recorded in excluded with reason over_budget and stage assembler. The slot defaults set the minimum protection: in a slot that is protected by default, item metadata and profiles MUST NOT lower an item below protected, and an item that sets a lower tier there MUST be excluded with protected_tier_changed. In a slot that only the route raised to protected, an item MAY still lower its own tier. Only the route's versioned policy MAY raise a slot's tier. An item MUST NOT claim a tier above its slot's effective tier, and such an item MUST be excluded with reason tier_upgrade_not_allowed. Repeated occurrences count and are traced separately.

## R-17: Refused assembly has no rendered payload

When required protected content cannot fit, the assembler MUST refuse rendering rather than silently truncate. When the payload cannot fit without a reduction a slot's min_tokens withholds, the assembler MUST refuse with slot_floor_over_budget. A refused result MUST have no payload; its trace MUST set refused.bool: true, a non-empty reason, result: null, and included: []. Candidate decisions and exclusions MAY remain in the trace. A successful trace MUST set refused.bool: false and refused.reason: null. A snapshot that fails its published schemas or the snapshot checks listed in conformance/README.md, or holds a string that is not well-formed Unicode, MUST be rejected before assembly, with no payload and no trace, because its profile, budget or context may be missing or contradictory. Rejection reports the application's error in building the snapshot; refusals are outcomes of valid snapshots.

## R-18: Precomputed variants; no model calls during assembly

Producers MUST compute rerank scores and any compression variants before assembly and SHOULD cache them by content hash. Each variant MUST have its own id, body, method and lineage, inherit its parent provenance, scope and authority, and MUST NOT introduce a new instruction or unsupported fact. Assembly MUST select only supplied variants and MUST NOT call a model. The trace MUST identify the parent item and selected variant.

## R-19: Draft profiles versus evaluated profiles

A profile MUST carry spec, id, version, route, model_family, ordered placement with wrapper rules, route_policy_version and an evaluation object. spec names the specification the profile was written for, cwa/draft until the first release; a profile for another specification MUST be rejected. Draft profiles MAY use model_family: null and evaluation.status: unevaluated. Promotion for a deployment MUST require a concrete model family/version and evaluation.status: evaluated with a suite/version, date, result and reproducible artifact location. Descriptive benchmark numbers without artifacts MUST NOT count as validation.

## R-20: Profile version and mandatory-slot validation

Every trace MUST record profile id and version. Any change to placement, repetition, wrapper rules, model target or referenced route policy MUST increment the profile version. A profile MUST include instructions and query, MUST include output_contract for parser routes, and MUST NOT omit any admitted protected content: when an admitted protected item's slot has no placement, the assembler MUST refuse with protected_slot_unplaced, and it MUST exclude an unprotected item in an unplaced slot with slot_unplaced. A profile's route and route_policy_version MUST equal the snapshot's route policy's route and version, and the snapshot's renderer MUST be able to realize its placements. Evaluation status changes alone MAY retain the version when the evaluated payload configuration is identical.

## R-21: Trace JSON matches the published schema

A conformant assembler MUST emit trace JSON satisfying schema/trace.schema.json: trace_id; profile {id, version}; budget {input, reserved_output}; context {spec, assembly_time, route_policy_version, tokenizer, renderer}, where context.spec equals the profile's spec; result {input_tokens, hash} or null on refusal; included[] {slot, item_id, tokens}; compressed[] {slot, item_id, from, to, method, variant_id}; excluded[] {item_id, reason, stage}; conflicts[] {kind, items, resolution, decided_by}; refused {bool, reason}. included records represent rendered occurrences. result.input_tokens includes rendering overhead; hash is lowercase SHA-256 of the exact rendered UTF-8 payload. Exclusion and refusal reasons MUST use the codes published in contract/reasons.json for the conditions those codes name. When an item fails several checks, the recorded reason MUST be the earliest applicable exclusion code in that file's order; among several missing_field codes, the alphabetically first field name is recorded. When several refusal conditions hold, the recorded reason MUST be the earliest refusal code in that file's order. Where these requirements leave an ordering, tie-break, boundary or algorithm step open, conformance/README.md is normative. Schema validation alone MUST NOT be described as implementation conformance.

## R-22: Recommended trace fields

A trace SHOULD include source_version and eligibility for each included occurrence, the slot of each excluded item, context.snapshot_digest as a lowercase SHA-256 identifying the frozen assembly snapshot, and non-negative admission-stage timings. Whenever defaults are filled under R-3, defaults_filled MUST list one {item_id, field} record per affected item and field; an empty list MAY be emitted when no defaults were applied.

## R-23: Determinism includes the clock and policy snapshot

Given identical items, variants, producer exclusions, conflict groups, authenticated producer context, scope, route-policy version and configuration, profile, tokenizer, renderer, assembly_time and budget, an assembler MUST produce identical rendered UTF-8 payload bytes and the same SHA-256 result hash, or the same refusal decision. Any mutable external reads or model calls MUST occur before that immutable assembly snapshot. Trace IDs and measured timing fields MAY differ; they are not part of the payload hash.

## R-24: Route-requested exact deduplication

When a route sets dedupe: exact on a slot, the assembler MUST, after conflict resolution and before any refusal check or fitting, exclude each item in that slot whose body equals the body of an item it keeps in the slot, with reason duplicate_content, stage assembler and duplicate_of naming the kept item. Bodies MUST be compared code unit for code unit after collapsing each run of whitespace to one space and trimming both ends, without Unicode normalization or case folding. The assembler MUST NOT exclude a protected item or an item a conflict group names: a set of equal bodies that contains one keeps every such item, and otherwise keeps its highest-ranked item by the slot's fitting rank. Deduplication never compares items across slots, and a slot without dedupe keeps equal bodies.

## R-25: Route-requested supersession of stale observations

When a route sets supersede: source on a slot, the assembler MUST, after conflict resolution and before deduplication, exclude each item in that slot for which another item in the slot, from the same authenticated producer and with the same source, has a later freshness, compared as instants at full precision. It MUST record each such exclusion with reason superseded, stage assembler and superseded_by naming the highest-ranked of the latest items by the slot's fitting rank. Items tied for the latest freshness are all kept. The assembler MUST NOT exclude a protected item or an item a conflict group names. source and freshness decide alone: bodies, variants and source_version are not compared, and a slot without supersede keeps every observation.

## R-26: Route-requested source diversity

When a route sets max_per_source on a slot, the assembler MUST, after deduplication and before any refusal check or fitting, keep at most that many items in the slot from each pair of authenticated producer and source, and exclude the rest with reason source_diversity_cap and stage assembler. The assembler MUST NOT exclude a protected item or an item a conflict group names; those count toward the cap first, and the other items fill any places left in the slot's fitting rank. Each slot is capped on its own, and a slot without max_per_source is not capped.
