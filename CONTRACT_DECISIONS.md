# Executable contract decisions — 2026-09-22

This revision applies the three decisions confirmed during review: separate instruction authority from factual precedence; deliver schemas, examples, shared validators and fixtures while keeping the assembler unreleased; treat all example profiles as unevaluated.

## Instruction authority and facts

Platform roles and application controls determine who may direct behavior. Governing instructions outrank user requests; retrieved passages, observations and memory cannot turn into instructions through imperative wording.

Factual precedence is a separate, versioned route policy. For example, a verified inventory service may be authoritative for current stock, while a policy document may be authoritative for refund terms. Neither source wins every factual dispute merely because it is a tool or a document. Compare the same fact in the same scope, use freshness only where the policy permits it, and escalate unresolved conflicts.

The application supplies conflict groups with item IDs and `kind: instruction | fact`. The assembler does not discover contradictions by interpreting prose. Trace records identify the conflict kind and deciding stage; `tier` cannot decide a factual conflict.

## Resolved contract gaps

| Previous issue | Resolution |
| --- | --- |
| `reference` versus `reference_only` | Closed canonical authority vocabulary; outdated examples corrected |
| `freshness` versus `as_of` | JSON uses `freshness`; legacy adapters normalize before validation and reject conflicting aliases |
| Observation time confused with expiry | `freshness` records observation time; `expires <= assembly_time` expires the item |
| Missing body, rerank score and variant definitions | Complete schema-valid item example; typed `relevance`, `variants`, policy fields and structured scope |
| Default values outside schema enums | Shared defaults and generated schema validation |
| Producer silently suppresses expired memory | Producer-batch `excluded` records survive into the assembly trace without the memory body |
| Self-declared capability source treated as permission | Trusted application context binds producer identity and tool allow-list membership |
| Ambient clock breaks replay | Explicit immutable `assembly_time`, policy, tokenizer and renderer snapshot |
| Budget interpretation and repeated-slot accounting unclear | `budget.input` is net of output reservation; count wrappers, tool schemas and every rendered occurrence |
| Refusal still appeared to require a payload/hash | No payload, `result: null`, `included: []`, and a non-empty refusal reason |
| Unverified placement scores | Removed; all v2 examples are unevaluated with null evaluation fields |
| Profile can omit protected content | Local profile checks reject omission of required or admitted protected slots |
| Presence-only trace validator claims conformance | Published trace schema plus local semantic checks, with explicit limits |
| Duplicate scaffold definitions | Start-page downloads and the landing-page item preview use canonical source data |
| Migrator truncates exported content | Full bodies are preserved; malformed message entries remain unassigned |
| Missing specification mirror | Generated `SPEC.md` requirement reference with permanent IDs; Spec-page context remains normative |

## Budget and trace amendments — 2026-09-22

These follow the reference-assembler design review (`cwa-assembler/docs/DESIGN.md`, findings DA-3, DA-9, DA-10, DA-13, DA-14, DA-18, DA-24).

| Issue | Resolution |
| --- | --- |
| R-16 left undefined what happens when compressed content still does not fit | Compressible items may be reduced by variant or omitted after droppable items are gone, in the route's versioned fitting-policy order; variants first when none is declared; omissions traced as `over_budget` |
| Omission could quietly keep too little evidence | R-12 refuses with `evidence_required` below the route's versioned evidence minimum |
| Fact conflict groups had no key into route policy | `schema/conflict_group.schema.json`: `id`, `kind`, `items`, and `fact` for fact groups |
| `decided_by: tier` collided with the budget `tier` field; no value for moot groups | Renamed to `authority`; added `moot` for groups left with fewer than two admitted items |
| Reason codes differed between the Producers page and `contract.js` | `contract/reasons.json` is canonical; the Producers table is generated; item schema failures report `missing_field:<name>`, `unknown_slot`, `unknown_authority` |
| `defaults_filled` strings were ambiguous for IDs containing `#` or `:` | `{item_id, field}` records |
| Millisecond truncation made JavaScript and Python disagree on expiry | Timestamps compare at full stated precision; `compareInstants()` in `contract.js` |
| A trace could not point to its replay input; validators could not see an omitted item's slot | Optional `context.snapshot_digest`, `excluded[].slot`, `conflicts[].group_id` |
| A producer could mark its own items protected, forcing refusals or displacing other content (DA-12) | R-16: only the route's versioned policy raises a tier; an item claiming a higher tier is excluded with `tier_upgrade_not_allowed`; lowering a non-protected tier stays allowed |
| Prior assistant turns in history carried user authority and could render as native assistant messages (DA-22) | R-1: model turns, marked `lineage: generated`, carry `untrusted`; R-7: prior turns render inside the history transcript, never as platform messages. The Start-page migrator follows this |

Breaking for stored traces: `decided_by: "tier"` and string `defaults_filled` entries no longer validate. Migrate `tier` to `authority` and split strings into `{item_id, field}` records.

## Fitting and refusal — 2026-09-22

