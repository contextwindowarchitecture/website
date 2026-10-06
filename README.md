# CWA website and executable contracts

Static website for the CWA draft. Serve this directory over HTTP; no application server or browser-side package installation is required. The reference assembler remains unreleased.

## Development

Use Node.js 22 or newer and the locked development dependencies:

```sh
npm ci
npm run build:contract
npm test
```

`npm test` fails if generated artifacts are stale, then runs the contract fixtures and embedded website-component checks. CI (`.github/workflows/ci.yml`) runs `npm ci` and `npm test` on Node 22 and 24. Each tag gets a GitHub release once CI passes on the tagged commit (`.github/workflows/release.yml`), with the tag's own commits as notes, written by git-cliff; a tag that is not `vX.Y.Z` is a prerelease, and a tag pushed before the workflow existed is released with `gh workflow run release.yml -f tag=<tag>`. `CHANGELOG.md` is generated from the commit history with git-cliff (`cliff.toml`): regenerate it at a release with `uvx git-cliff --tag vX.Y.Z -o CHANGELOG.md` and never edit it by hand. The spec's own revision history is `CHANGES.md`, which the build writes into the Spec page's Changelog and draft date: add a revision's bullets there, never in `spec.html`. Commit generated files with their sources so static hosting serves the tested validators.

## Sources of truth

