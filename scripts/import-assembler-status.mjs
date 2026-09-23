// Copies the reference assembler's claims (its status.json) into contract/assembler-status.json.
//   node scripts/import-assembler-status.mjs ../cwa-assembler
// Each claim there cites tests and is checked against its scope; this file records the result and
// the assembler commit it came from. The build validates it again and renders the Assembler matrix.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const assembler = process.argv[2];
if (!assembler) throw new Error('usage: node scripts/import-assembler-status.mjs <path to cwa-assembler>');
const git = (...args) => execFileSync('git', ['-C', assembler, ...args], { encoding: 'utf8' }).trim();
const { requirements } = JSON.parse(await fs.readFile(path.join(assembler, 'status.json'), 'utf8'));
const output = {
  source: { repository: 'contextwindowarchitecture/assembler', commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', 'status.json', 'src', 'tests') !== '' },
  requirements: requirements.map(({ id, status, evidence }) => ({ id, status, tests: evidence.length }))
};
await fs.writeFile('contract/assembler-status.json', JSON.stringify(output, null, 2) + '\n');
console.log(`Imported ${requirements.length} statuses from ${output.source.commit.slice(0, 7)}${output.source.dirty ? ' (dirty)' : ''}.`);
