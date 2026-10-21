// The home page shows one app from github.com/contextwindowarchitecture/examples, the 01-docs-qa help-center bot. This
// website takes a copy of the files it shows, at a commit, under vendor/examples/ at the paths they have there, and
// never edits them:
//   node scripts/vendor-examples.mjs ../examples           # copy, remove what the list no longer names, write examples.lock.json
//   node scripts/vendor-examples.mjs ../examples --check   # exit 1 if the vendored files differ from that checkout
//   node scripts/vendor-examples.mjs --verify              # exit 1 if a vendored file differs from the lock; npm test runs this
// A vendor refuses a checkout with uncommitted changes to the listed files, so the lock always names a commit that
// holds what was copied. The examples' CI regenerates their scenarios on every push, so a vendor can change the page.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// The files the home page reads: the bot's request code before and after CWA, and two committed scenarios, one
// answered and one refused, each with the snapshot it froze and the trace it produced.
export const EXAMPLE_FILES = [
  '01-docs-qa/before.py',
  '01-docs-qa/after.py',
  '01-docs-qa/context.py',
  '01-docs-qa/scenarios/01-answer/snapshot.json',
  '01-docs-qa/scenarios/01-answer/trace.json',
  '01-docs-qa/scenarios/01-answer/payload.json',
  '01-docs-qa/scenarios/03-off-topic/snapshot.json',
  '01-docs-qa/scenarios/03-off-topic/trace.json',
];
export const DIR = 'vendor/examples';
export const LOCK = 'examples.lock.json';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

async function filesUnder(root, name = '') {
  const full = path.join(root, name);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) return [];
  if (!stat.isDirectory()) return [name];
  const names = [];
  for (const entry of await fs.readdir(full, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store') continue;
    names.push(...await filesUnder(root, name ? `${name}/${entry.name}` : entry.name));
  }
  return names;
}
// The files held under vendor/examples/, as paths in the examples repository.
const vendoredFiles = async to => (await filesUnder(path.join(to, DIR))).sort();

/** An examples checkout: its repository as owner/repo, commit, tags on it, and whether a listed file is uncommitted. */
export function examplesSource(checkout) {
  const url = (() => { try { return git(checkout, 'remote', 'get-url', 'origin'); } catch { return null; } })();
  const github = url && /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return { repository: github ? `${github[1]}/${github[2]}` : url, commit: git(checkout, 'rev-parse', 'HEAD'),
    tags: git(checkout, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean).sort(), dirty: git(checkout, 'status', '--porcelain', '--', ...EXAMPLE_FILES) !== '' };
}

/** What a vendor from the checkout at from would change in the website at to: files to write and files to remove. */
export async function vendorPlan(from, to) {
  const write = [];
  for (const name of [...EXAMPLE_FILES].sort()) {
    const a = await fs.readFile(path.join(from, name)).catch(() => null);
    if (a === null) throw new Error(`${name} is not in ${from}; the home page needs it.`);
    const b = await fs.readFile(path.join(to, DIR, name)).catch(() => null);
    if (b === null || !a.equals(b)) write.push(name);
  }
  return { write, remove: (await vendoredFiles(to)).filter(name => !EXAMPLE_FILES.includes(name)) };
}

/** How the vendored files at to differ from the lock there, one line per file; empty when they are the locked ones. */
export async function verify(to) {
  const lock = JSON.parse(await fs.readFile(path.join(to, LOCK), 'utf8'));
  const problems = [];
  for (const [name, digest] of Object.entries(lock.files)) {
    const bytes = await fs.readFile(path.join(to, DIR, name)).catch(() => null);
    if (bytes === null) problems.push(`${name} is missing`);
    else if (sha256(bytes) !== digest) problems.push(`${name} differs from ${LOCK}; change it in the examples repository, then vendor`);
  }
  for (const name of await vendoredFiles(to)) if (!Object.hasOwn(lock.files, name)) problems.push(`${name} is not in ${LOCK}`);
  return problems;
}

/** Copies the listed files from the checkout at from into the website at to, removes any others, and writes the lock. */
export async function vendor(from, to) {
  const source = examplesSource(from);
  if (source.dirty) throw new Error(`${from} has uncommitted changes to the vendored files; vendor a commit.`);
  const { write, remove } = await vendorPlan(from, to);
  for (const name of write) {
    await fs.mkdir(path.dirname(path.join(to, DIR, name)), { recursive: true });
    await fs.copyFile(path.join(from, name), path.join(to, DIR, name));
  }
  for (const name of remove) await fs.rm(path.join(to, DIR, name));
  const files = {};
  for (const name of await vendoredFiles(to)) files[name] = sha256(await fs.readFile(path.join(to, DIR, name)));
  const { dirty, ...locked } = source;
  await fs.writeFile(path.join(to, LOCK), JSON.stringify({ ...locked, files }, null, 2) + '\n');
  return { source, write, remove };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length === 1) {
    const problems = await verify('.');
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log(`The vendored example is the one ${LOCK} names.`);
  } else if (args.length === 2 && args[1] === '--check') {
    const { write, remove } = await vendorPlan(args[0], '.');
    for (const name of write) console.error(`differs: ${name}`);
    for (const name of remove) console.error(`not listed: ${name}`);
    if (write.length || remove.length) process.exit(1);
    console.log(`This website holds the example as ${args[0]} has it.`);
  } else if (args.length === 1 && !args[0].startsWith('--')) {
    const { source, write, remove } = await vendor(args[0], '.');
    console.log(`Vendored ${source.repository} ${source.commit.slice(0, 7)}${source.tags.length ? ` (${source.tags.join(', ')})` : ''}: ${write.length} written, ${remove.length} removed.`);
    console.log('Then: npm run build:contract && npm test');
  } else throw new Error('usage: node scripts/vendor-examples.mjs <examples checkout> [--check] | --verify');
}
