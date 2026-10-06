import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { implementations } from '../scripts/conformance-reports.mjs';
import { LOCK, checkExport, specRepository, writeExport } from '../scripts/spec-repository.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPOSITORY = 'https://github.com/contextwindowarchitecture/contextwindowarchitecture';
const COMMIT = 'a'.repeat(40);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = (...paths) => execFileSync('git', ['-C', ROOT, 'ls-files', '--', ...paths], { encoding: 'utf8' }).split('\n').filter(Boolean);
// The specification without the site: its text, schemas, contract data, conformance corpus and examples.
const COPIED = () => tracked('LICENSE', 'NOTICE', 'SPEC.md', 'CHANGES.md', 'schema', 'contract/requirements.json', 'contract/reasons.json',
  'contract/slot-defaults.json', 'contract/model.json', 'conformance/README.md', 'conformance/cases', 'conformance/rejections', 'conformance/registry', 'examples', 'implementations');
const WRITTEN = ['README.md', '.github/workflows/ci.yml', '.github/workflows/release.yml', LOCK];

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
  for (const { file } of await implementations(ROOT)) {
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

// A reader of the site can reach the specification without it: from the Spec page, from the About page's account of
// how the specification is maintained, and, for an agent, from the llms.txt index.
test('the Spec page, the About page and llms.txt link the specification repository', async () => {
  for (const page of ['spec.html', 'about.html']) {
    const html = await fs.readFile(path.join(ROOT, page), 'utf8');
    assert.ok(html.includes(`<a href="${REPOSITORY}" target="_blank" rel="noopener">`), `${page} links the specification repository`);
  }
  const specification = (await fs.readFile(path.join(ROOT, 'llms.txt'), 'utf8')).split(/^## /m).find(section => section.startsWith('Specification\n'));
  assert.ok(specification.split('\n').some(line => line.startsWith(`- [Specification repository](${REPOSITORY}): `)), 'llms.txt lists it under Specification');
  assert.ok((await fs.readFile(path.join(ROOT, 'llms-full.txt'), 'utf8')).includes(`(${REPOSITORY})`), 'llms-full.txt carries the link');
  assert.ok((await fs.readFile(path.join(ROOT, 'README.md'), 'utf8')).includes(`(${REPOSITORY})`), 'the README names where the export goes');
});

// Someone who follows only the specification repository learns of a new draft from its releases, so its tags are
// released as the website's are, and a tag is released only once its files match the website at the same tag.
test('the specification repository releases each tag, and only against the website at the same tag', async () => {
  const files = await specRepository(ROOT, COMMIT);
  const ci = files.get('.github/workflows/ci.yml').toString('utf8');
  const release = files.get('.github/workflows/release.yml').toString('utf8');
  assert.match(release, /^on:\n  push:\n    tags: \["\*"\]\n  workflow_dispatch:/m, 'a pushed tag starts it, and an existing tag can be released by hand');
  const call = release.match(/^  ci:\n    uses: \.\/\.github\/workflows\/ci\.yml\n    with:\n((?:      .*\n)+)/m);
  assert.ok(call, 'the release calls this repository\'s ci first');
  const tag = '${{ inputs.tag || github.ref_name }}';
  assert.ok(call[1].includes(`ref: refs/tags/${tag}\n`), 'ci runs on the tagged commit');
  assert.ok(call[1].includes(`website_ref: refs/tags/${tag}\n`), 'against the website at the same tag');
  assert.match(release, /^  release:\n    name: .*\n    needs: ci\n/m, 'no release without that check');
  assert.match(release, /gh release create "\$TAG" --verify-tag /);
  assert.ok(ci.includes('ref: ${{ inputs.website_ref || steps.lock.outputs.commit }}'), 'a push is checked against the commit the lock names, a release against the ref it is given');
  assert.ok(ci.includes('node scripts/export-spec.mjs .. --check'));
  // The notes give the draft's date as SPEC.md states it.
  const draft = release.match(/grep -oE '([^']+)' SPEC\.md/);
  assert.ok(draft, 'the notes read the draft date from SPEC.md');
  assert.match(files.get('SPEC.md').toString('utf8'), new RegExp(draft[1], 'm'), 'SPEC.md states the date where the release looks for it');
  const spec = await fs.readFile(path.join(ROOT, 'spec.html'), 'utf8');
  for (const [, page, anchor] of release.matchAll(/https:\/\/contextwindowarchitecture\.io\/([\w.-]+)#([\w-]+)/g)) {
    assert.equal(page, 'spec.html');
    assert.ok(spec.includes(`id="${anchor}"`), `the notes link #${anchor} on the Spec page`);
  }
  assert.match(files.get('README.md').toString('utf8'), /`draft-release`/, 'the README says which tag to follow');
});