These follow the reference assembler's M2 kickoff (`cwa-assembler/docs/DESIGN.md` §8).

| Issue | Resolution |
| --- | --- |
| R-4 did not say how an assembler knows a downstream parser exists | Route policy `parser: true` makes `governance.output_contract` required |
| R-12's "route that requires evidence" and "versioned minimum" had no fields | Route policy `requires_evidence`, and `slots.<evidence slot>.min_included`, which the schema accepts only on a route that requires evidence |
| R-16's "route's versioned fitting policy" had no fields | Per-slot `priority` and `order_by`, and a route-level `fitting_order` of compress and omit steps. Without steps, variants come before omission |
| Two implementations could shed differently and both claim R-16 | `conformance/README.md` fixes one procedure: one item at a time, whole-payload recount, longest variant that fits or else the shortest |
| R-12 named three recovery actions without saying when each applies | `request_context` when budget omitted no evidence, `precompute_summary` when omitted evidence had no variants, `retrieve_narrower` otherwise |
| Several refusals could apply at once | R-21: the earliest refusal code in `contract/reasons.json` order, which is now the order assembly checks them. `conflict_unresolved` moved ahead of the budget refusals |
| `token_budget` was called a cap, but nothing said what happens to an item over it, and "null means the route allocation" named a field that does not exist | Caps are enforced before shedding, whether or not the payload fits: a compressible item takes its longest variant within the cap or is omitted, a droppable item is omitted, and a protected item over its cap refuses with `protected_content_over_budget` (R-16). R-3 now says null sets no per-item cap and `budget.input` still bounds the item; per-slot allocations are deferred |
| An invalid snapshot had no refusal code | None needed: a snapshot that fails its schema is rejected before assembly and has no trace |

## Conflict resolution — 2026-09-22

These follow the reference assembler's M3 kickoff (`cwa-assembler/docs/DESIGN.md` §8). `conformance/README.md`'s Conflicts section holds the procedure.

| Issue | Resolution |
| --- | --- |
| R-11 said how instruction groups are decided but not what that does to the payload; the user query is protected and cannot be excluded | Authority excludes nothing. Among two or more peers at the top instructing authority, one `governs` and the rest `defers` excludes the deferring peers with `conflict_deferred`; any other pattern escalates |
| R-11's fact policy ("eligible sources, scope and any freshness tie-break") had no fields | Route policy `facts.<key>`: `precedence` (authenticated producer ids, never `item.source`), `scope`, `freshness_tiebreak`, `on_unresolved`. Losers are excluded with `conflict_lost` |
| Nothing stopped a conflict from excluding protected content | No conflict excludes a protected item; such a group escalates. Required slots therefore survive conflict resolution |
| "Surfaced, routed for more context or refused" had no switch | `on_unresolved` per fact and `on_unresolved_instruction` per route (default `refuse`). `request_context` and `refuse` refuse with `conflict_unresolved`; `surface` keeps every member and marks it in the payload (`fixture-xml/v1` adds `conflict="<group id>"`) |
| `conflicts[].resolution` was free text, so conformance could not compare it | A closed vocabulary tied to `decided_by`, plus an optional `winner` |
| Groups could name unknown items, share items, or name undefined facts, and the outcome would depend on processing order | Each is rejected with the snapshot, before assembly. Members excluded at admission make a group `moot` |

The resolution vocabulary is breaking for stored traces: free-text `resolution` values no longer validate.

## Review and migration implications

This is a breaking **draft** revision. Existing traces need `context`, conflict `kind`, exclusion `stage`, and compression `item_id`/`variant_id`. Refused traces use the new null result shape. Item JSON no longer accepts `as_of`, loose scope strings, undefined authority aliases, or undeclared fields. Consumers should validate and migrate explicitly rather than silently coercing old data.

Example profiles move to v2 and carry `route_policy_version` plus explicit evaluation status. Adopting a profile still requires defining executable route policy, authenticated producer bindings, model token accounting, and actual rendering. The Python download is clearly labeled an integration sketch with application-owned helpers.

## Evidence and remaining implementation work

Run `npm test` for generated-artifact checks and contract fixtures. The browser tools use the same generated schema validators as the tests. The payload fixture's SHA-256 and fixture token count are checked against the published trace.

The remaining work is the separately scoped reference assembler and its end-to-end conformance suite, followed by reproducible route/model evaluations. No assembler release, factual-accuracy claim, or model-performance claim is made by this revision.

## Verification record

The automated suite covers 56 contract and website checks, including malformed data, expiry boundaries, source-name spoofing, refusal/recovery records, canonical downloads, and generated artifacts. Browser checks exercised malformed input rejection and rendered the revised specification and profile explorer. Ripwire reports unchanged SCAFFOLDS export shape and new validator APIs; its quality gate flags historical scaffold churn and additional metrics in generated validator/schema data. These are retained deliberately: scaffold duplication was removed, and generated code is regenerated and tested rather than hand-refactored.
