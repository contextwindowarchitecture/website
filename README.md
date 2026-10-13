# CWA website and executable contracts

Static website for the CWA draft. Serve this directory over HTTP; no application server or browser-side package installation is required. The reference assembler remains unreleased.

## Development

Use Node.js 22 or newer and the locked development dependencies:

```sh
npm ci
npm run build:contract
npm test
```

`npm test` fails if a vendored specification file differs from `spec.lock.json` or a generated artifact is stale, then runs the contract fixtures and embedded website-component checks. CI (`.github/workflows/ci.yml`) runs `npm ci` and `npm test` on Node 22 and 24. Each tag gets a GitHub release once CI passes on the tagged commit (`.github/workflows/release.yml`), with the tag's own commits as notes, written by git-cliff; a tag that is not `vX.Y.Z` is a prerelease, and a tag pushed before the workflow existed is released with `gh workflow run release.yml -f tag=<tag>`. `CHANGELOG.md` is generated from the commit history with git-cliff (`cliff.toml`): regenerate it at a release with `uvx git-cliff --tag vX.Y.Z -o CHANGELOG.md` and never edit it by hand. The spec's own revision history is `CHANGES.md`, which the build writes into the Spec page's draft date; the page carries no changelog. Commit generated files with their sources so static hosting serves the tested validators.

## Sources of truth

