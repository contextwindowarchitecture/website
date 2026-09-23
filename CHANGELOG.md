# Changelog

Generated from the Conventional Commit history by [git-cliff](https://git-cliff.org). Do not edit by hand. The specification's own revision history, written for readers, is the Changelog on [spec.html](spec.html#changelog).

## [Unreleased]

### Features

- Implement cwa as compiler (4daa681)
- Apply 2026-09-20 spec changes to the site (fdc0243)
- Add "Who it's for" audience cards to the landing hero (22e7b1a)
- **contract:** [**breaking**] Define canonical draft schemas, contracts, and fixtures (069ee47)
- **site:** Generate site validators and content from canonical contracts (64ab7ce)
- **contract:** [**breaking**] Amend budget shedding, conflict groups, and trace reasons (dce948e)
- **site:** Snapshot API, identity-bound sketch, and scoped conformance matrix (21c64d5)
- **contract:** Prior model turns in history are untrusted transcript (79320b0)
- **contract:** Only route policy can raise a slot's tier (9ee54ff)
- **contract:** Snapshot schema and first conformance case (9c020aa)
- **contract:** [**breaking**] Add route policy schema; snapshots carry raw items (243f49a)
- **contract:** Make reason order the admission precedence (464f934)
- **site:** Drive the conformance matrix from the assembler's claims (9b5d23f)
- **contract:** Route policy declares required slots, evidence and fitting (c0f5890)
- **conformance:** Assembler exclusion rows carry their slot (574fc6d)
- **site:** Import the assembler's M2 claims into the matrix (1eb8725)
- **contract:** Enforce per-item token_budget caps before shedding (d80342d)
- **contract:** [**breaking**] Define conflict resolution and route fact policy (89660ed)
- **site:** Import the assembler's M3 conflict claims into the matrix (c7eed69)
- **contract:** Define placement checks and their reason codes (16a5cca)
- **contract:** Define the cwa-messages/v1 render IR (35b827e)
- **site:** [**breaking**] Revise two example profiles so a message request can realize them (1a6ede5)
- **contract:** Define the profile registry and its lock (dcb2319)
- **site:** Import the assembler's M4 claims into the matrix (4f5d8a5)
- **contract:** Define the snapshot digest every implementation computes (52c9c5d)
- **contract:** Trace each included item's eligibility (ce40ef5)
- **contract:** Define the conformance report (c9027ec)
- **site:** Import the assembler's M5 claims and conformance report (d70e14b)
- **contract:** Cap a slot's share of the payload with max_tokens (e01eb52)
- **contract:** Add R-24, route-requested exact deduplication (a664ddb)
- **contract:** Add R-25, route-requested supersession of stale observations (a752d91)
- **contract:** Add R-26, route-requested source diversity (ab46b9b)
- **contract:** Hold a slot at the route's min_tokens floor (3856762)
- **contract:** Have retrievers report the near-duplicates they drop (09ea2f4)
- **contract:** [**breaking**] Start example profiles and route policies at version 1 (b91c156)
- **contract:** [**breaking**] Name the specification in every profile and trace (6ff8657)
- **contract:** Let a budget reserve a margin for an estimating tokenizer (77ba261)
- **contract:** Define estimate-utf8/v1, a portable estimating tokenizer (4b13043)
- **contract:** Reject invalid snapshots before assembly, without a trace (03e56b8)
- **conformance:** Report rejection cases beside the assembly cases (fd24188)

### Bug fixes

- **contract:** Judge trace tiers with the route's tier upgrades (8fdcf8a)
- **conformance:** Keep the conflicts generator from writing bytecode (72cfce5)
- **site:** Show the assembler's current milestone (b9461dc)
- **contract:** Define blank strings by the ECMAScript whitespace set (4f465ca)
- **contract:** Pin timestamps to a portable RFC 3339 profile (b8fd56a)
- **contract:** Accept R-24 in conformance report rules (d2e8bd6)
- **spec:** Stop the spec page naming R-23 as the last requirement (33d9a89)
- **conformance:** Report a rejection case that is not rejected as failed (ffcc379)

### Refactoring

- **conformance:** Drop an unused constant from the conflicts generator (1986791)

### Documentation

- **landing:** Rewrite fragmentary copy as full sentences (f8afd79)
- **spec:** Rewrite fragmentary non-normative copy as full sentences (da06ad6)
- **producers:** Rewrite fragmentary copy as full sentences (e1ac8e3)
- **evidence:** Rewrite fragmentary copy as full sentences (9590eb4)
- Add contract decisions, README, and technical brief (5de5c6f)
- **contract:** Specify admission edge cases the reference found (7239c57)
- **contract:** Size a body by its largest rendering when placements differ (3227b9a)
- **contract:** Order strings by UTF-16 code units (3b9bb51)
- **site:** Record the deferred call key and cluster mode in future work (d141663)
- **site:** Label the specification a draft without a version number (19e2740)

### Tests

- **conformance:** Add admission-reasons case (a211b2f)
- **conformance:** Add budget fitting and refusal cases (9e40504)
- **conformance:** Add budget-route-tiers case (d84bbd8)
- **conformance:** Add token_budget cap cases (adae6e1)
- **conformance:** Add conflict resolution cases (271f4c3)
- **conformance:** Add placement cases (b303ca4)
- **conformance:** Add cwa-messages/v1 cases (c131acc)
- **conformance:** Pin the example profiles in a registry lock (ac55a4a)
- **conformance:** Add the ordering-astral-ids case (78a9d10)
- **conformance:** Add max_tokens slot-cap cases (0526686)
- **conformance:** Add R-24 deduplication cases (ff333f1)
- **conformance:** Add R-25 supersession cases (13d4ff9)
- **conformance:** Add R-26 source diversity cases (6ba14c0)
- **conformance:** Add min_tokens slot-floor cases (a8530ee)
- **conformance:** Add a producer-reported near-duplicate case (bc54ba0)
- **conformance:** Add margin and estimate-utf8 fitting cases (a3ad837)
- **conformance:** Add fourteen rejection cases, one per snapshot check (a50f31f)

### Continuous integration

- Run the contract and site tests on Node 22 and 24 (4694df8)

### Chores

- Initialize repo (d01076c)
- Add guided tour (93f20b4)
- Add CNAME (8de856e)
- Update erroneous text (b9d9f1b)
- Update website to v11 (d830fec)
- Update website to v12 (cfb4907)
- **site:** Pin the assembler's status to 15089ef (97acb70)
- **site:** Pin the assembler's status to 692eb4c (f480e79)
- **site:** Re-import the assembler's status at 4577d79 (ad9a975)
- **site:** Re-import the assembler's status at 136133c (025d08c)
- **site:** Re-import the assembler's status at 7817552 (f30b7b3)
- **site:** Re-import the assembler's status at d412843 (40bbc60)
- **site:** Re-import the assembler's status at 1bc277d (2942793)
- **site:** Re-import the assembler's status at 639ddc0 (727dc86)
- **site:** Re-import the assembler's status at f87b6fe (f9f45cc)
- **site:** Re-import the assembler's status at 7748c23 (f6fc396)
- **site:** Re-import the assembler's status at f53c119 (4cbb723)
- Ignore .claude/ and .idea/ (a1c32c0)
- **site:** Re-import the assembler's status at a935265 (d06cea4)
- **site:** Re-import the assembler's status at cd76680 (0002ab4)
- **site:** Re-import the assembler's status at 0c1d644 (fde8e30)
- **site:** Re-import the assembler's status at fbe1def (5fbe420)
- **site:** Count rejection cases in the status import's summary (7b34ce6)
- License the spec and site under Apache-2.0 (58d4e5e)

