import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOCK, VENDORED, vendor, vendorPlan, verify } from '../scripts/vendor-spec.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args], { encoding: 'utf8' }).trim();

/** A specification checkout and a website beside it, each in a temporary directory. */
async function pair(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cwa-vendor-'));
  const spec = path.join(dir, 'spec'), site = path.join(dir, 'site');
  const put = async (root, name, text) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), text); };
  try {
    await fs.mkdir(spec); await fs.mkdir(site);
    git(spec, 'init', '-q');
    git(spec, 'remote', 'add', 'origin', 'https://github.com/contextwindowarchitecture/contextwindowarchitecture.git');
    for (const [name, text] of [['SPEC.md', '# Spec\n'], ['CHANGES.md', '# Changes\n\n## 2026-10-05 · one\n\n- a\n'], ['schema/a.json', '{}\n'], ['contract/b.json', '[]\n'],
      ['conformance/README.md', 'c\n'], ['examples/e.json', '{}\n'], ['guides/g.md', 'g\n'], ['implementations/index.json', '[]\n'], ['README.md', 'not vendored\n']]) await put(spec, name, text);
    git(spec, 'add', '-A'); git(spec, 'commit', '-q', '-m', 'one'); git(spec, 'tag', 'draft-release');
    await put(site, 'index.html', 'the site\n');
    await run({ spec, site, put, commit: message => { git(spec, 'add', '-A'); git(spec, 'commit', '-q', '-m', message); } });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('a vendor copies the specification\'s paths, locks them to the commit, and the lock then verifies', async () => {
  await pair(async ({ spec, site }) => {
    const { source, write, revisions } = await vendor(spec, site);
    assert.deepEqual(write, ['CHANGES.md', 'SPEC.md', 'conformance/README.md', 'contract/b.json', 'examples/e.json', 'guides/g.md', 'implementations/index.json', 'schema/a.json']);
    assert.deepEqual(revisions, ['2026-10-05 · one'], 'every revision is new to a site that had none');
    const lock = JSON.parse(await fs.readFile(path.join(site, LOCK), 'utf8'));
    assert.deepEqual(Object.keys(lock), ['repository', 'commit', 'tags', 'files']);
    assert.deepEqual([lock.repository, lock.commit, lock.tags], ['contextwindowarchitecture/contextwindowarchitecture', source.commit, ['draft-release']]);
    assert.deepEqual(Object.keys(lock.files), write);
    await assert.rejects(fs.access(path.join(site, 'README.md')), 'only the vendored paths are copied');
    assert.deepEqual(await verify(site), []);
    await fs.writeFile(path.join(site, 'guides/g.md'), 'edited on the site\n');
    await fs.writeFile(path.join(site, 'schema/extra.json'), '{}\n');
    assert.deepEqual(await verify(site), ['guides/g.md differs from spec.lock.json; change it in the specification repository, then vendor', 'schema/extra.json is not in spec.lock.json']);
  });
});

test('a vendor refuses a checkout with uncommitted changes to the specification', async () => {
  await pair(async ({ spec, site, put }) => {
    await put(spec, 'SPEC.md', '# Spec, edited\n');
    await assert.rejects(vendor(spec, site), /uncommitted changes/);
    await assert.rejects(fs.access(path.join(site, LOCK)), 'nothing was written');
  });
});

test('a file the specification no longer has is removed, and the revisions CHANGES.md gained are reported', async () => {
  await pair(async ({ spec, site, put, commit }) => {
    await vendor(spec, site);
    await fs.rm(path.join(spec, 'examples/e.json'));
    await put(spec, 'CHANGES.md', '# Changes\n\n## 2026-10-06 · two\n\n- b\n\n## 2026-10-05 · one\n\n- a\n');
    commit('two');
    const { write, remove, revisions } = await vendor(spec, site);
    assert.deepEqual([write, remove, revisions], [['CHANGES.md'], ['examples/e.json'], ['2026-10-06 · two']]);
    await assert.rejects(fs.access(path.join(site, 'examples/e.json')));
    assert.deepEqual(await verify(site), []);
  });
});

test('a check names each vendored file that differs from the checkout, or that the checkout lacks', async () => {
  await pair(async ({ spec, site, put }) => {
    await vendor(spec, site);
    assert.deepEqual(await vendorPlan(spec, site), { write: [], remove: [] });
    await put(site, 'SPEC.md', 'edited\n');
    await put(site, 'contract/stray.json', '{}\n');
    assert.deepEqual(await vendorPlan(spec, site), { write: ['SPEC.md'], remove: ['contract/stray.json'] });
  });
});

test('this website\'s vendored specification is the one spec.lock.json names', async () => {
  assert.deepEqual(await verify(ROOT), []);
  const lock = JSON.parse(await fs.readFile(path.join(ROOT, LOCK), 'utf8'));
  assert.equal(lock.repository, 'contextwindowarchitecture/contextwindowarchitecture');
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.ok(VENDORED.every(name => Object.keys(lock.files).some(f => f === name || f.startsWith(name + '/'))), 'every vendored path is locked');
});
