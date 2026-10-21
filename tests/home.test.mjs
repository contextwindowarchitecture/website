import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The home page shows a real app at work: the 01-docs-qa bot's code before and after CWA, the request its model
// receives, the trace of what was left out, and one measured result (docs/plans/reader-feedback/home-page.md).

const read = name => fs.readFile(new URL('../' + name, import.meta.url), 'utf8');
const GLOSSARY = new Set(JSON.parse(await read('site/glossary.json')).map(e => e.id));
const TERM_STYLE = 'color: var(--fg); text-decoration: underline dotted var(--muted); text-decoration-thickness: 1px; text-underline-offset: 3px;';

test('a term\'s first use is a term link that opens the glossary at it, once per page and one new term per slide', async () => {
  const html = await read('index.html');
  const links = [...html.matchAll(/<a class="term" href="#glossary\/([a-z0-9-]+)" style="([^"]*)"[^>]*>([^<]+)<\/a>/g)];
  assert.equal(links.length, (html.match(/class="term"/g) || []).length, 'every term link has the recipe\'s shape');
  for (const [, id, style, word] of links) {
    assert.ok(GLOSSARY.has(id), `${word} links a glossary entry`);
    assert.ok(style.startsWith(TERM_STYLE), `${word} is styled as a term`);
  }
  const ids = links.map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'a term is linked at its first use only');
  for (const [, id, body] of html.matchAll(/<section id="([a-z]+)" data-slide="\d"[^>]*>([\s\S]*?)<\/section>/g)) {
    assert.ok((body.match(/class="term"/g) || []).length <= 1, `${id} brings in one new term at most`);
  }
});

const blocks = await import('../scripts/example-blocks.mjs');
const { DIR, LOCK } = await import('../scripts/vendor-examples.mjs');
const vendored = name => read(`${DIR}/${name}`);
const decode = text => text.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
/** A <pre>'s text as a reader sees it: code is one block per line, prose is plain text. */
const preText = pre => /^<span style="display: block;/.test(pre)
  ? [...pre.matchAll(/<span style="display: block;[^"]*">([\s\S]*?)<\/span>/g)].map(m => decode(m[1])).join('\n') : decode(pre);
/** A generated block's text as a reader sees it. */
const shown = (html, name) => {
  const block = html.match(new RegExp(`<!-- ${name}_START -->([\\s\\S]*?)<!-- ${name}_END -->`))?.[1];
  assert.ok(block, `index.html has the ${name} block`);
  const pre = block.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1];
  return pre === undefined ? decode(block) : preText(pre);
};

test('an excerpt is the named top-level statements in source order, each whole, and a missing one is an error', () => {
  const source = 'import x\n\nA = 1\nB = (\n    2,\n)\n\n\ndef f(a):\n    """Doc."""\n\n    return a\n\n\n# a comment\ndef g():\n    pass\n';
  assert.equal(blocks.excerpt(source, ['def f(', 'A =']), 'A = 1\n\ndef f(a):\n    """Doc."""\n\n    return a');
  assert.equal(blocks.excerpt(source, ['B =', 'import']), 'import x\n\nB = (\n    2,\n)', 'a closing bracket at the margin belongs to its statement');
  assert.equal(blocks.excerpt(source, ['import', 'A =']), 'import x\nA = 1', 'single lines stay together');
  assert.throws(() => blocks.excerpt(source, ['def h(']), /No top-level statement starts with "def h\("/);
  assert.throws(() => blocks.panel({ label: 'x', meta: '', text: 'a {{ b }}' }), /template binding/);
});

