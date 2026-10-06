// Copies the specification from a checkout of the specification repository into this website, at the paths it has
// there. A first version, for Stage A of the spec-separation plan: it copies and removes, and writes no lock yet.
//   node scripts/vendor-spec.mjs ../contextwindowarchitecture
//   node scripts/vendor-spec.mjs ../contextwindowarchitecture --check   # exit 1 if this website differs
import fs from 'node:fs/promises';
import path from 'node:path';

// The specification's files, which the website takes as they are and never edits.
export const VENDORED = ['SPEC.md', 'CHANGES.md', 'schema', 'contract', 'conformance', 'examples', 'guides', 'implementations'];

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

/** What a vendor from the checkout at from would change in the website at to: files to write and files to remove. */
export async function vendorPlan(from, to) {
  const wanted = (await Promise.all(VENDORED.map(name => filesUnder(from, name)))).flat().sort();
  const held = (await Promise.all(VENDORED.map(name => filesUnder(to, name)))).flat().sort();
  const write = [];
  for (const name of wanted) {
    const [a, b] = await Promise.all([fs.readFile(path.join(from, name)), fs.readFile(path.join(to, name)).catch(() => null)]);
    if (b === null || !a.equals(b)) write.push(name);
  }
  return { write, remove: held.filter(name => !wanted.includes(name)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, flag] = process.argv.slice(2);
  if (!from || (flag !== undefined && flag !== '--check')) throw new Error('usage: node scripts/vendor-spec.mjs <specification checkout> [--check]');
  const { write, remove } = await vendorPlan(from, '.');
  if (flag === '--check') {
    for (const name of write) console.error(`differs: ${name}`);
    for (const name of remove) console.error(`not in the specification: ${name}`);
    if (write.length || remove.length) process.exit(1);
    console.log(`This website holds the specification as ${from} has it.`);
  } else {
    for (const name of write) { await fs.mkdir(path.dirname(name), { recursive: true }); await fs.copyFile(path.join(from, name), name); }
    for (const name of remove) await fs.rm(name);
    console.log(`Vendored from ${from}: ${write.length} written, ${remove.length} removed.`);
  }
}
