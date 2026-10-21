// The home page's example blocks, written by npm run build:contract from the files scripts/vendor-examples.mjs vendors:
// the 01-docs-qa bot's request code before and after CWA, as excerpts of its own source, and what `uv run after.py`
// prints for two committed scenarios: the trace table, the request as sent, and the refusal. Each block sits between
// <!-- NAME_START --> and <!-- NAME_END --> in index.html and is never edited by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DIR, LOCK } from './vendor-examples.mjs';

const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The top-level Python statements that start with one of the prefixes, in source order. A statement runs from its
 * top-level line to the next one, less trailing blank lines; a line that only closes a bracket belongs to it. Single
 * lines that follow each other stay together, and anything longer is set apart by a blank line.
 */
export function excerpt(source, prefixes) {
  const lines = source.split('\n');
  const top = i => lines[i] !== '' && !/^[\s)\]}]/.test(lines[i]);
  const starts = new Set();
  for (const prefix of prefixes) {
    const at = lines.map((line, i) => i).filter(i => top(i) && lines[i].startsWith(prefix));
    if (at.length === 0) throw new Error(`No top-level statement starts with "${prefix}".`);
    at.forEach(i => starts.add(i));
  }
  const blocks = [...starts].sort((a, b) => a - b).map(start => {
    let end = start + 1;
    while (end < lines.length && !top(end)) end++;
    while (end > start + 1 && lines[end - 1].trim() === '') end--;
    return lines.slice(start, end);
  });
  return blocks.reduce((text, block, i) => i === 0 ? block.join('\n')
    : text + (block.length === 1 && blocks[i - 1].length === 1 ? '\n' : '\n\n') + block.join('\n'), '');
}

/**
 * A bordered panel with a header row and a keyboard-scrollable <pre> (STYLE.md, Panels and Code). Code and the trace
 * keep their columns and scroll sideways; wrap is for prose, such as the request's message text.
 */
export function panel({ label, meta, aria, text, wrap = false }) {
  if (text.includes('{{')) throw new Error(`${label}: "{{" would read as a template binding.`);
  return '<div style="border: 1px solid var(--line); background: var(--bg); min-width: 0;">' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; padding: 12px 18px; border-bottom: 1px solid var(--line); font-family: var(--mono); color: var(--muted); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;">' +
    `<span>${escapeHtml(label)}</span><span>${escapeHtml(meta)}</span></div>` +
    `<pre tabindex="0" aria-label="${escapeHtml(aria)}" style="padding: 18px; overflow: auto; margin: 0; font-family: var(--mono); font-size: 12.5px; line-height: 1.6;${wrap ? ' white-space: pre-wrap; overflow-wrap: anywhere;' : ''}">${escapeHtml(text.trimEnd())}</pre></div>`;
}

// What each code panel shows: the statements build_request() and its CWA counterpart are made of.
export const BEFORE = { file: '01-docs-qa/before.py', prefixes: ['TOP_K =', 'MAX_HISTORY_MESSAGES =', 'def build_request('] };
export const AFTER = { file: '01-docs-qa/context.py', prefixes: ['from cwa import', 'def snapshot(', 'def assemble('] };

// Python's "{:g}": six significant digits, no trailing zeros.
const g = n => String(Number(n.toPrecision(6)));

/** The trace as after.py's report() prints it: one row per candidate, sent (+) or left out (-) with its reason. */
export function report(snapshot, trace) {
  const candidates = new Map(snapshot.batches.flatMap(batch => batch.items).map(item => [item.id, item]));
  const score = id => candidates.get(id)?.relevance == null ? '' : `  relevance ${g(candidates.get(id).relevance)}`;
  const lines = [];
  if (trace.refused.bool) {
    const recovery = trace.recovery?.action;
    lines.push(`refused: ${trace.refused.reason}${recovery ? `, recovery ${recovery}` : ''}. No request is sent.`);
  } else {
    const { budget, profile, result } = trace;
    const margin = budget.margin_percent ? ` with a ${budget.margin_percent}% margin` : '';
    lines.push(`assembled ${profile.id} v${profile.version}: ${result.input_tokens} input tokens of ${budget.input}${margin}, sha256 ${result.hash.slice(0, 12)}`);
  }
  for (const row of trace.included) lines.push(`  + ${row.slot.padEnd(24)} ${row.item_id.padEnd(28)} ${String(row.tokens).padStart(4)} tokens${score(row.item_id)}`);
  for (const row of trace.excluded) lines.push(`  - ${(row.slot || candidates.get(row.item_id)?.slot || '').padEnd(24)} ${row.item_id.padEnd(28)} ${row.reason}${score(row.item_id)}`);
  return lines.join('\n');
}

