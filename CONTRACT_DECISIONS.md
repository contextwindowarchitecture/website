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

## Review and migration implications

This is a breaking **draft** revision. Existing traces need `context`, conflict `kind`, exclusion `stage`, and compression `item_id`/`variant_id`. Refused traces use the new null result shape. Item JSON no longer accepts `as_of`, loose scope strings, undefined authority aliases, or undeclared fields. Consumers should validate and migrate explicitly rather than silently coercing old data.

Example profiles move to v2 and carry `route_policy_version` plus explicit evaluation status. Adopting a profile still requires defining executable route policy, authenticated producer bindings, model token accounting, and actual rendering. The Python download is clearly labeled an integration sketch with application-owned helpers.

## Evidence and remaining implementation work

Run `npm test` for generated-artifact checks and contract fixtures. The browser tools use the same generated schema validators as the tests. The payload fixture's SHA-256 and fixture token count are checked against the published trace.

The remaining work is the separately scoped reference assembler and its end-to-end conformance suite, followed by reproducible route/model evaluations. No assembler release, factual-accuracy claim, or model-performance claim is made by this revision.

## Verification record

The automated suite covers 56 contract and website checks, including malformed data, expiry boundaries, source-name spoofing, refusal/recovery records, canonical downloads, and generated artifacts. Browser checks exercised malformed input rejection and rendered the revised specification and profile explorer. Ripwire reports unchanged SCAFFOLDS export shape and new validator APIs; its quality gate flags historical scaffold churn and additional metrics in generated validator/schema data. These are retained deliberately: scaffold duplication was removed, and generated code is regenerated and tested rather than hand-refactored.
