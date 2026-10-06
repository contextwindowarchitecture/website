// The Spec page read back as Markdown: its requirement index, sections 1 to 6 and Future work, block by block. SPEC.md
// is the normative text and the page renders it, so this is the check that the page says what SPEC.md says
// (tests/website.test.mjs) and the reading scripts/spec-page.mjs syncs the page against. Prose is taken from the page's
// markup in the order it stands there, and each list a template fills in is written from the values the page's
// component gives that template. Markup this file does not know stops it, so nothing on the page is left out silently.
import vm from 'node:vm';

const INLINE = new Set(['a', 'b', 'code', 'em', 'i', 'span', 'strong']);
// A short line that opens a card on the page names the card; anything longer is the card's text.
const LABEL_LENGTH = 40;
const decode = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
// What Markdown would take for markup in plain text: an escape, emphasis, an HTML tag. conformance/check.py escapes
// the text it writes into SPEC.md the same way.
export const escape = text => text.replace(/[\\*<]/g, '\\$&');
const code = text => '`' + text + '`';
const table = (head, rows) => [head, head.map(() => '---'), ...rows]
  .map(row => `| ${row.map(cell => String(cell).replaceAll('|', '\\|')).join(' | ')} |`).join('\n');

// SPEC.md marks each block written from the contract files, so a reader knows not to edit it there.
export const MARKER = /^<!-- \/?generated:(\w+) -->\n\n/gm;
export const marked = (name, md) => `<!-- generated:${name} -->\n\n${md}\n\n<!-- /generated:${name} -->`;
/** SPEC.md from its requirement index on, without its markers: what the page, read back, must equal. */
export const specBody = markdown => markdown.slice(markdown.indexOf('## Requirement index\n')).replace(MARKER, '');

/** The page's markup as a tree, each element with where it starts and ends in the whole page. */
function parse(html, base) {
  const root = { tag: '', attrs: '', children: [] };
  const open = [root];
  let read = 0;
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<\/([\w-]+)>|<([\w-]+)((?:"[^"]*"|[^">])*)>|[^<]+/g)) {
    if (m.index !== read) break;
    read += m[0].length;
    const [text, closing, tag, attrs] = m;
    if (closing) {
      const node = open.pop();
      if (open.length === 0 || node.tag !== closing) throw new Error(`spec.html: </${closing}> closes nothing open.`);
      Object.assign(node, { innerEnd: base + m.index, end: base + read });
    } else if (tag) {
      const node = { tag, attrs, children: [], start: base + m.index, innerStart: base + read };
      open.at(-1).children.push(node);
      open.push(node);
    } else if (!text.startsWith('<!--')) open.at(-1).children.push(text);
  }
  if (read !== html.length || open.length !== 1) throw new Error('spec.html: a section is not well-formed markup.');
  return root;
}

const isJson = text => { try { JSON.parse(text); return true; } catch { return false; } };
const isText = node => typeof node === 'string';
const isInline = node => isText(node) || (INLINE.has(node.tag) && node.children.every(isInline));
// A block that holds words and inline marks only: a paragraph, heading, label or line of a card.
const isLeaf = node => node.children.every(isInline);

/**
 * The page's blocks in order. Each is { md, kind, node } for prose, kind one of heading, paragraph, subheading, label
 * or line, or { md, gen, node } for a block the build writes from the contract files: a list a template fills in,
 * named as the template names it, or the profile example. node is the page element it was read from.
 * @param {{ html: string, requirements: { id: string, summary: string, text: string }[], site: string }} source
 *   the Spec page as built, the requirements it embeds, and the address its relative links resolve against
 */
