import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { IMPLEMENTATIONS } from '../scripts/conformance-reports.mjs';
import { LOCK, checkExport, specRepository, writeExport } from '../scripts/spec-repository.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMMIT = 'a'.repeat(40);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = (...paths) => execFileSync('git', ['-C', ROOT, 'ls-files', '--', ...paths], { encoding: 'utf8' }).split('\n').filter(Boolean);
// The specification without the site: its text, schemas, contract data, conformance corpus and examples.
const COPIED = () => tracked('LICENSE', 'NOTICE', 'SPEC.md', 'schema', 'contract/requirements.json', 'contract/reasons.json',
  'contract/slot-defaults.json', 'conformance/README.md', 'conformance/cases', 'conformance/rejections', 'conformance/registry', 'examples');
const WRITTEN = ['README.md', '.github/workflows/ci.yml', LOCK];

async function listing(dir, base = dir) {
  const names = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) names.push(...await listing(full, base));
    else names.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return names.sort();
}

async function inTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cwa-spec-repository-'));
  try {
    await run(dir, async (name, content = 'kept') => {
      await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await fs.writeFile(path.join(dir, name), content);
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('the specification repository holds the spec, schemas, contract data, conformance corpus and examples, each file unchanged, and no site', async () => {
  const files = await specRepository(ROOT, COMMIT);
  const copied = COPIED();
  assert.ok(copied.length > 250, 'the conformance corpus is tracked');
  assert.deepEqual([...files.keys()].sort(), [...copied, ...WRITTEN].sort());
  for (const name of copied) assert.ok(files.get(name).equals(await fs.readFile(path.join(ROOT, name))), `${name} is copied byte for byte`);
  for (const name of files.keys()) {
    assert.doesNotMatch(name, /\.html$|^scripts\/|^generated\/|^llms|generators\/|check\.py$|assembler-|profile-display|\.txt$(?<!payload\.txt)/, `${name} is site or tooling material`);
  }
});

test('the lock names the website commit the export was taken at and the SHA-256 of every other file', async () => {
  const files = await specRepository(ROOT, COMMIT);
  const lock = JSON.parse(files.get(LOCK).toString('utf8'));
  assert.deepEqual(Object.keys(lock), ['website_commit', 'files']);
  assert.equal(lock.website_commit, COMMIT);
  const others = [...files.keys()].filter(name => name !== LOCK).sort();
  assert.deepEqual(Object.keys(lock.files), others);
  for (const name of others) assert.equal(lock.files[name], sha256(files.get(name)), name);
});

test('writing an export replaces what the website publishes, removes what it no longer does, and leaves the rest of the repository alone', async () => {
  const files = await specRepository(ROOT, COMMIT);
  await inTempDir(async (dir, put) => {
    const kept = ['.git/HEAD', '.github/workflows/other.yml', 'assets/images/logo.svg', 'docs/index.mdx', 'CONTRIBUTING.md'];
    const stale = ['schema/draft/schema.json', 'examples/old.json', 'conformance/check.py', 'contract/assembler-scope.json'];
    for (const name of [...kept, ...stale, 'README.md', 'SPEC.md']) await put(name, 'before');
    const { removed } = await writeExport(dir, files);
    assert.deepEqual(removed.sort(), [...stale].sort());
    assert.deepEqual(await listing(dir), [...files.keys(), ...kept].sort());
    for (const [name, bytes] of files) assert.ok(bytes.equals(await fs.readFile(path.join(dir, name))), name);
    for (const name of kept) assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), 'before', `${name} is not the website's to write`);
    await assert.rejects(fs.access(path.join(dir, 'schema/draft')), 'a directory left empty goes too');
    assert.deepEqual(await checkExport(dir, files), []);
  });
});

test('a check names each file that differs, is missing or is no longer published, and nothing outside what the website writes', async () => {
  const files = await specRepository(ROOT, COMMIT);
  await inTempDir(async (dir, put) => {
    await writeExport(dir, files);
    await put('SPEC.md', 'edited here');
    await fs.rm(path.join(dir, 'schema/trace.schema.json'));
    await put('conformance/cases/added-here/case.json', '{}');
    await put('assets/images/logo.svg');
    await put('NOTES.md');
    assert.deepEqual((await checkExport(dir, files)).sort(), [
      'SPEC.md differs from the website',
      'conformance/cases/added-here/case.json is not published by the website',
      'schema/trace.schema.json is missing',
    ]);
  });
  await inTempDir(async dir => {
    const problems = await checkExport(dir, files);
    assert.equal(problems.length, files.size, 'an empty directory lacks every file');
  });
});

test('an export that changes no file is already current, whatever website commit it is taken at', async () => {
  const files = await specRepository(ROOT, COMMIT);
  const later = await specRepository(ROOT, 'b'.repeat(40));
  assert.notDeepEqual(later.get(LOCK), files.get(LOCK));
  await inTempDir(async dir => {
    await writeExport(dir, files);
    assert.deepEqual(await checkExport(dir, later), [], 'the lock still names a commit that holds these files');
    await fs.writeFile(path.join(dir, LOCK), JSON.stringify({ website_commit: COMMIT, files: { 'SPEC.md': sha256('other') } }));
    assert.deepEqual(await checkExport(dir, later), [`${LOCK} differs from the website`]);
  });
});

test('the repository README opens with the site\'s own description, links every implementation, and points only at files the export holds', async () => {
  const files = await specRepository(ROOT, COMMIT);
  const readme = files.get('README.md').toString('utf8');
  const llms = await fs.readFile(path.join(ROOT, 'llms.txt'), 'utf8');
  const described = llms.match(/^> (.*?\.) /m)[1];
  assert.match(described, /^Context Window Architecture \(CWA\) is /);
  assert.ok(readme.includes(`# Context Window Architecture\n\n${described} `), 'the README opens with the sentence llms.txt opens with');
  for (const { file } of IMPLEMENTATIONS) {
    const { source } = JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8'));
    assert.ok(readme.includes(`(https://github.com/${source.repository})`), `the README links ${source.repository}`);
  }
  const targets = [...readme.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(targets.includes('SPEC.md') && targets.includes(LOCK));
  const held = [...files.keys()];
  for (const target of targets.filter(t => !t.startsWith('https://'))) {
    assert.ok(held.some(name => name === target || name.startsWith(target.replace(/\/$/, '') + '/')), `${target} is in the repository`);
  }
  assert.doesNotMatch(readme, /\bfree\b/i);
});
