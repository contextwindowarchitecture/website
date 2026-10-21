// The home page's example blocks, written by npm run build:contract from the files scripts/vendor-examples.mjs vendors:
// the 01-docs-qa bot's request code before and after CWA, as excerpts of its own source, and what `uv run after.py`
// prints for two committed scenarios: the trace table, the request as sent, and the refusal. The measured slide's
// numbers come from site/measured.json, which names the benchmark run they were read from. Each block sits between
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

// Code wraps instead of scrolling sideways: each line is a block of its own, and a long one hangs its continuation
// four columns in from where its code starts. A blank line keeps its height.
export const codeLines = text => text.split('\n').map(line => {
  if (line.trim() === '') return '<span style="display: block; height: 1.55em;"></span>';
  const hang = line.match(/^ */)[0].length + 4;
  return `<span style="display: block; padding-left: ${hang}ch; text-indent: -${hang}ch;">${escapeHtml(line)}</span>`;
}).join('');

/**
 * A bordered panel with a header row and a <pre> that never scrolls sideways (STYLE.md, Panels and Code). Code wraps
 * under a hanging indent; prose, such as the request's message text, wraps as text does.
 */
export function panel({ label, meta, text, prose = false }) {
  if (text.includes('{{')) throw new Error(`${label}: "{{" would read as a template binding.`);
  return '<div style="border: 1px solid var(--line); background: var(--bg); min-width: 0;">' +
    // On a narrow screen the two labels wrap as wholes, the second under the first, instead of each breaking in two.
    '<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 12px 18px; border-bottom: 1px solid var(--line); font-family: var(--mono); color: var(--muted); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;">' +
    `<span style="white-space: nowrap;">${escapeHtml(label)}</span><span style="white-space: nowrap;">${escapeHtml(meta)}</span></div>` +
    `<pre style="padding: 14px 16px; margin: 0; font-family: var(--mono); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere;">${prose ? escapeHtml(text.trimEnd()) : codeLines(text.trimEnd())}</pre></div>`;
}

// What each code panel shows: build_request() in both apps. The caption names before.py's two limits, TOP_K and
// MAX_HISTORY_MESSAGES, and a test holds it to them. The CWA version's work moves into context.py, which builds the
// snapshot; the slide links it.
export const BEFORE = { file: '01-docs-qa/before.py', prefixes: ['def build_request('] };
export const AFTER = { file: '01-docs-qa/after.py', prefixes: ['def build_request('] };
// The Assembler page's harness section shows the handoff: assemble, stop on a refusal, pass the payload to the SDK.
export const HANDOFF = { file: '01-docs-qa/after.py', prefixes: ['def answer('] };

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

/**
 * A cwa-messages/v1 payload as after.py hands it to the SDK, printed the way cli.show_request() prints a dry run: the
 * system entries, the tools if there are any, then the messages.
 */
export function request(payload) {
  return [...payload.system.map(entry => `── system ──\n${entry.text}`), ...(payload.tools ?? []).map(tool => `── tool ──\n${tool.text}`),
    ...payload.messages.map(m => `── ${m.role} ──\n${m.content}`)].join('\n\n');
}

/** Placement's request panel: the specification's example request, which the profile the page shows rendered. */
export function profileRequestBlock({ profile, snapshot, payload }) {
  if (snapshot.profile.id !== profile.id || snapshot.profile.version !== profile.version) {
    throw new Error(`examples/messages-snapshot.json uses ${snapshot.profile.id}/v${snapshot.profile.version}, not the profile Placement shows (${profile.id}/v${profile.version}).`);
  }
  return { PROFILE_REQUEST: panel({ label: `request · ${snapshot.renderer}`, meta: `${profile.id}/v${profile.version}`, text: request(payload), prose: true }) };
}

const PLANE_COLOUR = { governance: 'var(--p-gov)', state: 'var(--p-state)', evidence: 'var(--p-evid)', interaction: 'var(--p-inter)' };
const mono = 'font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em;';
const label = text => `<div style="${mono} letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);">${text}</div>`;

/**
 * What the model received, drawn as the old slides drew a request: a window of bars in plane colours, one per item the
 * trace says was sent, in the order the profile renders them (by placement, then id), each labelled with how it was
 * wrapped and its tokens; the budget as a fill bar; and each item left out as a dashed bar with its reason. Every
 * label and size comes from the scenario's snapshot and trace.
 */