export function specBlocks({ html, requirements, site }) {
  const script = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const vals = JSON.parse(JSON.stringify(vm.runInNewContext(script + '\nnew Component().renderVals()', { DCLogic: class {} })));
  const requirement = Object.fromEntries(requirements.map(r => [r.id, r]));
  const rules = rows => rows.map(({ id }) => `### ${id}: ${escape(requirement[id].summary)}\n\n${escape(requirement[id].text)}`).join('\n\n');
  const names = fields => fields.map(code).join(', ');
  const lists = {
    index: rows => table(['Requirement', 'Keyword', 'Summary'], rows.map(r => [r.id, r.kw, escape(requirement[r.id].summary)])),
    planes: rows => table(['Plane', 'Answers', 'Slots'], rows.map(p => [p.name, escape(p.answers), names(p.slots)])),
    slots: rows => rows.map(s => `- ${code(s.id)}: ${escape(s.holds)} ${escape(s.rule)}`).join('\n'),
    mustFields: names,
    shouldFields: names,
    itemFields: rows => rows.map(f => `- **${escape(f.key)}**: ${escape(f.text)}`).join('\n'),
    authority: rows => table(['Role', 'Authority', 'Meaning'], rows.map(a => [escape(a.name), code(a.value), escape(a.text)])),
    conflicts: rows => table(['When', 'Then'], rows.map(c => [escape(c.when), escape(c.then)])),
    stages: rows => rows.map((s, i) => `${i + 1}. **${escape(s.name)}**: ${escape(s.text)}`).join('\n'),
    tests: rows => table(['Test', 'What it shows', 'Requirement'], rows.map(t => [escape(t.name), escape(t.text), t.rule])),
    rulesModel: rules, rulesGov: rules, rulesFit: rules, rulesProf: rules, rulesTrace: rules,
  };
  const list = node => {
    const name = node.attrs.match(/list="\{\{ (\w+) \}\}"/)?.[1];
    if (!(name in lists) || !Array.isArray(vals[name])) throw new Error(`spec.html: no Markdown is defined for the list ${name}.`);
    return { md: lists[name](vals[name]), gen: name, node };
  };

  const mark = node => {
    const text = inline(node);
    if (node.tag === 'strong' || node.tag === 'b') return `**${text}**`;
    if (node.tag !== 'a') return text;
    // A link to a requirement stays the requirement's number, as it is wherever a requirement cites another.
    const href = node.attrs.match(/href="([^"]*)"/)?.[1] ?? '#';
    return href.startsWith('#') ? text : `[${text}](${href.startsWith('./') ? site + href.slice(2) : href})`;
  };
  const inline = node => {
    // Elements with no text between them are separate labels on the page, not one run of words.
    const said = node.children.filter(child => !isText(child) || child.trim());
    const apart = said.length > 1 && !said.some(isText);
    return (apart ? said : node.children).map(child => isText(child) ? escape(decode(child)) : mark(child)).join(apart ? ' · ' : '');
  };
  const text = node => {
    const said = inline(node).replace(/\s+/g, ' ').trim();
    if (said.includes('{{')) throw new Error(`spec.html: a template value is written into prose: ${said.slice(0, 60)}`);
    return said;
  };

  const blocks = (node, out, section) => {
    const elements = node.children.filter(child => !isText(child));
    for (const child of node.children) {
      if (isText(child)) {
        if (child.trim()) throw new Error(`spec.html: text outside any paragraph: ${child.trim().slice(0, 60)}`);
      } else if (child.tag === 'h2') out.push({ md: `## ${section.number} ${text(child)}`, kind: 'heading', node: child });
      else if (child.tag === 'p') out.push({ md: text(child), kind: 'paragraph', node: child });
      else if (child.tag === 'pre') {
        if (!child.children.every(isText)) throw new Error('spec.html: a pre block holds markup.');
        const body = decode(child.children.join(''));
        if (!isJson(body)) throw new Error('spec.html: the only pre block in the sections is the profile example.');
        out.push({ md: '```json\n' + body + '\n```', gen: 'profile', node: child });
      } else if (child.tag === 'sc-for') out.push(list(child));
      else if (!isLeaf(child)) blocks(child, out, section);
      else {
        const said = text(child);
        if (/^\d+$/.test(said)) section.number = said;
        else if (section.future && !out.length) out.push({ md: `## ${said}`, kind: 'heading', node: child });
        else if (/^\d+\.\d+ /.test(said)) out.push({ md: `### ${said}`, kind: 'subheading', node: child });
        else if (said.length <= LABEL_LENGTH && child === elements[0] && elements.length > 1) out.push({ md: `**${said}**`, kind: 'label', node: child });
        else if (said) out.push({ md: said, kind: 'line', node: child });
      }
    }
    return out;
  };

  const date = html.match(/Specification · draft · (\d{4}-\d{2}-\d{2})/)[1];
  const sections = [...html.matchAll(/<section id="(s\d+|future)"[^>]*>[\s\S]*?<\/section>/g)]
    .map(m => blocks(parse(m[0], m.index).children[0], [], { future: m[1] === 'future' }).map(b => ({ ...b, section: m[1] })));
  if (sections.length < 2 || sections.at(-1)[0]?.md !== '## Future work · non-normative') throw new Error('spec.html needs its numbered sections and then Future work.');
  return { date, blocks: [{ md: '## Requirement index', kind: 'index' }, { md: lists.index(vals.index), gen: 'index' }, ...sections.flat()] };
}

/** The page read back as Markdown, from the requirement index on; with markers, as SPEC.md marks the generated blocks. */
export function specMarkdown(source, { markers = false } = {}) {
  return specBlocks(source).blocks.map(b => markers && b.gen ? marked(b.gen, b.md) : b.md).join('\n\n') + '\n';
}
