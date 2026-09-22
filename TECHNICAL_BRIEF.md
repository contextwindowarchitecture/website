# Context Window Architecture — Technical Brief

**Prepared:** 2026-09-22

**Content baseline:** working-tree contract revision of 2026-09-22, following the review of commit `9590eb4`

**Audience:** engineers, technical evaluators, and website content maintainers

**Status:** explanatory brief; the Spec page, numbered requirements and published JSON Schemas define the draft contract. See [contract decisions](./CONTRACT_DECISIONS.md) for the review outcomes.

## Purpose and positioning

Context Window Architecture (CWA) specifies how an application assembles the input to a model call. It gives instructions, application state, retrieved evidence, tool observations, conversation history, memory, and the current request explicit ownership and handling rules.

The core abstraction is a pipeline: producers supply typed items; an assembler admits, resolves, fits, and renders them; a trace records the decisions. Placement is controlled by a versioned profile for a particular route and model family.

CWA is a specification, not an installable framework or a security boundary. It aims to make request construction reproducible and inspectable. Deterministic assembly does not imply deterministic model responses, correct answers, or resistance to every prompt injection. Application guards remain responsible for enforcing permissions and invariants.

The website addresses three audiences: developers implementing assembly, organizations defining shared governance, and everyday AI users learning how context works. This brief concentrates on the implementation contract.

## Problems the content addresses

The landing page illustrates seven recurring failures: authority inversion, instruction-shaped evidence, stale information presented as current, memory that never expires, critical content displaced by history, redundant re-reading, and a missing or buried live request.

CWA makes these failures diagnosable through explicit metadata, admission rules, budget handling, and traces. The website's demonstrations explain the proposed mechanisms; they do not establish a general performance improvement across models or workloads.

## Data model

Every item belongs to exactly one of eleven slots, grouped into four planes. Plane membership describes the item's purpose; a placement profile determines where it appears in the model request.

| Plane | Question answered | Slots |
| --- | --- | --- |
| Governance | Who may direct the model? | `governance.instructions`, `governance.capabilities`, `governance.examples`, `governance.output_contract` |
| State | What is true right now? | `state.user`, `state.task` |
| Evidence | What may the model ground its response on? | `evidence.knowledge`, `evidence.tool_results` |
| Interaction | What has happened, and what is being asked? | `interaction.memory`, `interaction.history`, `interaction.query` |

Governance instructions and the current query must always be present. The output contract must also be present when a downstream parser consumes the response (R-4). Capabilities describe permitted tools; examples provide developer-owned steering and defer to instructions and the output contract.

State is current, application-owned information. Task state comes from the application's state machine, not model output. Memory contains fallible summaries or inferences, carries a source turn and TTL, and can be revoked. History is a bounded transcript; overflow is summarized into memory rather than cut mid-thought.

### Item contract

| Required field | Purpose |
| --- | --- |
| `id` | Stable item identity for payload attribution and tracing |
| `slot` | One of the eleven semantic destinations |
| `source` | Originating document, turn, tool call, database field, or policy |
| `source_version` | Version of the source used for this item |
| `authority` | One of the seven permitted authority values |
| `freshness` | When the content was true or observed; `as_of` is not a JSON alias |
| `trust` | Verification status: verified, unverified, or untrusted |
| `body` | The content supplied to assembly |

Missing required fields cause an admission refusal recorded in the trace (R-2). R-3 recommends six policy fields: `token_budget`, `variants`, `conflict_policy`, `lineage`, `eligibility`, and `injection_risk`. Omitted policy fields require declared slot defaults and a trace of which defaults were applied.

The closed authority values are `governing`, `user`, `state`, `reference_only`, `observation`, `generated`, and `untrusted`. These are not a factual ranking. Instruction authority is distinct from trust and factual precedence: a verified retrieved passage remains evidence; versioned route policy resolves competing facts.

## Assembly and producer responsibilities

