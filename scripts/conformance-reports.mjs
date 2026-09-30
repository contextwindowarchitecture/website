// The conformance reports the Assembler page shows, one per implementation, and how the build counts them
// against the published cases (conformance/README.md, Reporting results).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const IMPLEMENTATIONS = [
  { label: 'Python', file: 'contract/assembler-conformance.json' },
  { label: 'TypeScript', file: 'contract/assembler-ts-conformance.json' },
  { label: 'Go', file: 'contract/assembler-go-conformance.json' },
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// A case's digest: SHA-256 over its files' names and SHA-256s, in name order.
const digest = files => sha256(JSON.stringify(files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, bytes]) => [name, sha256(bytes)])));

/** Each published case's and rejection case's digest as its files are now, keyed by case id. */
export async function caseDigestsNow(root = '.') {
  const digests = {};
  for (const dir of ['cases', 'rejections']) {
    const base = path.join(root, 'conformance', dir);
    for (const id of await fs.readdir(base).catch(() => [])) {
      const names = await fs.readdir(path.join(base, id));
      digests[id] = digest(await Promise.all(names.map(async name => [name, await fs.readFile(path.join(base, id, name))])));
    }
  }
  return digests;
}

/** Each case's digest as its files were at a website commit, read from git, keyed by case id. */
export function caseDigestsAt(commit, root = '.') {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 28 });
  const byCase = new Map();
  for (const file of git('ls-tree', '-r', '--name-only', commit, '--', 'conformance/cases', 'conformance/rejections').toString('utf8').split('\n').filter(Boolean)) {
    const [, , id, name] = file.split('/');
    byCase.set(id, [...(byCase.get(id) ?? []), [name, git('show', `${commit}:${file}`)]]);
  }
  return Object.fromEntries([...byCase].map(([id, files]) => [id, digest(files)]));
}

/**
 * Each published case's outcome in a report: passed (or, for a rejection case, rejected), failed, stale when the
 * case changed after the run, or not run when the report lacks it. atRun is null when the run cannot be tied to
 * a clean website commit, and then every case the report has is stale.
 */
export function tally(report, atRun, published) {
  const outcomes = new Map([...report.cases.map(c => [c.id, c.outcome === 'passed']), ...(report.rejections ?? []).map(c => [c.id, c.outcome === 'rejected'])]);
  return new Map(published.map(c => [c.id,
    !outcomes.has(c.id) ? 'not run' : atRun?.[c.id] !== c.digest ? 'stale' : outcomes.get(c.id) ? 'passed' : 'failed']));
}

/**
 * A reference assembler's status claims under this site's scopes (contract/assembler-scope.json). implemented means
 * tests exercise every clause of an assembler row, so on a row the site has since scoped boundary, a narrower scope,
 * the same tests prove boundary-checked. Nothing is widened: boundary-checked on an assembler row stays, and the
 * build rejects it.
 */
export function claimsUnder(scopes, claims) {
  const scope = new Map(scopes.map(s => [s.id, s.scope]));
  return claims.map(c => c.status === 'implemented' && scope.get(c.id) === 'boundary' ? { ...c, status: 'boundary-checked' } : c);
}

/** A remote URL as owner/repo when it is on GitHub, over HTTPS or SSH; any other URL as given; null for none. */
export function repositoryOf(url) {
  if (!url) return null;
  const github = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return github ? `${github[1]}/${github[2]}` : url;
}

/** A checkout's origin remote as repositoryOf names it, or null when it has none. */
export function remoteOf(checkout) {
  try {
    return repositoryOf(execFileSync('git', ['-C', checkout, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return null;
  }
}

/** A report as the website stores it: { source, cases_at_run, report }. source names the implementation's checkout,
 * cases_at_run holds the digests of the cases as they were at the website commit it ran against, and report is the
 * implementation's conformance-report.json untouched, so it validates against conformance_report.schema.json on its own. */
export function imported(source, report, root = '.') {
  const atRun = report.contract.dirty ? null : caseDigestsAt(report.contract.website_commit, root);
  return { source, cases_at_run: atRun, report };
}