export function requestWindow({ snapshot, trace }) {
  const placement = snapshot.profile.placement;
  const at = slot => placement.findIndex(p => p.slot === slot);
  const items = new Map(snapshot.batches.flatMap(batch => batch.items).map(item => [item.id, item]));
  const sent = [...trace.included].sort((a, b) => at(a.slot) - at(b.slot) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
  const wrap = slot => placement[at(slot)].wrap;
  // A tagged item shows its tag, as the model reads it; a system or tool entry has no tag, so it shows its id.
  const tag = row => wrap(row.slot).startsWith('xml:') ? `<${wrap(row.slot).slice(4)} id="${row.item_id}">` : row.item_id;
  const bar = row => `<div style="height: ${28 + Math.round(row.tokens * 0.3)}px; background: ${PLANE_COLOUR[row.slot.split('.')[0]]}; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 0 10px; ${mono} color: var(--bg);">` +
    `<span style="overflow-wrap: anywhere;">${escapeHtml(tag(row))}</span><span style="white-space: nowrap;">${row.tokens} tok</span></div>`;
  // The system entries, then the one user message every other text goes into (cwa-messages/v1).
  const groups = [['System message', sent.filter(r => wrap(r.slot) === 'system')], ['One user message', sent.filter(r => wrap(r.slot).startsWith('xml:'))]];
  const { input } = trace.budget, used = trace.result.input_tokens;
  // Why it was left out, in words: the reason code, and for a relevance threshold the score against it.
  const why = row => {
    const item = items.get(row.item_id) ?? {};
    const floor = snapshot.route_policy.slots?.[row.slot]?.min_relevance;
    const reason = row.reason.replaceAll('_', ' ');
    return row.reason === 'below_threshold' && item.relevance != null && floor != null ? `${reason} · relevance ${g(item.relevance)}, needs ${floor.toFixed(1)}` : reason;
  };
  return '<div style="display: flex; flex-direction: column; gap: 10px;">' +
    `<div style="display: flex; justify-content: space-between; gap: 12px;">${label('What the model received')}${label(`${used} of ${input.toLocaleString('en-US')} tokens`)}</div>` +
    '<div style="border: 1px solid var(--fg); background: var(--bg); padding: 10px; display: flex; flex-direction: column; gap: 6px;">' +
    groups.filter(([, rows]) => rows.length).map(([name, rows]) => `<div style="${mono} color: var(--muted); padding: 2px 0;">${name}</div>` + rows.map(bar).join('')).join('') + '</div>' +
    `<div aria-hidden="true" style="display: flex; height: 8px; gap: 1px; background: var(--line);"><div style="width: ${(100 * used / input).toFixed(1)}%; background: var(--fg);"></div><div style="flex: 1; background: var(--surface);"></div></div>` +
    `<div style="margin-top: 6px;">${label('Left out')}</div>` +
    trace.excluded.map(row => `<div style="border: 1px dashed ${PLANE_COLOUR[row.slot.split('.')[0]]}; padding: 7px 10px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; ${mono} color: var(--muted);">` +
      `<span>${escapeHtml(row.item_id)}</span><span>${escapeHtml(why(row))}</span></div>`).join('') +
    '</div>';
}

/** The vendored files and their lock, read from the website at root. */
export async function exampleFiles(root = '.') {
  const text = name => fs.readFile(path.join(root, DIR, name), 'utf8');
  const json = async name => JSON.parse(await text(name));
  const scenario = async (name, files) => Object.fromEntries(await Promise.all(files.map(async f => [f, await json(`01-docs-qa/scenarios/${name}/${f}.json`)])));
  return {
    lock: JSON.parse(await fs.readFile(path.join(root, LOCK), 'utf8')), before: await text(BEFORE.file), after: await text(AFTER.file),
    answered: await scenario('01-answer', ['snapshot', 'trace', 'payload']), refused: await scenario('03-off-topic', ['snapshot', 'trace']),
  };
}

/** Every example block's markup, by name. */
export function exampleBlocks({ lock, before, after, answered, refused }) {
  const tree = `https://github.com/${lock.repository}/tree/${lock.commit}/01-docs-qa`;
  return {
    EXAMPLE_BEFORE: panel({ label: 'before.py', meta: 'build_request()', text: excerpt(before, BEFORE.prefixes) }),
    EXAMPLE_AFTER: panel({ label: 'after.py', meta: 'build_request()', text: excerpt(after, AFTER.prefixes) }),
    EXAMPLE_COMMIT: `<a href="https://github.com/${lock.repository}/blob/${lock.commit}/01-docs-qa/context.py" target="_blank" rel="noopener" style="font-family: var(--mono); font-size: 13px; color: var(--accent);">Where the snapshot is built: context.py →</a>` +
      `<a href="${tree}" target="_blank" rel="noopener" style="font-family: var(--mono); font-size: 13px; color: var(--accent);">The whole app, at ${lock.commit.slice(0, 7)} →</a>`,
    EXAMPLE_PAYLOAD: panel({ label: 'request · cwa-messages/v1', meta: answered.payload.tools.length ? `${answered.payload.tools.length} tools` : 'no tools on this route',
      text: request(answered.payload), prose: true }),
    EXAMPLE_WINDOW: requestWindow(answered),
    EXAMPLE_RUN: door(`https://github.com/${lock.repository}/tree/${lock.commit}/01-docs-qa#readme`, 'Running it', 'Run it yourself →',
      'In 01-docs-qa: <span style="font-family: var(--mono); font-size: 12.5px; color: var(--fg);">uv run after.py "How do I export all my projects?"</span>. No API key needed.'),
    EXAMPLE_REFUSAL: `<pre style="padding: 14px 18px; margin: 0; border: 1px solid var(--line); background: var(--bg); font-family: var(--mono); font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;">${escapeHtml(report(refused.snapshot, refused.trace).split('\n')[0])}</pre>`,
  };
}

// The door to running the example, at the locked commit; a hairline-grid cell like the spec's door beside it.
const door = (href, label, title, copy) => `<a href="${href}" target="_blank" rel="noopener" style="background: var(--bg); padding: 16px 20px; display: flex; flex-direction: column; gap: 6px; color: var(--fg);" style-hover="background: var(--accent-soft);">` +
  `<span style="font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent);">${label}</span>` +
  `<span style="font-size: 17px; font-weight: 600; letter-spacing: -0.015em;">${title}</span>` +
  `<span style="font-size: 13.5px; line-height: 1.5; color: var(--muted); text-wrap: pretty;">${copy}</span></a>`;

/** An arm's share, to two places; a row with several arms shows their range. */
export function share(arms) {
  const values = arms.map(a => a.numerator / a.denominator).sort((a, b) => a - b).map(v => v.toFixed(2));
  return values[0] === values[values.length - 1] ? values[0] : `${values[0]}–${values[values.length - 1]}`;
}

/** The measured slide's rows and source links, from site/measured.json. */
export function measuredBlocks({ source, rows }) {
  const writeUp = `https://github.com/${source.repository}/blob/${source.commit}/${source.path}`;
  return {
    // Each row: the share, what produced it, and a bar on a 0-to-1 scale (a range shows its upper part lighter).
    MEASURED: '<div style="border-bottom: 1px solid var(--line);">' + rows.map((row, i) => {
      const values = row.arms.map(a => a.numerator / a.denominator).sort((a, b) => a - b);
      const low = (100 * values[0]).toFixed(1), high = (100 * (values[values.length - 1] - values[0])).toFixed(1);
      const colour = i === 0 ? 'var(--accent)' : 'var(--muted)';
      return '<div style="padding: 14px 0; border-top: 1px solid var(--line);">' +
        `<div style="font-family: var(--mono); font-size: clamp(26px, 3vw, 36px); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; white-space: nowrap; color: ${i === 0 ? 'var(--accent)' : 'var(--fg)'};">${share(row.arms)}</div>` +
        `<div style="margin-top: 4px; font-size: 15px; line-height: 1.4; color: var(--fg);">${escapeHtml(row.label)}</div>` +
        `<div aria-hidden="true" style="display: flex; height: 6px; margin-top: 10px; background: var(--line);"><div style="width: ${low}%; background: ${colour};"></div>` +
        (Number(high) > 0 ? `<div style="width: ${high}%; background: ${colour}; opacity: 0.4;"></div>` : '') + '</div></div>';
    }).join('') + '</div>',
    MEASURED_SOURCE: `<a href="${writeUp}#${source.anchor}" target="_blank" rel="noopener" style="font-family: var(--mono); font-size: 13px; color: var(--accent);">The write-up, with intervals →</a>` +
      `<a href="${writeUp}#${source.replay_anchor}" target="_blank" rel="noopener" style="font-family: var(--mono); font-size: 13px; color: var(--accent);">Every number replays from the committed model cache, without a GPU →</a>`,
  };
}

/** The Assembler page's blocks: after.py's answer(), and a link to providers.py, which makes the SDK call. */
export function handoffBlocks({ lock, after }) {
  return {
    EXAMPLE_HANDOFF: panel({ label: 'after.py', meta: 'answer()', text: excerpt(after, HANDOFF.prefixes) }),
    EXAMPLE_PROVIDERS: `<a href="https://github.com/${lock.repository}/blob/${lock.commit}/01-docs-qa/providers.py" target="_blank" rel="noopener" style="font-family: var(--mono); font-size: 13px; color: var(--accent);">The SDK call, with the official Anthropic and OpenAI SDKs: providers.py →</a>`,
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