/** A cwa-messages/v1 payload as after.py hands it to the SDK, printed the way cli.show_request() prints a dry run. */
export function request(payload) {
  return [...payload.system.map(entry => `── system ──\n${entry.text}`), ...payload.messages.map(m => `── ${m.role} ──\n${m.content}`)].join('\n\n');
}

/** The vendored files and their lock, read from the website at root. */
export async function exampleFiles(root = '.') {
  const text = name => fs.readFile(path.join(root, DIR, name), 'utf8');
  const json = async name => JSON.parse(await text(name));
  const scenario = async (name, files) => Object.fromEntries(await Promise.all(files.map(async f => [f, await json(`01-docs-qa/scenarios/${name}/${f}.json`)])));
  return {
    lock: JSON.parse(await fs.readFile(path.join(root, LOCK), 'utf8')), before: await text(BEFORE.file), context: await text(AFTER.file),
    answered: await scenario('01-answer', ['snapshot', 'trace', 'payload']), refused: await scenario('03-off-topic', ['snapshot', 'trace']),
  };
}

/** Every example block's markup, by name. */
export function exampleBlocks({ lock, before, context, answered, refused }) {
  const tree = `https://github.com/${lock.repository}/tree/${lock.commit}/01-docs-qa`;
  return {
    EXAMPLE_BEFORE: panel({ label: 'before.py', meta: 'build_request()', aria: 'before.py: how the bot builds a request without CWA', text: excerpt(before, BEFORE.prefixes) }),
    EXAMPLE_AFTER: panel({ label: 'context.py', meta: 'snapshot() · assemble()', aria: 'context.py: how the same bot builds a request with CWA', text: excerpt(context, AFTER.prefixes) }),
    EXAMPLE_COMMIT: `<a href="${tree}" target="_blank" rel="noopener" style="font-family: var(--mono); font-size: 13px; color: var(--accent);">The whole app, at ${lock.commit.slice(0, 7)} →</a>`,
    EXAMPLE_PAYLOAD: panel({ label: 'request · cwa-messages/v1', meta: answered.payload.tools.length ? `${answered.payload.tools.length} tools` : 'no tools on this route', aria: 'The request the model receives',
      text: request(answered.payload), wrap: true }),
    EXAMPLE_TRACE: panel({ label: 'trace', meta: 'as after.py prints it', aria: 'The trace: what was sent and what was left out', text: report(answered.snapshot, answered.trace) }),
    EXAMPLE_REFUSAL: `<pre tabindex="0" aria-label="The refusal" style="padding: 14px 18px; overflow: auto; margin: 0; border: 1px solid var(--line); background: var(--bg); font-family: var(--mono); font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;">${escapeHtml(report(refused.snapshot, refused.trace).split('\n')[0])}</pre>`,
  };
}

/** The page with each named block rewritten; a page that lacks a block's markers is an error, not a no-op. */
export function writeBlocks(html, blocks, page = 'index.html') {
  for (const [name, content] of Object.entries(blocks)) {
    const pattern = new RegExp(`<!-- ${name}_START -->[\\s\\S]*?<!-- ${name}_END -->`);
    if (!pattern.test(html)) throw new Error(`${page} has no ${name} block to write.`);
    html = html.replace(pattern, () => `<!-- ${name}_START -->${content}<!-- ${name}_END -->`);
  }
  return html;
}
