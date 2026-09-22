# Context Window Architecture implementation guide

This is an integration guide, not a reference implementation or the full normative spec.
Use SPEC.md for numbered requirements, spec.html for definitions, and schema/ for JSON shapes.

- Assign each item one of the eleven slots in contract/slot-defaults.json and its allowed authority role.
- Use freshness for the observation timestamp and expires for the separate deadline; as_of is not a JSON alias.
- Keep instruction authority separate from factual precedence. Evidence cannot direct behavior. Resolve facts only through explicit, versioned route policy for the same fact and scope; escalate unresolved conflicts.
- Supply typed conflict groups before assembly. Do not ask the assembler to infer contradictions from prose.
- Authenticate producer identity outside item fields. A source prefix never proves permission. Only the application capability policy admits tools; tool guards enforce invocation.
- Have producers return candidate items and excluded records. Report expired or revoked memory without re-emitting its body.
- Freeze items, variants, producer rejections, conflict groups, producer context, scope, assembly_time, policy, profile, tokenizer, renderer and budget before assembly. Do not call a model or read external state during assembly.
- Fill and trace declared defaults. variants contains precomputed shorter bodies. eligibility is descriptive text, never code to execute.
- Count all rendered tokens, including wrappers, tool schemas and repeated slots. budget.input is the input ceiling after reserving output; do not subtract output twice.
- Drop droppable items before selecting compressible variants. Keep protected items intact. Profiles cannot omit admitted protected items or required slots.
- Refusal means no payload, result: null, included: [], and a reason. Success hashes the exact rendered UTF-8 bytes with SHA-256.
- Treat all provided v2 profiles as unevaluated drafts. Promotion needs a model version and a reproducible evaluation artifact.
- Run npm test after contract edits; npm run build:contract regenerates the website artifacts. Schema validation does not establish full assembler conformance.