test('the code slide shows build_request() from before.py and after.py, as vendored, and links where the snapshot is built', async () => {
  const html = await read('index.html');
  const lock = JSON.parse(await read(LOCK));
  const before = shown(html, 'EXAMPLE_BEFORE'), after = shown(html, 'EXAMPLE_AFTER');
  const beforeSource = await vendored(blocks.BEFORE.file);
  assert.equal(before, blocks.excerpt(beforeSource, blocks.BEFORE.prefixes));
  assert.equal(after, blocks.excerpt(await vendored(blocks.AFTER.file), blocks.AFTER.prefixes));
  assert.ok(before.startsWith('def build_request(conversation: Conversation)') && after.startsWith('def build_request(conversation: Conversation)'), 'the same function in both apps');
  assert.ok(after.includes('context.snapshot(conversation)') && after.includes('context.assemble(document)'));
  const code = html.slice(html.indexOf('<section id="code"'), html.indexOf('</section>', html.indexOf('<section id="code"')));
  // The caption names before.py's limits, which the excerpt uses by name only.
  assert.match(beforeSource, /^TOP_K = 5$/m);
  assert.match(beforeSource, /^MAX_HISTORY_MESSAGES = 6$/m);
  assert.ok(before.includes('TOP_K') && before.includes('MAX_HISTORY_MESSAGES'));
  assert.ok(code.includes('>Paste the top five articles into the system prompt, keep the last six messages, send.</p>'));
  const app = `https://github.com/contextwindowarchitecture/examples/tree/${lock.commit}/01-docs-qa`;
  assert.ok(code.includes(`<a href="https://github.com/contextwindowarchitecture/examples/blob/${lock.commit}/01-docs-qa/context.py" target="_blank" rel="noopener"`) && code.includes('>Where the snapshot is built: context.py →</a>'), 'context.py, at the locked commit');
  assert.ok(code.includes(`<a href="${app}" target="_blank" rel="noopener"`) && code.includes(`at ${lock.commit.slice(0, 7)} →</a>`), 'the whole app, at the locked commit');
  assert.equal([...code.matchAll(/<pre /g)].length, 2, 'two panels');
});

test('the first slide says what CWA is in plain words, brings in the assembler, and shows the real Python call', async () => {
  const html = await read('index.html');
  const top = html.slice(html.indexOf('<section id="top"'), html.indexOf('<section id="code"'));
  assert.ok(top.includes('>Decide what your model sees. Keep a record of why.</h1>'));
  assert.ok(top.includes('You call one right before your model call.') && top.includes('It never calls the model.'), 'what it is, and that it is no proxy');
  assert.deepEqual([...top.matchAll(/<a class="term" href="#glossary\/([a-z-]+)"/g)].map(m => m[1]), ['assembler']);
  const figure = preText(top.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]);
  const source = (await vendored('01-docs-qa/context.py')) + (await vendored('01-docs-qa/after.py'));
  for (const name of ['from cwa import', 'Snapshot', 'assemble', 'from_json', 'result.payload', 'result.trace']) {
    assert.ok(figure.includes(name) && source.includes(name), `${name} is in the figure and in the example's own code`);
  }
  assert.ok(!top.includes('aria-hidden="true"'), 'the figure is real code, not a picture');
  assert.match(html, /<title>Context Window Architecture — decide what your model sees<\/title>/);
});

test('a term link opens the glossary scrolled to its entry, on every page, and leaves the page where it was', async () => {
  const vm = await import('node:vm');
  for (const page of ['index.html', 'spec.html', 'evidence.html', 'assembler.html']) {
    const source = (await read(page)).match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
    class DCLogic { props = {}; setState(patch, cb) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); if (cb) cb(); } }
    const list = { offsetTop: 120, scrollTop: 0 };
    const entry = { offsetTop: 1500, parentElement: list, focused: null, focus(options) { this.focused = options; } };
    const document = { activeElement: null, documentElement: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {} }, getElementById: id => id === 'glossary-trace' ? entry : null, addEventListener() {}, removeEventListener() {} };
    const timers = [];
    const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, document, window: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) }, location: { hash: '' }, history: { replaceState() {} }, setTimeout: fn => timers.push(fn), clearTimeout() {}, setInterval() {}, clearInterval() {} });
    view.openGlossary('trace');
    assert.deepEqual([view.state.glossaryOpen, view.state.glossaryTerm, list.scrollTop, entry.focused?.preventScroll], [true, 'trace', 1380, true], page);
    // A panel the page opened as it loaded lays out after the first try; the second, a tick later, lands on the term.
    entry.offsetTop = 2600;
    for (const fn of timers.splice(0)) fn();
    assert.equal(list.scrollTop, 2480, `${page}: again once the panel is laid out`);
  }
});

// What `uv run --frozen after.py --provider none --conversation scenarios/<scenario>/conversation.json` printed in the
// examples checkout at the locked commit, with no model and no key. A vendor that changes a scenario means running it
// again and replacing the fixture.
const printed = async name => (await read(`tests/fixtures/${name}.txt`)).trim();