| Source | Responsibility |
| --- | --- |
| `contract/requirements.json` | Permanent requirement IDs (R-1 through R-26; new ones append) and requirement text |
| `CHANGES.md` | Every revision of the specification, newest first; the Spec page's changelog and draft date are written from it |
| `SPEC.md` | The normative text: written by hand, except the blocks between its `generated` markers, which `python3 conformance/check.py --write` writes from `contract/requirements.json`, `contract/model.json` and `examples/profiles.json` with its draft date from `CHANGES.md` |
| `spec.html` | Renders `SPEC.md` with the site's design. After an edit to `SPEC.md`, `node scripts/spec-page.mjs --sync` rewrites the page blocks whose text changed and lays out added ones as the page does; the tests fail while the page, read back by `scripts/spec-markdown.mjs`, differs from `SPEC.md` |
| `schema/*.schema.json` | Item, trace, placement-profile, producer-batch, conflict-group, route-policy and snapshot JSON structures |
| `conformance/cases/` | Language-neutral assembler test cases: snapshot in, expected trace and payload out (see `conformance/README.md`) |
| `conformance/rejections/` | Snapshots that break exactly one snapshot check; an assembler must reject each before assembly, with no trace (R-17) |
| `contract/reasons.json` | Canonical exclusion and refusal reason codes; generates the Producers failure table |
| `contract/assembler-scope.json` | What an assembler can verify per requirement; generates the Assembler matrix scope column |
| `contract/assembler-status.json`, `contract/assembler-conformance.json` | The Python reference assembler's claimed status per requirement and its conformance report, imported from its `status.json` and `conformance-report.json` with `node scripts/import-assembler-status.mjs ../assembler-python`. An imported report file holds `source`, `cases_at_run` and, untouched under `report`, the implementation's own report. `source` names the checkout's repository and commit, whether it was dirty, and the tags on that commit when it was imported, which the Assembler page shows beside the commit; re-import after moving a tag |
| `contract/assembler-ts-conformance.json` | The TypeScript assembler's conformance report, imported with `node scripts/import-conformance-report.mjs ../assembler-typescript contract/assembler-ts-conformance.json` |
| `contract/assembler-go-conformance.json` | The Go assembler's conformance report, imported from a clean Go assembler checkout with `node scripts/import-conformance-report.mjs ../assembler-go contract/assembler-go-conformance.json` |
| `contract/assembler-rust-conformance.json` | The Rust assembler's conformance report, imported from a clean Rust assembler checkout with `node scripts/import-conformance-report.mjs ../assembler-rust contract/assembler-rust-conformance.json` |
| `contract/slot-defaults.json` | Default roles, protection tiers, and policy fields |
| `contract/model.json` | The planes, slots, item fields, authority values, conflict rules, pipeline stages and tests the Spec page lists, in its order; generates those lists on the Spec page and the stages on Producers, and fills the slot and authority tables in the llms guides |
| `examples/` | Concrete item, producer batch, profiles and the route policies they name, payload and matching trace, and the landing page's message request with its snapshot |
| `contract.js` | Shared local semantic checks used by the browser tools and tests |
| `site/*.txt`, `site/cwa.md` | Downloadable integration guidance and rendering template, owned by the site, not the specification |
| `site/profile-display.json` | Profile explorer labels and descriptions; tests check placement against canonical examples |
| `llms.txt`, `llms-producers.txt`, `llms-assemblers.txt` | Guides for language models and coding agents: `llms.txt` indexes the site in the [llms.txt](https://llmstxt.org/) format, and the producer and assembler guides are written by hand around tables the build fills in between their `CONTRACT_*` markers |

The build generates `generated/`, requirement arrays in the Spec and Assembler pages, the model lists in Spec and the stages in Producers from `contract/model.json`, slot defaults in Producers, the profile examples in Evidence and Spec, the Spec page's changelog and draft date from `CHANGES.md`, the tables in the two llms guides, and `llms-full.txt`, which joins `llms.txt`, spec §1, the slots and authority values, both guides, every requirement and `conformance/README.md` into one file. The Start-page downloads import `scaffolds.js`; the landing-page item preview is generated from the same canonical example, and its sample request, with the request's token count and hash, from `examples/messages-payload.json`. Unused duplicate landing-page scaffold logic has been removed.

Ajv compiles the JSON Schemas at build time. The generated browser module has no remote dependency or runtime schema compiler. See [Ajv standalone validation](https://ajv.js.org/standalone.html) and `THIRD_PARTY_NOTICES.md`.

## The specification by itself

[contextwindowarchitecture/contextwindowarchitecture](https://github.com/contextwindowarchitecture/contextwindowarchitecture) holds the specification without the site, for readers who want only the text, the schemas and the cases. This repository is its only author: nothing is edited there. `scripts/spec-repository.mjs` lists what goes: `SPEC.md`, `schema/`, the requirement, reason-code, slot-default and model files of `contract/`, `conformance/` without its generators and `check.py`, `examples/`, `LICENSE` and `NOTICE`, each copied unchanged under the same path, plus the README and the CI and release workflows kept in `scripts/spec-repository/`. With a checkout of that repository beside this one, and the files here committed:

```sh
node scripts/export-spec.mjs ../contextwindowarchitecture          # write what changed; remove what is no longer published
node scripts/export-spec.mjs ../contextwindowarchitecture --check  # exit 1 if the checkout differs
```

An export writes `website.lock.json` there: the website commit it was taken at and each file's SHA-256. One that changes no file writes nothing, so the lock keeps naming a commit that holds those files. In the directories it copies whole (`schema/`, `contract/`, `conformance/`, `examples/`) it removes any file this repository does not publish; it leaves everything else in that repository alone. That repository's CI checks its files against the website commit its lock names, so push this repository first, then commit and push the export.

Its releases follow this repository's. It carries the same tags, `draft-release` among them, and its release workflow releases a tag only once its files match this repository at the same tag. So move a tag here first and push it, then move the same tag there to the export's commit and push it; a tag pushed there before this repository carries it fails its check and is not released.

## What the checks establish

The suite checks field types and enums, timestamps, required fields, defaults, producer handoff shape, selected authority and admission constraints, protected-slot and budget invariants, refusal representation, and instruction-versus-fact conflict trace shape. It also checks profile exports, full migrator body preservation, generated-document synchronization, and component rendering.

`checkItem()` and `checkTrace()` returning `valid: true` means their documented **local checks** pass. It is not authorization to send a request or execute a tool. Authenticate the producer in application code; never construct trusted context by spreading an item's fields into it. The website has no authenticated route context and deliberately reports only local checks.

The concrete trace uses `examples/fixture-profile.json`, separate from the six illustrative route profiles, and its hash matches `examples/payload.txt`. Its `fixture-whitespace/v1` tokenizer counts non-whitespace runs only and is a test fixture, not a model tokenizer. Real assembly counts with the target model's tokenizer, or with an estimating one such as `estimate-utf8/v1` and a `budget.margin_percent` that covers its error (R-16), and counts everything the renderer emits as text, wrappers and repeated content included. Hash the exact rendered UTF-8 bytes; preserve the immutable snapshot separately for replay.

The landing page's sample request is `examples/messages-payload.json`, the exact `cwa-messages/v1` payload that the Python, TypeScript, Go and Rust assemblers produce from `examples/messages-snapshot.json` under `policy-first-chat/v1`, its `support-chat` route policy and `estimate-utf8/v1`. The suite recomputes it from the snapshot and checks that the page shows each member's text, token count and hash as the payload holds them. `examples/messages-trace.json` is the trace all four emit for that snapshot, the same but for the `trace_id` each draws at random; the suite checks it against the snapshot, its digest and the payload's hash.

The suite does **not** implement or certify an assembler, detect semantic contradictions in prose, establish factual truth, authenticate remote sources, prove compression fidelity, or benchmark model outcomes. All six example profiles are unevaluated. A production conformance suite must exercise the actual implementation's admission, conflict resolution, fitting, rendering and replay behavior.

## License

Apache License 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). This covers the specification, schemas, conformance cases and site. The generated validator bundles MIT-licensed code listed in `THIRD_PARTY_NOTICES.md`.