The eight-stage evidence pipeline divides ownership as follows:

| Owner | Stages | Required outcome |
| --- | --- | --- |
| Producer | Rewrite → retrieve → rerank | Separate scored candidate items, with provenance and versions |
| Assembler | Deduplicate → filter → packetize → budget → attribute | Eligible evidence that fits the request and retains citation information |

Admission checks include scope, freshness, trust, authority, and route eligibility. Conflict resolution and profile rendering complete the assembly process. Model-based scoring and compression happen before assembly; the assembly step itself must not call a model (R-18).

Producer-specific contracts are:

- **Retrieval:** emit one scored item per passage with `reference_only` authority; never merge candidates into an opaque blob.
- **Memory:** emit source-linked entries at no higher than `generated` authority; suppress expired or revoked entries. Exclusions must remain observable in the overall trace.
- **State:** read canonical application data and provide current, scoped facts.
- **MCP adapters:** emit tool results and resources as evidence, marked as untrusted content unless the route verifies the server. Imperative wording does not grant authority.
- **Capability policy:** admit tool specifications against a versioned allow-list for the route and user. Only this policy emits `governance.capabilities` items with governing authority; adapters merely propose specifications.

An unauthorized capability item is excluded with `capability_not_allowed` (R-15). Tool execution still requires application enforcement even when the capability appears in context.

### Conflicts and budget pressure

The application supplies instruction or fact conflict groups. Instruction authority follows platform roles and governing/user precedence. Factual conflicts use explicit route policy for the same fact and scope; unresolved groups escalate. Every resolution records its kind and deciding stage. `tier` cannot decide factual precedence (R-6, R-11).

The producer guide supplies these default budget tiers:

| Tier | Slots | Behavior under pressure |
| --- | --- | --- |
| Protected | Instructions, capabilities, output contract, task state, query | Render whole; never compress, truncate, or omit |
| Compressible | Knowledge, tool results, memory, history | Use precomputed shorter variants |
| Droppable | Examples, user state | Omit before compressing other items |

If protected items cannot fit, refuse to render and record the reason (R-16–R-17). When a route requires evidence and none is valid, record a recovery decision such as narrower retrieval or routing for more context; do not assemble as though evidence existed (R-12). Implementations must account for the reserved output budget.

## Placement profiles and evaluation

A profile carries `id`, `version`, `route`, `model_family`, `route_policy_version`, ordered placement with wrapper rules, and explicit evaluation status (R-19). The trace records its identity and version; changing a profile requires a version change (R-20).

The site presents five profiles:

| Profile | Intended route | Placement emphasis |
| --- | --- | --- |
| `policy-first-chat/v2` | Support chat | Governing instructions early; current query last |
| `document-analysis/v2` | Document question answering | Documents early; instructions and question follow |
| `long-context-reinforced/v2` | Long-context question answering | Governing instructions repeated near the query |
| `tool-agent/v2` | Agent loops | Tool contracts early; task state and observations near the query |
| `extraction/v2` | Structured extraction | Output schema early and repeated near the query |

The Evidence page cites long-context research and provider guidance to motivate evaluating placement per workload. Those references do not validate CWA itself. All five profiles are explicitly unevaluated drafts. Unsupported dated metric summaries were removed; promotion requires a model version and a reproducible evaluation artifact.

For a meaningful comparison, hold items, model configuration, and scoring criteria constant; inspect whether the profiles also change inclusion, repetition, wrappers, or token counts. Deterministic request construction alone does not isolate placement as the cause of an outcome difference. Measure task success, groundedness, citation quality, tool correctness, latency, and cost as applicable.

## Trace and conformance

The specification defines 23 numbered requirements. A conformant implementation must satisfy every applicable mandatory clause, including mandatory behavior inside a requirement labeled SHOULD.

R-21 requires a JSON trace with:

