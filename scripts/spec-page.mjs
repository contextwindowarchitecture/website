// The Spec page renders SPEC.md, the normative text. A sync walks the page's blocks and SPEC.md's in step and rewrites
// only the prose blocks whose text SPEC.md changed, so a block nobody touched keeps its hand-set markup:
//   node scripts/spec-page.mjs --sync    # rewrite what SPEC.md changed
//   node scripts/spec-page.mjs --check   # exit 1 when the page, read back, differs from SPEC.md
// A changed block is re-rendered inside its own element. An added block is a new paragraph, or sub-heading, set as the
// nearest paragraph, or sub-heading, on the page is set; a removed block's element goes. The blocks between SPEC.md's
// generated markers are the build's: they come from the contract files, and the sync never writes them. The draft date
// and the changelog come from CHANGES.md, also through the build.
import fs from 'node:fs/promises';
import { specBlocks, specBody } from './spec-markdown.mjs';

const GENERATED = /<!-- generated:(\w+) -->\n\n([\s\S]*?)\n\n<!-- \/generated:\1 -->/g;
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** SPEC.md's blocks from its requirement index on: { md } for prose, { md, gen } for a block between markers. */
export function markdownBlocks(markdown) {
  const body = markdown.slice(markdown.indexOf('## Requirement index\n'));
  const out = [];
  const prose = text => text.split('\n\n').map(b => b.trim()).filter(Boolean).forEach(md => out.push(md === '## Requirement index' ? { md, kind: 'index' } : { md }));
  let at = 0;
  for (const m of body.matchAll(GENERATED)) {
    prose(body.slice(at, m.index));
    out.push({ md: m[2], gen: m[1] });
    at = m.index + m[0].length;
  }
  prose(body.slice(at));
  return out;
}

/** A Markdown line as the page marks it up: bold, links (the site's own made relative), requirement numbers linked. */
export function renderInline(md, site) {
  let html = '';
  let at = 0;
  for (const m of md.matchAll(/\\([\\*<])|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\b(R-\d+)\b/g)) {
    html += escapeHtml(md.slice(at, m.index));
    const [, escaped, strong, label, url, rule] = m;
    if (escaped) html += escapeHtml(escaped);
    else if (strong) html += `<strong>${renderInline(strong, site)}</strong>`;
    else if (label) html += url.startsWith(site) ? `<a href="./${url.slice(site.length)}">${renderInline(label, site)}</a>`
      : `<a href="${url}" target="_blank" rel="noopener">${renderInline(label, site)}</a>`;
    else html += `<a href="#${rule}">${rule}</a>`;
    at = m.index + m[0].length;
  }
  return html + escapeHtml(md.slice(at));
}

