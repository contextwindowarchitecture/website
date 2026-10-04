// SPEC.md: the Spec page's requirement index and sections 1 to 6 as Markdown, so the specification can be read, and
// copied to another repository, without the page. Prose is taken from the page's markup in the order it stands there,
// and each list a template fills in is written from the values the page's component gives that template. Markup this
// file does not know stops the build, so nothing on the page is left out silently.
import vm from 'node:vm';

const INLINE = new Set(['a', 'b', 'code', 'em', 'i', 'span', 'strong']);
// A short line that opens a card on the page names the card; anything longer is the card's text.
const LABEL_LENGTH = 40;
const decode = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
// What Markdown would take for markup in plain text: an escape, emphasis, an HTML tag. conformance/check.py and the
// tests escape requirement text the same way.
const escape = text => text.replace(/[\\*<]/g, '\\$&');
const code = text => '`' + text + '`';
const table = (head, rows) => [head, head.map(() => '---'), ...rows]
  .map(row => `| ${row.map(cell => String(cell).replaceAll('|', '\\|')).join(' | ')} |`).join('\n');

function parse(html) {
  const root = { tag: '', attrs: '', children: [] };
  const open = [root];
  let read = 0;
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<\/([\w-]+)>|<([\w-]+)((?:"[^"]*"|[^">])*)>|[^<]+/g)) {
    if (m.index !== read) break;
    read += m[0].length;
    const [text, closing, tag, attrs] = m;
    if (closing) {
      if (open.length === 1 || open.pop().tag !== closing) throw new Error(`spec.html: </${closing}> closes nothing open.`);
    } else if (tag) {
      const node = { tag, attrs, children: [] };
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
 * @param {{ html: string, requirements: { id: string, summary: string, text: string }[], site: string }} source
 *   the Spec page as built, the requirements it embeds, and the address its relative links resolve against
 */
export function specMarkdown({ html, requirements, site }) {
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
    return lists[name](vals[name]);
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
      } else if (child.tag === 'h2') out.push(`## ${section.number} ${text(child)}`);
      else if (child.tag === 'p') out.push(text(child));
      else if (child.tag === 'pre') {
        if (!child.children.every(isText)) throw new Error('spec.html: a pre block holds markup.');
        const body = decode(child.children.join(''));
        out.push('```' + (isJson(body) ? 'json' : '') + '\n' + body + '\n```');
      } else if (child.tag === 'sc-for') out.push(list(child));
      else if (!isLeaf(child)) blocks(child, out, section);
      else {
        const said = text(child);
        if (/^\d+$/.test(said)) section.number = said;
        else if (/^\d+\.\d+ /.test(said)) out.push(`### ${said}`);
        else if (said) out.push(said.length <= LABEL_LENGTH && child === elements[0] && elements.length > 1 ? `**${said}**` : said);
      }
    }
    return out;
  };

  const date = html.match(/Specification · draft · (\d{4}-\d{2}-\d{2})/)[1];
  const sections = [...html.matchAll(/<section id="(s\d+)">[\s\S]*?<\/section>/g)].map(m => blocks(parse(m[0]).children[0], [], {}));
  if (sections.length === 0) throw new Error('spec.html has no numbered sections.');
  return [
    '# Context Window Architecture: specification',
    `Draft of ${date}, not yet stable. Requirements are numbered from R-1; new ones append, and numbers are permanent and never reused.`,
    `This file is the requirement index and sections 1 to 6 of the [Spec page](${site}spec.html) as Markdown, generated by \`npm run build:contract\` from that page and \`contract/requirements.json\`. ` +
    'The page is the normative text: where this file differs from it, the page holds. The page also carries the changelog of every revision.',
    'The schemas in [schema/](schema) define the JSON shapes, [contract/reasons.json](contract/reasons.json) the reason codes, and [contract/slot-defaults.json](contract/slot-defaults.json) the defaults R-3 fills. ' +
    '[conformance/README.md](conformance/README.md) settles every ordering, tie-break, boundary and algorithm step the requirements leave open (R-21).',
    '## Requirement index',
    lists.index(vals.index),
    ...sections.flat(),
  ].join('\n\n') + '\n';
}