| Field | Required contents |
| --- | --- |
| `trace_id` | Assembly trace identity |
| `profile` | `id`, `version` |
| `budget` | `input`, `reserved_output` |
| `context` | `assembly_time`, `route_policy_version`, `tokenizer`, `renderer` |
| `result` | `input_tokens`, SHA-256 `hash`; null on refusal |
| `included[]` | `slot`, `item_id`, `tokens` |
| `compressed[]` | `slot`, `item_id`, `from`, `to`, `method`, `variant_id` |
| `excluded[]` | `item_id`, `reason`, `stage` |
| `conflicts[]` | `kind`, `items`, `resolution`, `decided_by` |
| `refused` | `bool`, `reason` |

Recommended additions include source versions, eligibility rules, stage timings, and applied defaults. Identical immutable snapshots—including clock, policy, producer context, conflict groups, tokenizer, renderer and budget—must produce identical rendered UTF-8 bytes and SHA-256, or the same refusal (R-23).

The site proposes snapshot, golden-task, ablation, conflict, budget-pressure, freshness, refusal, and capability-source checks. A trace validator can check structure and reported decisions; passing it does not prove the implementation satisfies all 23 requirements.

## Website content map

| Source | Content responsibility |
| --- | --- |
| `index.html` | Positioning, failure scenarios, assembly demonstrations, guided tour, and scaffolds |
| `start.html` | Six-step adoption guide, heuristic prompt migrator, and scaffold downloads |
| `spec.html` | Normative model, governance, assembly rules, profiles, traces, and changelog |
| `evidence.html` | Placement rationale, research references, five-profile explorer, and evaluation protocol |
| `producers.html` | Producer contracts, defaults, failure reasons, item linter, and trace validator |
| `assembler.html` | Reference implementation status, conformance matrix, and provisional API |
| `about.html` | Scope, governance, contribution process, and licensing statements |
| `scaffolds.js` | Downloadable assembly sketch, payload template, YAML item example, JSON Schema, and agent-facing specification |

The checkout is a static HTML/JavaScript site. Page content and interactive logic are embedded in the HTML files; `support.js` supplies the shared client runtime. Node-based development tooling generates the shared browser validators and tests the contracts; there is no backend assembler implementation. The migrator, linter, and trace validator are presented as browser-local tools.

## Implementation status and content issues

The Assembler page reports **in progress, no release**, with Python intended first and **0 of 23 requirements implemented** in its displayed matrix. Its API is explicitly provisional. The downloadable Python file is a scaffold with unresolved application helpers, not a runnable reference assembler.

The reviewed inconsistencies are resolved in the current draft: canonical item fields and defaults, explicit producer rejection handoff, separate instruction/fact conflicts, authenticated capability context, clock snapshots, refusal traces, and profile evaluation status. Downloads and the landing-page item preview use canonical sources. The generated requirement reference and schemas have automated drift checks.

The browser tools and tests share compiled JSON Schema validators. Passing their local checks does not authenticate a producer, validate factual truth, verify an arbitrary payload hash, or certify a complete assembler. Full implementation and route/model evaluations remain separate work. See [CONTRACT_DECISIONS.md](./CONTRACT_DECISIONS.md) for migration implications and [README.md](./README.md) for verification commands.

## Adoption path

Inventory the existing request builder and assign each chunk a slot. Add provenance, authority, freshness, and policy metadata. Introduce assembly and trace emission, then verify deterministic replay, exclusions, protected-budget behavior, and capability admission. Evaluate a versioned profile on the target route. Pair each governing invariant with a named application guard.

The initial deliverable for an adopting team is a reproducible request payload and an explanatory trace backed by route-specific checks. Claims about better model outcomes require separate evaluation.

## Source scope

This brief summarizes the local website, canonical requirements, JSON Schemas, shared validators and fixtures. It does not independently verify the external research, licensing terms, remote repository mirrors, published benchmark claims, or deployment status. The 2026-09-22 revision updates the website and contract tooling following the user-confirmed decisions.