// The text inside a block's element: the Markdown without the marks that say what kind of block it is.
const content = (kind, md) => kind === 'heading' ? md.replace(/^## (\d+ )?/, '') : kind === 'subheading' ? md.replace(/^### /, '')
  : kind === 'label' ? md.replace(/^\*\*(.*)\*\*$/, '$1') : md;

/** The longest common subsequence of two lists of strings, as index pairs. */
function common(a, b) {
  const n = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) n[i][j] = a[i] === b[j] ? n[i + 1][j + 1] + 1 : Math.max(n[i + 1][j], n[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (n[i + 1][j] >= n[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * The page with its prose rewritten where SPEC.md's differs, and what changed. Throws when SPEC.md adds, drops or
 * moves a generated block, or when a block cannot be laid out by the default recipes; those need the page edited.
 * @param {{ html: string, markdown: string, requirements: object[], site: string }} source
 */
export function syncPage({ html, markdown, requirements, site }) {
  const page = specBlocks({ html, requirements, site }).blocks;
  const spec = markdownBlocks(markdown);
  const anchors = list => list.filter(b => b.gen || b.kind === 'index').map(b => b.gen ?? 'index');
  if (anchors(page).join() !== anchors(spec).join()) throw new Error(`SPEC.md's generated blocks (${anchors(spec).join(', ')}) are not the page's (${anchors(page).join(', ')}); lay the page out by hand.`);
  const runs = list => list.reduce((out, b) => { if (b.gen || b.kind === 'index') out.push([]); else out.at(-1).push(b); return out; }, []);
  const edits = [];
  const changed = [];
  const indentAt = at => html.slice(html.lastIndexOf('\n', at - 1) + 1, at);
  const recipe = (kind, near) => {
    const pick = page.filter(b => b.kind === kind && b.node);
    const same = pick.filter(b => b.section === near?.section);
    const from = (same.length ? same : pick).sort((x, y) => Math.abs(x.node.start - (near?.node.start ?? 0)) - Math.abs(y.node.start - (near?.node.start ?? 0)))[0];
    if (!from) throw new Error(`The page has no ${kind} to copy for a new block.`);
    return { open: html.slice(from.node.start, from.node.innerStart), close: `</${from.node.tag}>` };
  };
  const pageRuns = runs(page);
  runs(spec).forEach((run, r) => {
    const blocks = pageRuns[r];
    const pairs = common(blocks.map(b => b.md), run.map(b => b.md));
    let i = 0, j = 0;
    for (const [pi, mj] of [...pairs, [blocks.length, run.length]]) {
      const gone = blocks.slice(i, pi), added = run.slice(j, mj);
      gone.slice(0, added.length).forEach((block, k) => {
        edits.push({ start: block.node.innerStart, end: block.node.innerEnd, text: renderInline(content(block.kind, added[k].md), site) });
        changed.push(`changed: ${added[k].md.slice(0, 70)}`);
      });
      for (const block of gone.slice(added.length)) {
        const lineStart = html.lastIndexOf('\n', block.node.start - 1) + 1;
        const whole = /^\s*$/.test(html.slice(lineStart, block.node.start)) && html[block.node.end] === '\n';
        edits.push({ start: whole ? lineStart : block.node.start, end: whole ? block.node.end + 1 : block.node.end, text: '' });
        changed.push(`removed: ${block.md.slice(0, 70)}`);
      }
      const extra = added.slice(gone.length);
      if (extra.length) {
        const before = blocks[pi - 1] ?? null, after = gone.length ? null : blocks[pi] ?? null;
        const near = before ?? after;
        if (!near) throw new Error(`Nowhere to put a new block between generated blocks: ${extra[0].md.slice(0, 70)}; lay the page out by hand.`);
        const elements = extra.map(b => {
          const kind = b.md.startsWith('### ') ? 'subheading' : 'paragraph';
          const { open, close } = recipe(kind, near);
          return open + renderInline(content(kind, b.md), site) + close;
        });
        extra.forEach(b => changed.push(`added: ${b.md.slice(0, 70)}`));
        if (before) {
          const indent = indentAt(before.node.start);
          edits.push({ start: before.node.end, end: before.node.end, text: elements.map(e => `\n${indent}${e}`).join('') });
        } else {
          const indent = indentAt(after.node.start);
          edits.push({ start: after.node.start, end: after.node.start, text: elements.map(e => `${e}\n${indent}`).join('') });
        }
      }
      i = pi + 1; j = mj + 1;
    }
  });
  let out = html;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const read = specBlocks({ html: out, requirements, site });
  const want = spec.map(b => b.md), got = read.blocks.map(b => b.md);
  const at = want.findIndex((md, k) => md !== got[k]);
  if (at >= 0 || want.length !== got.length) throw new Error(`After a sync the page still reads differently at: ${(want[at] ?? got[want.length] ?? '').slice(0, 80)}; lay that block out by hand.`);
  return { html: out, changed };
}

/** Whether the page, read back, says exactly what SPEC.md says from its requirement index on, on the same date. */
export function pageMatches({ html, markdown, requirements, site }) {
  const { date, blocks } = specBlocks({ html, requirements, site });
  return blocks.map(b => b.md).join('\n\n') + '\n' === specBody(markdown) && markdown.includes(`\nDraft of ${date}, `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sync = process.argv.includes('--sync');
  if (!sync && !process.argv.includes('--check')) throw new Error('usage: node scripts/spec-page.mjs --sync | --check');
  const source = {
    html: await fs.readFile('spec.html', 'utf8'), markdown: await fs.readFile('SPEC.md', 'utf8'),
    requirements: JSON.parse(await fs.readFile('contract/requirements.json', 'utf8')), site: `https://${(await fs.readFile('CNAME', 'utf8')).trim()}/`,
  };
  if (sync) {
    const { html, changed } = syncPage(source);
    if (changed.length) await fs.writeFile('spec.html', html);
    console.log(changed.length ? changed.join('\n') : 'The Spec page already says what SPEC.md says.');
  } else if (!pageMatches(source)) {
    console.error('The Spec page differs from SPEC.md; run node scripts/spec-page.mjs --sync, then npm run build:contract.');
    process.exit(1);
  } else console.log('The Spec page says what SPEC.md says.');
}
