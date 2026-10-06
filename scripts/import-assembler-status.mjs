// Copies the reference assembler's claims (its status.json) into contract/assembler-status.json, and
// its conformance run (conformance-report.json) into contract/assembler-conformance.json.
//   node scripts/import-assembler-status.mjs ../assembler-python
// Each claim there cites tests and is checked against its scope, and a claim made before this site narrowed a row's
// scope is read under the narrower one (claimsUnder); the report records every case's
// outcome, and the import records each case's digest at the website commit the run used (scripts/conformance-reports.mjs). These files record the result and the assembler commit it came from, with that commit's tags. The build validates
// them again and renders the Assembler matrix.
import fs from 'node:fs/promises';
import path from 'node:path';
import { claimsUnder, imported, reportErrors, sourceOf } from './conformance-reports.mjs';

const assembler = process.argv[2];
if (!assembler) throw new Error('usage: node scripts/import-assembler-status.mjs <path to assembler-python>');
const read = async name => JSON.parse(await fs.readFile(path.join(assembler, name), 'utf8'));
const source = sourceOf(assembler, 'status.json', 'conformance-report.json', 'src', 'tests');
const { requirements } = await read('status.json');
const scopes = JSON.parse(await fs.readFile('contract/assembler-scope.json', 'utf8'));
await fs.writeFile('contract/assembler-status.json', JSON.stringify({
  source, requirements: claimsUnder(scopes, requirements).map(({ id, status, evidence }) => ({ id, status, tests: evidence.length }))
}, null, 2) + '\n');
const report = await read('conformance-report.json');
const errors = reportErrors(report);
if (errors) throw new Error('conformance-report.json: ' + JSON.stringify(errors));
await fs.writeFile('contract/assembler-conformance.json', JSON.stringify(imported(source, report), null, 2) + '\n');
const passed = report.cases.filter(c => c.outcome === 'passed').length;
const rejections = report.rejections ?? [];
const rejected = rejections.filter(c => c.outcome === 'rejected').length;
console.log(`Imported ${requirements.length} statuses, ${passed} of ${report.cases.length} passing cases and ${rejected} of ${rejections.length} rejected rejection cases from ${source.commit.slice(0, 7)}${source.dirty ? ' (dirty)' : ''}.`);
