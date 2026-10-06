// The conformance reports the Assembler page shows, one per implementation listed in implementations/index.json, and
// how the build counts them against the published cases (conformance/README.md, Reporting results). The reports are
// imported, and checked, by conformance/import_report.py and conformance/check.py.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Each listed implementation: its id, the label the page gives it, and the file that stores its report. */
export async function implementations(root = '.') {
  const index = JSON.parse(await fs.readFile(path.join(root, 'implementations', 'index.json'), 'utf8'));
  return index.map(({ id, label }) => ({ id, label, file: `implementations/${id}.json` }));
}

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

/**
 * Each published case's outcome in a report: passed (or, for a rejection case, rejected), failed, stale when the
 * case changed after the run, or not run when the report lacks it. atRun is null when the run cannot be tied to
 * a clean commit, and then every case the report has is stale.
 */
export function tally(report, atRun, published) {
  const outcomes = new Map([...report.cases.map(c => [c.id, c.outcome === 'passed']), ...(report.rejections ?? []).map(c => [c.id, c.outcome === 'rejected'])]);
  return new Map(published.map(c => [c.id,
    !outcomes.has(c.id) ? 'not run' : atRun?.[c.id] !== c.digest ? 'stale' : outcomes.get(c.id) ? 'passed' : 'failed']));
}

/** The commit a report's cases came from. A report written before the contract member named its repository calls it
 * website_commit. */
export const ranAt = report => report?.contract?.commit ?? report?.contract?.website_commit;
