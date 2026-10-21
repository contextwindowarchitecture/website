import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DIR, EXAMPLE_FILES, LOCK, vendor, vendorPlan, verify } from '../scripts/vendor-examples.mjs';
import { validateSnapshotSchema, validateTraceSchema } from '../generated/schema-validators.js';

// The home page shows the 01-docs-qa help-center bot from github.com/contextwindowarchitecture/examples: its code, the
// request its model receives and the trace that says what was left out. Those files are vendored here at a commit,
// never copied by hand (docs/plans/reader-feedback/home-page.md, H1).

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args], { encoding: 'utf8' }).trim();

/** An examples checkout holding every vendored file, and a website beside it, each in a temporary directory. */
async function pair(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cwa-vendor-examples-'));
  const examples = path.join(dir, 'examples'), site = path.join(dir, 'site');
  const put = async (root, name, text) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), text); };
  try {
    await fs.mkdir(examples); await fs.mkdir(site);
    git(examples, 'init', '-q');
    git(examples, 'remote', 'add', 'origin', 'git@github.com:contextwindowarchitecture/examples.git');
    for (const name of EXAMPLE_FILES) await put(examples, name, `${name}\n`);
    await put(examples, '01-docs-qa/README.md', 'not vendored\n');
    git(examples, 'add', '-A'); git(examples, 'commit', '-q', '-m', 'one'); git(examples, 'tag', 'draft-release');
    await put(site, 'index.html', 'the site\n');
    await run({ examples, site, put, commit: message => { git(examples, 'add', '-A'); git(examples, 'commit', '-q', '-m', message); } });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('a vendor copies the listed example files under vendor/examples, locks them to the commit, and the lock then verifies', async () => {
  await pair(async ({ examples, site }) => {
    const { source, write } = await vendor(examples, site);
    assert.deepEqual(write, [...EXAMPLE_FILES].sort());
    const lock = JSON.parse(await fs.readFile(path.join(site, LOCK), 'utf8'));
    assert.deepEqual(Object.keys(lock), ['repository', 'commit', 'tags', 'files']);
    assert.deepEqual([lock.repository, lock.commit, lock.tags], ['contextwindowarchitecture/examples', source.commit, ['draft-release']]);
    assert.deepEqual(Object.keys(lock.files), write);
    assert.equal(await fs.readFile(path.join(site, DIR, '01-docs-qa/before.py'), 'utf8'), '01-docs-qa/before.py\n');
    await assert.rejects(fs.access(path.join(site, DIR, '01-docs-qa/README.md')), 'only the listed files are copied');
    assert.deepEqual(await verify(site), []);
    await fs.writeFile(path.join(site, DIR, '01-docs-qa/after.py'), 'edited on the site\n');
    await fs.writeFile(path.join(site, DIR, '01-docs-qa/extra.py'), 'stray\n');
    assert.deepEqual(await verify(site), [`01-docs-qa/after.py differs from ${LOCK}; change it in the examples repository, then vendor`, `01-docs-qa/extra.py is not in ${LOCK}`]);
  });
});

test('a vendor refuses a checkout with uncommitted changes to a listed file, and one that lacks a listed file', async () => {
  await pair(async ({ examples, site, put, commit }) => {
    await put(examples, '01-docs-qa/before.py', 'edited\n');
    await assert.rejects(vendor(examples, site), /uncommitted changes/);
    await assert.rejects(fs.access(path.join(site, LOCK)), 'nothing was written');
    git(examples, 'checkout', '--', '.');
    await fs.rm(path.join(examples, '01-docs-qa/context.py'));
    commit('drop context.py');
    await assert.rejects(vendor(examples, site), /01-docs-qa\/context\.py is not in/);
  });
});

test('a vendor removes a vendored file the list no longer names, and a check names each file that differs', async () => {
  await pair(async ({ examples, site, put }) => {
    await vendor(examples, site);
    assert.deepEqual(await vendorPlan(examples, site), { write: [], remove: [] });
    await put(site, path.join(DIR, '01-docs-qa/before.py'), 'edited\n');
    await put(site, path.join(DIR, 'old/file.py'), 'stray\n');
    assert.deepEqual(await vendorPlan(examples, site), { write: ['01-docs-qa/before.py'], remove: ['old/file.py'] });
    const { write, remove } = await vendor(examples, site);
    assert.deepEqual([write, remove], [['01-docs-qa/before.py'], ['old/file.py']]);
    assert.deepEqual(await verify(site), []);
  });
});

const example = async name => fs.readFile(path.join(ROOT, DIR, name));
const json = async name => JSON.parse(await example(name));

test('this website\'s vendored example is the one examples.lock.json names', async () => {
  assert.deepEqual(await verify(ROOT), []);
  const lock = JSON.parse(await fs.readFile(path.join(ROOT, LOCK), 'utf8'));
  assert.equal(lock.repository, 'contextwindowarchitecture/examples');
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(lock.files), [...EXAMPLE_FILES].sort());
});

test('the vendored request is the one its trace hashes, and the off-topic question was refused before any model call', async () => {
  const payload = await example('01-docs-qa/scenarios/01-answer/payload.json');
  const answered = await json('01-docs-qa/scenarios/01-answer/trace.json');
  assert.equal(answered.refused.bool, false);
  assert.equal(answered.result.hash, createHash('sha256').update(payload).digest('hex'), 'the trace hashes the payload as vendored');
  const refused = await json('01-docs-qa/scenarios/03-off-topic/trace.json');
  assert.deepEqual([refused.refused, refused.recovery?.action, refused.result], [{ bool: true, reason: 'evidence_required' }, 'request_context', null]);
});

test('the vendored snapshots and traces match the specification this website vendors', async () => {
  for (const scenario of ['01-answer', '03-off-topic']) {
    assert.equal(validateSnapshotSchema(await json(`01-docs-qa/scenarios/${scenario}/snapshot.json`)), true, `${scenario}: the snapshot`);
    // The examples store a trace without trace_id and timings, which differ run to run (01-docs-qa/scenarios.py),
    // as conformance compares traces without them; a placeholder id stands in for the one a run would carry.
    const trace = await json(`01-docs-qa/scenarios/${scenario}/trace.json`);
    assert.equal(trace.trace_id, undefined);
    assert.equal(validateTraceSchema({ trace_id: 'vendored', ...trace }), true, `${scenario}: the trace`);
  }
});