The specification is not written here. `SPEC.md`, `CHANGES.md`, `schema/`, `contract/`, `conformance/`, `examples/`, `guides/` and `implementations/` are copies of [contextwindowarchitecture/contextwindowarchitecture](https://github.com/contextwindowarchitecture/contextwindowarchitecture) at the commit `spec.lock.json` names. Never edit them: `npm test` fails when one differs from the lock. To change one, change it there, then run `node scripts/vendor-spec.mjs ../contextwindowarchitecture`.

### Vendored from the specification repository

| Source | Responsibility |
| --- | --- |
| `contract/requirements.json` | Permanent requirement IDs (R-1 through R-26; new ones append) and requirement text |
| `CHANGES.md` | Every revision of the specification, newest first; the Spec page's draft date is written from it, and the history reads there, not on the page |
| `SPEC.md` | The normative text: written by hand, except the blocks between its `generated` markers, which `python3 conformance/check.py --write` writes from `contract/requirements.json`, `contract/model.json` and `examples/profiles.json` with its draft date from `CHANGES.md` |
| `schema/*.schema.json` | Item, trace, placement-profile, producer-batch, conflict-group, route-policy and snapshot JSON structures |
| `conformance/cases/` | Language-neutral assembler test cases: snapshot in, expected trace and payload out (see `conformance/README.md`) |
| `conformance/rejections/` | Snapshots that break exactly one snapshot check; an assembler must reject each before assembly, with no trace (R-17) |
| `contract/reasons.json` | Canonical exclusion and refusal reason codes, listed in the llms guides |
| `contract/assembler-scope.json` | What an assembler can verify per requirement; generates the Assembler matrix scope column |
| `implementations/` | Each listed implementation's conformance report, stored untouched beside its source (repository, commit, tags) and the digests of the cases at the commit it ran against, and the Python reference assembler's status claims (`python.status.json`); `index.json` lists them in the Assembler page's order. Reports are imported in the specification repository with `conformance/import_report.py` and reach this site with the next vendor |
| `contract/slot-defaults.json` | Default roles, protection tiers, and policy fields |
| `contract/model.json` | The planes, slots, item fields, authority values, conflict rules, pipeline stages and tests the Spec page lists, in its order; generates those lists on the Spec page, and fills the slot and authority tables in the llms guides |
| `examples/` | Concrete item, producer batch, profiles and the route policies they name, payload and matching trace, and the sample message request with its snapshot |
| `guides/producers.md`, `guides/assemblers.md` | The producer and assembler guides, written by hand around the blocks between their `generated` markers, which `python3 conformance/check.py --write` writes from the contract files and `implementations/`. Links to the specification's files are relative, links to site pages absolute |

### Written here

| Source | Responsibility |
| --- | --- |
| `spec.html` | Renders `SPEC.md` from its requirement index to section 6 with the site's design, leaving Future work in `SPEC.md`, and names the specification commit it renders. A vendor runs `node scripts/spec-page.mjs --sync`, which rewrites the page blocks whose text changed and lays out added ones as the page does; the tests fail while the page, read back by `scripts/spec-markdown.mjs`, differs from `SPEC.md` |
| `contract.js` | Shared local semantic checks used by the tests |
| `site/*.txt`, `site/cwa.md` | Integration guidance and rendering template for agents, linked from `llms.txt`, owned by the site, not the specification |
| `site/glossary.json`, `site/glossary.js` | Every term the site uses, defined in the specification's own words with where the site defines it; the module loads and searches it for the glossary panel every page opens. Tests hold each quoted sentence to `SPEC.md`, each anchor to its page, and the planes and slots to `contract/model.json` |
| `llms.txt`, `llms-producers.txt`, `llms-assemblers.txt` | Guides for language models and coding agents: `llms.txt` indexes the site in the [llms.txt](https://llmstxt.org/) format, written by hand. The build writes the two others from `guides/`, with links resolved against the site and each implementation's count added, and stops when a guide's generated block differs from its own rendering |

The build generates `generated/`, the requirement arrays in the Spec page, the model lists in Spec from `contract/model.json`, the first profile example in Placement and Spec, the Spec page's draft date from `CHANGES.md`, the implementations table on the Assembler page from their reports, the two llms guides from `guides/`, and `llms-full.txt`, which joins `llms.txt`, spec §1, the slots and authority values, both guides, every requirement and `conformance/README.md` into one file.

Ajv compiles the JSON Schemas at build time. The generated browser module has no remote dependency or runtime schema compiler. See [Ajv standalone validation](https://ajv.js.org/standalone.html) and `THIRD_PARTY_NOTICES.md`.

## Where the specification comes from

With a checkout of the specification repository beside this one:

```sh
node scripts/vendor-spec.mjs ../contextwindowarchitecture           # copy, remove what the spec no longer publishes, write spec.lock.json, sync the Spec page
node scripts/vendor-spec.mjs ../contextwindowarchitecture --check   # exit 1 if the vendored files differ from that checkout
node scripts/vendor-spec.mjs --verify                               # exit 1 if a vendored file differs from the lock; npm test runs this
npm run build:contract && npm test
```

A vendor refuses a checkout with uncommitted changes, so `spec.lock.json` always names a commit (and the tags on it) that holds what was copied, and it prints the revisions `CHANGES.md` gained since the last vendor: check the pages that restate them. It then syncs the Spec page to the new `SPEC.md`. CI checks the vendored files against the specification repository at the locked commit, and a tag is released only against that repository at the same tag, so tag it there first.

The specification's own checks run there, in Python: `uv run python conformance/check.py` and `uv run python -m unittest discover -s conformance/tests`. Implementations are listed there too, with `conformance/import_report.py`.

## What the checks establish

The suite checks field types and enums, timestamps, required fields, defaults, producer handoff shape, selected authority and admission constraints, protected-slot and budget invariants, refusal representation, and instruction-versus-fact conflict trace shape. It also checks profile exports, full migrator body preservation, generated-document synchronization, and component rendering. `tests/accessibility.test.mjs` holds the site to an accessibility floor: every colour the pages use as text clears 4.5:1 on both backgrounds in both themes and `STYLE.md` lists the same values, every page carries a reduced-motion rule and a no-script note, and the simulator announces changes through a live region.

`checkItem()` and `checkTrace()` returning `valid: true` means their documented **local checks** pass. It is not authorization to send a request or execute a tool. Authenticate the producer in application code; never construct trusted context by spreading an item's fields into it. The website has no authenticated route context and deliberately reports only local checks.

The concrete trace uses `examples/fixture-profile.json`, separate from the six illustrative route profiles, and its hash matches `examples/payload.txt`. Its `fixture-whitespace/v1` tokenizer counts non-whitespace runs only and is a test fixture, not a model tokenizer. Real assembly counts with the target model's tokenizer, or with an estimating one such as `estimate-utf8/v1` and a `budget.margin_percent` that covers its error (R-16), and counts everything the renderer emits as text, wrappers and repeated content included. Hash the exact rendered UTF-8 bytes; preserve the immutable snapshot separately for replay.

`examples/messages-payload.json` is the exact `cwa-messages/v1` payload that the Python, TypeScript, Go and Rust assemblers produce from `examples/messages-snapshot.json` under `policy-first-chat/v1`, its `support-chat` route policy and `estimate-utf8/v1`. The suite recomputes it from the snapshot. `examples/messages-trace.json` is the trace all four emit for that snapshot, the same but for the `trace_id` each draws at random; the suite checks it against the snapshot, its digest and the payload's hash.

The suite does **not** implement or certify an assembler, detect semantic contradictions in prose, establish factual truth, authenticate remote sources, prove compression fidelity, or benchmark model outcomes. All six example profiles are unevaluated. A production conformance suite must exercise the actual implementation's admission, conflict resolution, fitting, rendering and replay behavior.

## License

Apache License 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). This covers the specification, schemas, conformance cases and site. The generated validator bundles MIT-licensed code listed in `THIRD_PARTY_NOTICES.md`.
