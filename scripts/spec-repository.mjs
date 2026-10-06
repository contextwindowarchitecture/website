// The specification repository (github.com/contextwindowarchitecture/contextwindowarchitecture): the specification
// without the site. This website is its only author. An export copies the files below unchanged, writes the README
// and the CI and release workflows kept in scripts/spec-repository/, and locks the result to the website commit it
// was taken at. scripts/export-spec.mjs runs it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Copied as they are, under the same paths: the text, the JSON shapes, the contract data, the conformance corpus
// and the examples. The site's pages, guides, tools, generators and implementation reports stay here.
export const COPIED = ['LICENSE', 'NOTICE', 'SPEC.md', 'CHANGES.md', 'schema', 'contract/requirements.json', 'contract/reasons.json',
  'contract/slot-defaults.json', 'contract/model.json', 'conformance/README.md', 'conformance/cases', 'conformance/rejections', 'conformance/registry', 'examples'];
// Written from this repository's scripts/spec-repository/ to the path the other repository needs them at.
export const WRITTEN = {
  'README.md': 'scripts/spec-repository/README.md',
  '.github/workflows/ci.yml': 'scripts/spec-repository/ci.yml',
  '.github/workflows/release.yml': 'scripts/spec-repository/release.yml',
};
// Every path an export reads, so the command can refuse one taken from uncommitted files.
export const SOURCES = [...COPIED, 'scripts/spec-repository'];
// Directories the export owns whole: a file in one that the website does not publish is removed. Anything else in
// the repository, its logos for one, is left alone.
export const OWNED = ['schema', 'contract', 'conformance', 'examples'];
export const LOCK = 'website.lock.json';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every file the specification repository holds after an export of the website checkout at root, keyed by its path
 * there: the tracked files under COPIED, the WRITTEN files, and the lock, which names the website commit and each
 * other file's SHA-256.
 */
export async function specRepository(root, commit) {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...COPIED], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = new Map();
  for (const name of tracked) files.set(name, await fs.readFile(path.join(root, name)));
  for (const [name, source] of Object.entries(WRITTEN)) files.set(name, await fs.readFile(path.join(root, source)));
  const stray = [...files.keys()].filter(name => name.includes('/') && !Object.hasOwn(WRITTEN, name) && !OWNED.includes(name.split('/')[0]));
  if (stray.length > 0) throw new Error(`An export copies directories it owns whole; add to OWNED the directory of ${stray[0]}.`);
  const hashes = Object.fromEntries([...files].sort(byName).map(([name, bytes]) => [name, sha256(bytes)]));
  files.set(LOCK, Buffer.from(JSON.stringify({ website_commit: commit, files: hashes }, null, 2) + '\n'));
  return files;
}

async function filesUnder(dir, base = dir) {
  const names = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) names.push(...await filesUnder(full, base));
    else names.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return names;
}

/** The files in a checkout's OWNED directories that an export does not hold. */
async function unpublished(target, files) {
  const found = await Promise.all(OWNED.map(async dir => (await filesUnder(path.join(target, dir))).map(name => `${dir}/${name}`)));
  return found.flat().filter(name => !files.has(name)).sort();
}

// A lock is current when it locks the same files: the commit it names still holds every one of them.
const sameFiles = (lock, held) => {
  try {
    return JSON.stringify(JSON.parse(held.toString('utf8')).files) === JSON.stringify(JSON.parse(lock.toString('utf8')).files);
  } catch {
    return false;
  }
};

/**
 * How a checkout of the specification repository differs from an export, one line per file: missing, different, or
 * in an OWNED directory without being published. Empty when the checkout holds the export.
 */
export async function checkExport(target, files) {
  const problems = [];
  for (const [name, bytes] of files) {
    const held = await fs.readFile(path.join(target, name)).catch(() => null);
    if (held === null) problems.push(`${name} is missing`);
    else if (name === LOCK ? !sameFiles(bytes, held) : !bytes.equals(held)) problems.push(`${name} differs from the website`);
  }
  return [...problems, ...(await unpublished(target, files)).map(name => `${name} is not published by the website`)];
}

/** Writes an export into a checkout of the specification repository and removes what the website no longer publishes. */
export async function writeExport(target, files) {
  const removed = await unpublished(target, files);
  for (const name of removed) {
    await fs.rm(path.join(target, name));
    // A directory the removal empties goes with it, up to the owned directory itself.
    for (let dir = path.dirname(name); dir.includes('/'); dir = path.dirname(dir)) {
      if ((await fs.readdir(path.join(target, dir))).length > 0) break;
      await fs.rmdir(path.join(target, dir));
    }
  }
  for (const [name, bytes] of files) {
    await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
    await fs.writeFile(path.join(target, name), bytes);
  }
  return { removed };
}
