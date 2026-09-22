import { ITEM_SCHEMA, ITEM_EXAMPLE } from './generated/contract-data.js';
import { ASSEMBLY_SKETCH, PAYLOAD_TEMPLATE, AGENT_GUIDE } from './generated/scaffold-text.js';

export const SCAFFOLDS = [
  { label: "Assembly sketch", filename: "assemble.py", blurb: "Integration sketch, not a runnable assembler. Implement application helpers, token accounting, admission checks, and tracing before use.", text: ASSEMBLY_SKETCH },
  { label: "Payload", filename: "payload.txt", blurb: "Illustrative rendering template. Empty tags are placeholders, not a valid assembled request.", text: PAYLOAD_TEMPLATE },
  { label: "Item example", filename: "context_item.yaml", blurb: "Complete retrieval item in JSON syntax, which is also valid YAML. The browser linter and downloaded schema use the same contract.", text: JSON.stringify(ITEM_EXAMPLE, null, 2) },
  { label: "JSON Schema", filename: "context_item.schema.json", blurb: "Structural item validation. Route admission still requires authenticated producers and application policy.", text: JSON.stringify(ITEM_SCHEMA, null, 2) },
  { label: "For agents", filename: "cwa.md", blurb: "Implementation guidance for coding agents; the numbered specification and schemas are authoritative.", text: AGENT_GUIDE }
];
