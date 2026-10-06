// The specification is written in github.com/contextwindowarchitecture/contextwindowarchitecture. This website takes
// a copy of it at a commit, the files at the paths they have there, and never edits them:
//   node scripts/vendor-spec.mjs ../contextwindowarchitecture           # copy, remove what the spec no longer publishes, write spec.lock.json, sync the Spec page
//   node scripts/vendor-spec.mjs ../contextwindowarchitecture --check   # exit 1 if the vendored files differ from that checkout
//   node scripts/vendor-spec.mjs --verify                               # exit 1 if a vendored file differs from the lock; npm test runs this
// A vendor refuses a checkout with uncommitted changes, so the lock always names a commit that holds what was copied,
// and prints the revisions CHANGES.md gained: the reviewer's guide to which pages restate something that changed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// The specification's files, which the website takes as they are and never edits.
export const VENDORED = ['SPEC.md', 'CHANGES.md', 'schema', 'contract', 'conformance', 'examples', 'guides', 'implementations'];
export const LOCK = 'spec.lock.json';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

async function filesUnder(root, name) {
  const full = path.join(root, name);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) return [];
  if (!stat.isDirectory()) return [name];
  const names = [];
  for (const entry of await fs.readdir(full, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store') continue;
    names.push(...await filesUnder(root, `${name}/${entry.name}`));
  }
  return names;
}
const vendoredFiles = async root => (await Promise.all(VENDORED.map(name => filesUnder(root, name)))).flat().sort();

/** A checkout of the specification repository: its repository as owner/repo, commit, tags on it, and whether it is dirty. */
export function specSource(checkout) {
  const url = (() => { try { return git(checkout, 'remote', 'get-url', 'origin'); } catch { return null; } })();
  const github = url && /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return { repository: github ? `${github[1]}/${github[2]}` : url, commit: git(checkout, 'rev-parse', 'HEAD'),
    tags: git(checkout, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean).sort(), dirty: git(checkout, 'status', '--porcelain', '--', ...VENDORED) !== '' };
}

/** What a vendor from the checkout at from would change in the website at to: files to write and files to remove. */
export async function vendorPlan(from, to) {
  const wanted = await vendoredFiles(from);
  const write = [];
  for (const name of wanted) {
    const [a, b] = await Promise.all([fs.readFile(path.join(from, name)), fs.readFile(path.join(to, name)).catch(() => null)]);
    if (b === null || !a.equals(b)) write.push(name);
  }
  return { write, remove: (await vendoredFiles(to)).filter(name => !wanted.includes(name)) };
}

/** How the vendored files at to differ from the lock there, one line per file; empty when they are the locked ones. */
export async function verify(to) {
  const lock = JSON.parse(await fs.readFile(path.join(to, LOCK), 'utf8'));
  const problems = [];
  const held = await vendoredFiles(to);
  for (const [name, digest] of Object.entries(lock.files)) {
    const bytes = await fs.readFile(path.join(to, name)).catch(() => null);
    if (bytes === null) problems.push(`${name} is missing`);
    else if (sha256(bytes) !== digest) problems.push(`${name} differs from ${LOCK}; change it in the specification repository, then vendor`);
  }
  for (const name of held) if (!Object.hasOwn(lock.files, name)) problems.push(`${name} is not in ${LOCK}`);
  return problems;
}

// The revision headings of a CHANGES.md, newest first.
const revisions = text => [...(text ?? '').matchAll(/^## (.+)$/gm)].map(m => m[1]);

/**
 * Copies the specification from the checkout at from into the website at to, removes the vendored files the
 * specification no longer has, writes the lock, and, where to has a Spec page, syncs its prose to the new SPEC.md.
 * Returns what it wrote and removed and the CHANGES.md revisions that are new.
 */
export async function vendor(from, to) {
  const source = specSource(from);
  if (source.dirty) throw new Error(`${from} has uncommitted changes to the specification; vendor a commit.`);
  const before = await fs.readFile(path.join(to, 'CHANGES.md'), 'utf8').catch(() => null);
  const { write, remove } = await vendorPlan(from, to);
  for (const name of write) {
    await fs.mkdir(path.dirname(path.join(to, name)), { recursive: true });
    await fs.copyFile(path.join(from, name), path.join(to, name));
  }
  for (const name of remove) await fs.rm(path.join(to, name));
  const files = {};
  for (const name of await vendoredFiles(to)) files[name] = sha256(await fs.readFile(path.join(to, name)));
  const { dirty, ...locked } = source;
  await fs.writeFile(path.join(to, LOCK), JSON.stringify({ ...locked, files }, null, 2) + '\n');
  if (await fs.stat(path.join(to, 'spec.html')).catch(() => null)) {
    const { syncPage } = await import('./spec-page.mjs');
    const page = path.join(to, 'spec.html');
    const { html, changed } = syncPage({
      html: await fs.readFile(page, 'utf8'), markdown: await fs.readFile(path.join(to, 'SPEC.md'), 'utf8'),
      requirements: JSON.parse(await fs.readFile(path.join(to, 'contract/requirements.json'), 'utf8')),
      site: `https://${(await fs.readFile(path.join(to, 'CNAME'), 'utf8')).trim()}/`,
    });
    if (changed.length) await fs.writeFile(page, html);
  }
  const known = new Set(revisions(before));
  return { source, write, remove, revisions: revisions(await fs.readFile(path.join(to, 'CHANGES.md'), 'utf8')).filter(r => !known.has(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length === 1) {
    const problems = await verify('.');
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log(`The vendored specification is the one ${LOCK} names.`);
  } else if (args.length === 2 && args[1] === '--check') {
    const { write, remove } = await vendorPlan(args[0], '.');
    for (const name of write) console.error(`differs: ${name}`);
    for (const name of remove) console.error(`not in the specification: ${name}`);
    if (write.length || remove.length) process.exit(1);
    console.log(`This website holds the specification as ${args[0]} has it.`);
  } else if (args.length === 1 && !args[0].startsWith('--')) {
    const { source, write, remove, revisions: added } = await vendor(args[0], '.');
    console.log(`Vendored ${source.repository} ${source.commit.slice(0, 7)}${source.tags.length ? ` (${source.tags.join(', ')})` : ''}: ${write.length} written, ${remove.length} removed.`);
    if (added.length) console.log('New in CHANGES.md; check the pages that restate them:\n' + added.map(r => `  ${r}`).join('\n'));
    console.log('Then: npm run build:contract && npm test');
  } else throw new Error('usage: node scripts/vendor-spec.mjs <specification checkout> [--check] | --verify');
}
