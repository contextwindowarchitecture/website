# CWA website and executable contracts

Static website for the CWA draft. Serve this directory over HTTP; no application server or browser-side package installation is required. The reference assembler remains unreleased.

## Development

Use Node.js 22 or newer and the locked development dependencies:

```sh
npm ci
npm run build:contract
npm test
```

`npm test` fails if generated artifacts are stale, then runs the contract fixtures and embedded website-component checks. CI (`.github/workflows/ci.yml`) runs `npm ci` and `npm test` on Node 22 and 24. `CHANGELOG.md` is generated from the commit history with git-cliff (`cliff.toml`): regenerate it at a release with `uvx git-cliff --tag vX.Y.Z -o CHANGELOG.md` and never edit it by hand. The spec's own revision history is the Changelog on the Spec page. Commit generated files with their sources so static hosting serves the tested validators.

## Sources of truth

| Source | Responsibility |
| --- | --- |
| `contract/requirements.json` | Permanent requirement IDs (R-1 through R-26; new ones append) and requirement text |
| `spec.html` | Normative definitions and explanatory context outside the generated requirements |
| `schema/*.schema.json` | Item, trace, placement-profile, producer-batch, conflict-group, route-policy and snapshot JSON structures |
| `conformance/cases/` | Language-neutral assembler test cases: snapshot in, expected trace and payload out (see `conformance/README.md`) |
| `contract/reasons.json` | Canonical exclusion and refusal reason codes; generates the Producers failure table |
| `contract/assembler-scope.json` | What an assembler can verify per requirement; generates the Assembler matrix scope column |
| `contract/assembler-status.json` | The reference assembler's claimed status per requirement, imported from its `status.json` with `node scripts/import-assembler-status.mjs ../cwa-assembler` |
| `contract/slot-defaults.json` | Default roles, protection tiers, and policy fields |
| `examples/` | Concrete item, producer batch, profiles, payload and matching trace |
| `contract.js` | Shared local semantic checks used by the browser tools and tests |
| `contract/*.txt`, `contract/cwa.md` | Downloadable integration guidance and rendering template |
| `contract/profile-display.json` | Profile explorer labels and descriptions; tests check placement against canonical examples |

The build generates `generated/`, `SPEC.md`, requirement arrays in the Spec and Assembler pages, slot defaults in Producers, and the profile examples in Evidence and Spec. The Start-page downloads import `scaffolds.js`; the landing-page item preview is generated from the same canonical example. Unused duplicate landing-page scaffold logic has been removed.

Ajv compiles the JSON Schemas at build time. The generated browser module has no remote dependency or runtime schema compiler. See [Ajv standalone validation](https://ajv.js.org/standalone.html) and `THIRD_PARTY_NOTICES.md`.

## What the checks establish

The suite checks field types and enums, timestamps, required fields, defaults, producer handoff shape, selected authority and admission constraints, protected-slot and budget invariants, refusal representation, and instruction-versus-fact conflict trace shape. It also checks profile exports, full migrator body preservation, generated-document synchronization, and component rendering.

`checkItem()` and `checkTrace()` returning `valid: true` means their documented **local checks** pass. It is not authorization to send a request or execute a tool. Authenticate the producer in application code; never construct trusted context by spreading an item's fields into it. The website has no authenticated route context and deliberately reports only local checks.

The concrete trace uses `examples/fixture-profile.json`, separate from the five illustrative route profiles, and its hash matches `examples/payload.txt`. Its `fixture-whitespace/v1` tokenizer counts non-whitespace runs only and is a test fixture, not a model tokenizer. Real assembly must use the target model's accounting, including wrappers and repeated content. Hash the exact rendered UTF-8 bytes; preserve the immutable snapshot separately for replay.

The suite does **not** implement or certify an assembler, detect semantic contradictions in prose, establish factual truth, authenticate remote sources, prove compression fidelity, or benchmark model outcomes. All five example profiles are unevaluated. A production conformance suite must exercise the actual implementation's admission, conflict resolution, fitting, rendering and replay behavior.

## License

Apache License 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). This covers the specification, schemas, conformance cases and site. The generated validator bundles MIT-licensed code listed in `THIRD_PARTY_NOTICES.md`.