test('the third slide draws what the model received from the trace, and shows the request exactly as after.py prints it', async () => {
  const html = await read('index.html');
  // The request as sent: the part of after.py's output that follows its trace table.
  const out = await printed('after-01-answer');
  const request = shown(html, 'EXAMPLE_PAYLOAD');
  assert.equal(request, out.slice(out.indexOf('── system ──')));
  assert.ok(request.startsWith('── system ──\nYou are the Fernway help assistant.') && /\n── user ──\n<article id="help:sign-in@6#0">\n/.test(request) && request.endsWith('</question>'), 'a system message, then one user message of tagged items');
  assert.equal(request.match(/── \w+ ──/g).length, 2, 'two messages, nothing else');
  const sent = html.slice(html.indexOf('<section id="sent"'), html.indexOf('</section>', html.indexOf('<section id="sent"')));
  assert.ok(/<details[^>]*>\s*<summary[^>]*>Show the request as sent<\/summary>[\s\S]*<!-- EXAMPLE_PAYLOAD_START -->/.test(sent), 'the full request is one click away');
  // The window: one bar per sent item, in render order, with its tag (or id) and tokens; then the fill and what was left out.
  const window = html.match(/<!-- EXAMPLE_WINDOW_START -->([\s\S]*?)<!-- EXAMPLE_WINDOW_END -->/)[1];
  const bars = [...window.matchAll(/<div style="height: (\d+)px; background: var\(--p-(\w+)\);[^"]*"><span[^>]*>([^<]+)<\/span><span[^>]*>(\d+) tok<\/span><\/div>/g)].map(m => [decode(m[3]), Number(m[4]), m[2], Number(m[1])]);
  assert.deepEqual(bars, [
    ['policy:instructions', 142, 'gov', 28 + Math.round(142 * 0.3)],
    ['<article id="help:sign-in@6#0">', 58, 'evid', 28 + Math.round(58 * 0.3)],
    ['<article id="help:sign-in@6#1">', 39, 'evid', 28 + Math.round(39 * 0.3)],
    ['<question id="turn:s_01answer:0001">', 11, 'inter', 28 + Math.round(11 * 0.3)],
  ]);
  const trace = JSON.parse(await vendored('01-docs-qa/scenarios/01-answer/trace.json'));
  assert.deepEqual(bars.map(b => b[1]).sort(), trace.included.map(r => r.tokens).sort(), 'every sent item, and nothing else');
  assert.ok(window.includes('>283 of 1,500 tokens<') && window.includes(`width: ${(100 * 283 / 1500).toFixed(1)}%; background: var(--fg);`), 'the budget, and how much of it the request used');
  const left = [...window.matchAll(/<div style="border: 1px dashed var\(--p-evid\);[^"]*"><span>([^<]+)<\/span><span>([^<]+)<\/span><\/div>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(left, [
    ['help:sign-in@6#3', 'below threshold · relevance 1.839, needs 2.0'],
    ['help:status-and-uptime@3#0', 'below threshold · relevance 1.636, needs 2.0'],
    ['help:support@2#1', 'below threshold · relevance 1.754, needs 2.0'],
  ]);
  assert.deepEqual(left.map(l => l[0]), trace.excluded.map(r => r.item_id));
});

test('the third slide\'s captions agree with the scenario, and the refusal is the off-topic run\'s', async () => {
  const html = await read('index.html');
  const sent = html.slice(html.indexOf('<section id="sent"'), html.indexOf('</section>', html.indexOf('<section id="sent"')));
  const snapshot = JSON.parse(await vendored('01-docs-qa/scenarios/01-answer/snapshot.json'));
  const trace = JSON.parse(await vendored('01-docs-qa/scenarios/01-answer/trace.json'));
  assert.equal(snapshot.route_policy.slots['evidence.knowledge'].min_relevance, 2);
  assert.equal(trace.excluded.filter(row => row.reason === 'below_threshold').length, 3);
  assert.ok(sent.includes("Three articles scored under this route's threshold of 2.0 and stayed out."));
  assert.deepEqual([...sent.matchAll(/<a class="term" href="#glossary\/([a-z-]+)"/g)].map(m => m[1]), ['trace']);
  const refused = JSON.parse(await vendored('01-docs-qa/scenarios/03-off-topic/snapshot.json'));
  const query = refused.batches.flatMap(b => b.items).find(item => item.slot === 'interaction.query');
  assert.match(query.body, /banana bread/i);
  assert.ok(sent.includes('Ask it for a banana-bread recipe and nothing reaches the model:'));
  assert.equal(shown(html, 'EXAMPLE_REFUSAL'), (await printed('after-03-off-topic')).split('\n')[0]);
  assert.equal(shown(html, 'EXAMPLE_REFUSAL'), 'refused: evidence_required, recovery request_context. No request is sent.');
});

