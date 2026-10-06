// Exports the specification, without the site, into a checkout of the specification repository
// (scripts/spec-repository.mjs says what goes), or checks that the checkout holds it.
//   node scripts/export-spec.mjs ../contextwindowarchitecture
//   node scripts/export-spec.mjs ../contextwindowarchitecture --check
// Run from the website root with the specification files committed: the export's lock names this commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { SOURCES, checkExport, specRepository, writeExport } from './spec-repository.mjs';

const [target, flag] = process.argv.slice(2);
if (!target || (flag !== undefined && flag !== '--check')) throw new Error('usage: node scripts/export-spec.mjs <specification repository checkout> [--check]');
if (!(await fs.stat(target).catch(() => null))?.isDirectory()) throw new Error(`${target} is not a directory.`);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const source = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', ...SOURCES) !== '' };
if (source.dirty) throw new Error('Commit the specification files first: an export names the website commit that holds them.');
const files = await specRepository('.', source.commit);
const problems = await checkExport(target, files);
const at = `website ${source.commit.slice(0, 7)}`;
if (flag === '--check') {
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`${target} does not hold the specification as ${at} publishes it; run node scripts/export-spec.mjs ${target}`);
    process.exit(1);
  }
  console.log(`${target} holds the specification as ${at} publishes it.`);
} else if (problems.length === 0) console.log(`Nothing to export: ${target} already holds the specification as ${at} publishes it.`);
else {
  const { removed } = await writeExport(target, files);
  console.log(`Exported ${at} to ${target}: ${files.size} files, ${problems.length} changed, ${removed.length} removed.`);
}
