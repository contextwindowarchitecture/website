// Copies an implementation's conformance run (its conformance-report.json) into the website, with the digests of
// the cases as they were at the website commit it ran against, so the build can tell which have changed since.
//   node scripts/import-conformance-report.mjs ../assembler-typescript contract/assembler-ts-conformance.json
// The Python reference assembler's report comes in with its statuses: scripts/import-assembler-status.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { imported, ranAt, reportErrors, sourceOf } from './conformance-reports.mjs';

const [checkout, out] = process.argv.slice(2);
if (!checkout || !out) throw new Error('usage: node scripts/import-conformance-report.mjs <implementation checkout> <output file>');
const source = sourceOf(checkout);
const report = JSON.parse(await fs.readFile(path.join(checkout, 'conformance-report.json'), 'utf8'));
const errors = reportErrors(report);
if (errors) throw new Error('conformance-report.json: ' + JSON.stringify(errors));
await fs.writeFile(out, JSON.stringify(imported(source, report), null, 2) + '\n');
const passed = report.cases.filter(c => c.outcome === 'passed').length;
const rejected = (report.rejections ?? []).filter(c => c.outcome === 'rejected').length;
console.log(`Imported ${report.implementation.name} ${source.commit.slice(0, 7)}${source.dirty ? ' (dirty)' : ''}: ${passed} of ${report.cases.length} passing cases and ${rejected} of ${(report.rejections ?? []).length} rejected rejection cases, run against ${ranAt(report).slice(0, 7)}.`);