test('nothing on the home page scrolls sideways: code wraps under a hanging indent, prose wraps as text does', async () => {
  const html = await read('index.html');
  const pres = [...html.matchAll(/<pre style="([^"]*)">([\s\S]*?)<\/pre>/g)];
  assert.equal(pres.length, (html.match(/<pre[ >]/g) || []).length, 'every <pre> is one of these');
  for (const [, style, body] of pres) {
    assert.ok(style.includes('white-space: pre-wrap; overflow-wrap: anywhere;') && !style.includes('overflow: auto'), `wraps: ${body.slice(0, 60)}`);
    for (const [, line, hang, indent, text] of body.matchAll(/(<span style="display: block; padding-left: (\d+)ch; text-indent: -(\d+)ch;">([^<]*)<\/span>)/g)) {
      assert.equal(hang, indent);
      assert.equal(Number(hang), decode(text).match(/^ */)[0].length + 4, `the continuation hangs four columns in: ${line.slice(0, 80)}`);
    }
  }
  assert.ok(!html.includes('tabindex="0"'), 'no panel needs a keyboard to scroll it');
  assert.ok(blocks.panel({ label: 'x', meta: '', text: '  a\n\nb' }).includes('<span style="display: block; padding-left: 6ch; text-indent: -6ch;">  a</span><span style="display: block; height: 1.55em;"></span><span style="display: block; padding-left: 4ch; text-indent: -4ch;">b</span>'));
});

test('a measured share is its fraction to two places, and a row of several arms shows their range', () => {
  assert.equal(blocks.share([{ numerator: 3198, denominator: 3888 }]), '0.82');
  assert.equal(blocks.share([{ numerator: 3845, denominator: 3888 }, { numerator: 3770, denominator: 3888 }]), '0.97–0.99');
  assert.equal(blocks.share([{ numerator: 1, denominator: 3 }, { numerator: 1, denominator: 3 }]), '0.33');
});

test('the measured slide shows the benchmark\'s numbers with their caveat on the same slide, and names the run they came from', async () => {
  const html = await read('index.html');
  const measured = JSON.parse(await read('site/measured.json'));
  const slide = html.slice(html.indexOf('<section id="measured"'), html.indexOf('</section>', html.indexOf('<section id="measured"')));
  const rows = [...slide.matchAll(/<div style="padding: 14px 0; border-top: 1px solid var\(--line\);"><div[^>]*>([^<]+)<\/div><div[^>]*>([^<]+)<\/div>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows, [['0.97–0.99', 'CWA, with state the app writes from what the user said'], ['0.86', 'A rolling summary of the conversation'], ['0.82', 'Truncation: keep the system prompt, drop the oldest turns']]);
  assert.deepEqual(rows, measured.rows.map(row => [blocks.share(row.arms), row.label]));
  assert.ok(measured.rows.every(row => row.arms.every(a => a.metric === 's2.aptitude' && a.denominator === 3888)), 'every share is the same probes\' aptitude');
  const { source, fact_in_payload: fact } = measured;
  assert.deepEqual([source.budget, source.turns, fact['truncate-pinned'], fact['cwa-state']], [8192, 100, 0.9, 1]);
  assert.ok(slide.includes('conversations of up to 100 turns on an 8,192-token budget'));
  // Each share's bar is drawn on a 0-to-1 scale: the lowest arm solid, a range's upper part lighter.
  const bars = [...slide.matchAll(/<div aria-hidden="true" style="display: flex; height: 6px;[^"]*"><div style="width: ([\d.]+)%;[^"]*"><\/div>(?:<div style="width: ([\d.]+)%;[^"]*opacity: 0.4;"><\/div>)?<\/div>/g)].map(m => [m[1], m[2] ?? null]);
  assert.deepEqual(bars, [['97.0', '1.9'], ['86.2', null], ['82.3', null]]);
  assert.ok(slide.includes('Truncation sent the fact the answer needed for 90% of questions. CWA\'s protected state sent it every time.'));
  // The caveat: one model, named; what the gain comes from; and the case where it vanishes.
  assert.ok(slide.includes(`gave one model, ${source.model.replace(/^.*\//, '').replace(/-FP8$/, '')}, conversations`) && slide.includes('One model, one budget.'));
  assert.ok(slide.includes('The gain comes from the state your app keeps') && slide.includes('When the model writes that state itself, CWA is level with truncation.'));
  const writeUp = `https://github.com/${source.repository}/blob/${source.commit}/${source.path}`;
  assert.ok(slide.includes(`href="${writeUp}#scripted-conversations-s2"`) && slide.includes(`href="${writeUp}#reproducing-it"`), 'the write-up and how to replay it, at the pinned commit');
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.equal([...slide.matchAll(/class="term"/g)].length, 0, 'no new term on the last slide');
});

test('the last slide opens two doors: running the example at its locked commit, and the spec', async () => {
  const html = await read('index.html');
  const lock = JSON.parse(await read(LOCK));
  const slide = html.slice(html.indexOf('<section id="measured"'), html.indexOf('</section>', html.indexOf('<section id="measured"')));
  const doors = slide.slice(slide.indexOf('<div class="g2c"'), slide.indexOf('<span>04 / 04</span>'));
  assert.deepEqual([...doors.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]), [`https://github.com/${lock.repository}/tree/${lock.commit}/01-docs-qa#readme`, './spec.html']);
  assert.ok(doors.includes('uv run after.py &quot;How do I export all my projects?&quot;') || doors.includes('uv run after.py "How do I export all my projects?"'));
  assert.ok(doors.includes('No API key needed.'));
});

test('the home page is four slides, each a full-height section with one heading, and nothing else of the old page', async () => {
  const html = await read('index.html');
  const slides = [...html.matchAll(/<section id="([a-z]+)" data-slide="(\d)" style="([^"]*)"/g)];
  assert.deepEqual(slides.map(m => [m[1], m[2]]), [['top', '1'], ['code', '2'], ['sent', '3'], ['measured', '4']]);
  for (const m of slides) assert.ok(m[3].includes('min-height: calc(100vh - 68px)') && m[3].includes('scroll-snap-align: start'), `${m[1]} fills the viewport and snaps`);
  assert.ok(html.includes('scroll-snap-type: y proximity'), 'the page snaps between slides');
  assert.match(html, /<h1[^>]*>Decide what your model sees\. Keep a record of why\.<\/h1>/);
  assert.ok(html.includes('>The same help-center bot, before and after.</h2>') && html.includes('>What the model receives, and what was left out.</h2>') && html.includes('>Long chats lose facts. Protected state keeps them.</h2>'));
  for (const gone of ['<section id="shapes"', '<section id="assembly"', '<section id="planes"', 'const SLOTS', 'const PLANES', 'The words this site uses:', '{{ layers }}', '<section id="problem"', '<section id="why"', '<section id="assemble"', '<section id="deeper"', '<section id="scaffold"', 'const UCS', '>What it is</div>', ">Who it's for</div>"]) {
    assert.ok(!html.includes(gone), `${gone} has left the home page`);
  }
  assert.deepEqual([...html.matchAll(/>0(\d) \/ 04</g)].map(m => m[1]), ['1', '2', '3', '4'], 'each slide counts itself');
  assert.equal(html.indexOf('<section', html.indexOf('<section id="measured"') + 1), -1, 'the measured slide is the last section');
  assert.ok(!html.includes('<section id="harness"') && !html.includes('frameworks()') && !html.includes('.g6'), 'harness engineering has moved to the Assembler page');
});

test('the first slide offers the example and the spec, the second shows the example\'s code, and the third what it sent', async () => {
  const html = await read('index.html');
  const first = html.slice(html.indexOf('<section id="top"'), html.indexOf('<section id="code"'));
  assert.deepEqual([...first.matchAll(/<a href="([^"]+)" style="font-size: 16px;[^>]*>(See it on a real app ↓|Read the spec)<\/a>/g)].map(m => [m[2], m[1]]),
    [['See it on a real app ↓', '#code'], ['Read the spec', './spec.html']]);
  const second = html.slice(html.indexOf('<section id="code"'), html.indexOf('<section id="sent"'));
  assert.ok(['EXAMPLE_BEFORE', 'EXAMPLE_AFTER', 'EXAMPLE_COMMIT'].every(b => second.includes(`<!-- ${b}_START -->`)), 'the before and after code, and the commit it is from');
  assert.ok(!html.includes('#assemble/clinical-triage/blob'), 'the failure shapes have left the home page');
  const third = html.slice(html.indexOf('<section id="sent"'), html.indexOf('<section id="measured"'));
  assert.ok(['EXAMPLE_WINDOW', 'EXAMPLE_PAYLOAD', 'EXAMPLE_REFUSAL'].every(b => third.includes(`<!-- ${b}_START -->`)) && third.includes('href="#measured"'), 'what was received and left out, the request and the refusal, then the measured slide');
});
