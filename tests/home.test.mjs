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
/** A generated block's text as a reader sees it: its <pre> with the markup stripped and the entities decoded. */
const shown = (html, name) => {
  const block = html.match(new RegExp(`<!-- ${name}_START -->([\\s\\S]*?)<!-- ${name}_END -->`))?.[1];
  assert.ok(block, `index.html has the ${name} block`);
  const pre = block.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? block;
  return pre.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
};

test('an excerpt is the named top-level statements in source order, each whole, and a missing one is an error', () => {
  const source = 'import x\n\nA = 1\nB = (\n    2,\n)\n\n\ndef f(a):\n    """Doc."""\n\n    return a\n\n\n# a comment\ndef g():\n    pass\n';
  assert.equal(blocks.excerpt(source, ['def f(', 'A =']), 'A = 1\n\ndef f(a):\n    """Doc."""\n\n    return a');
  assert.equal(blocks.excerpt(source, ['B =', 'import']), 'import x\n\nB = (\n    2,\n)', 'a closing bracket at the margin belongs to its statement');
  assert.equal(blocks.excerpt(source, ['import', 'A =']), 'import x\nA = 1', 'single lines stay together');
  assert.throws(() => blocks.excerpt(source, ['def h(']), /No top-level statement starts with "def h\("/);
  assert.throws(() => blocks.panel({ label: 'x', meta: '', aria: 'x', text: 'a {{ b }}' }), /template binding/);
});

test('the code slide shows build_request() from before.py and its CWA counterpart from context.py, as vendored', async () => {
  const html = await read('index.html');
  const lock = JSON.parse(await read(LOCK));
  const before = shown(html, 'EXAMPLE_BEFORE'), after = shown(html, 'EXAMPLE_AFTER');
  assert.equal(before, blocks.excerpt(await vendored(blocks.BEFORE.file), blocks.BEFORE.prefixes));
  assert.equal(after, blocks.excerpt(await vendored(blocks.AFTER.file), blocks.AFTER.prefixes));
  assert.ok(before.startsWith('TOP_K = 5\nMAX_HISTORY_MESSAGES = 6\n\ndef build_request('), 'the five articles and six messages the caption names');
  assert.ok(after.includes('def snapshot(') && after.includes('def assemble(') && after.includes('cwa_assemble(Snapshot.from_json(document))'));
  const code = html.slice(html.indexOf('<section id="code"'), html.indexOf('</section>', html.indexOf('<section id="code"')));
  assert.ok(code.includes(`<a href="https://github.com/contextwindowarchitecture/examples/tree/${lock.commit}/01-docs-qa" target="_blank" rel="noopener"`) && code.includes(`at ${lock.commit.slice(0, 7)} →</a>`), 'the whole app, at the locked commit');
  assert.ok(code.includes('>Paste the top five articles into the system prompt, keep the last six messages, send.</p>'));
  assert.equal([...code.matchAll(/<pre tabindex="0" aria-label="[^"]+"/g)].length, 2, 'both panels scroll from the keyboard and are named');
});

test('the first slide says what CWA is in plain words, brings in the assembler, and shows the real Python call', async () => {
  const html = await read('index.html');
  const top = html.slice(html.indexOf('<section id="top"'), html.indexOf('<section id="code"'));
  assert.ok(top.includes('>Decide what your model sees. Keep a record of why.</h1>'));
  assert.ok(top.includes('You call one right before your model call.') && top.includes('It never calls the model.'), 'what it is, and that it is no proxy');
  assert.deepEqual([...top.matchAll(/<a class="term" href="#glossary\/([a-z-]+)"/g)].map(m => m[1]), ['assembler']);
  const figure = top.match(/<pre tabindex="0" aria-label="[^"]+"[^>]*>([\s\S]*?)<\/pre>/)[1];
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
    const view = vm.runInNewContext(source + '\nnew Component()', { DCLogic, console, document, window: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) }, location: { hash: '' }, history: { replaceState() {} }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} });
    view.openGlossary('trace');
    assert.deepEqual([view.state.glossaryOpen, view.state.glossaryTerm, list.scrollTop, entry.focused?.preventScroll], [true, 'trace', 1380, true], page);
  }
});

// What `uv run --frozen after.py --provider none --conversation scenarios/<scenario>/conversation.json` printed in the
// examples checkout at the locked commit, with no model and no key. A vendor that changes a scenario means running it
// again and replacing the fixture.
const printed = async name => (await read(`tests/fixtures/${name}.txt`)).trim();

test('the third slide shows exactly what after.py prints: the trace table and the request as sent', async () => {
  const html = await read('index.html');
  assert.equal(shown(html, 'EXAMPLE_TRACE') + '\n\n' + shown(html, 'EXAMPLE_PAYLOAD'), await printed('after-01-answer'));
  const request = shown(html, 'EXAMPLE_PAYLOAD');
  assert.ok(request.startsWith('── system ──\nYou are the Fernway help assistant.') && /\n── user ──\n<article id="help:sign-in@6#0">\n/.test(request) && request.endsWith('</question>'), 'a system message, then one user message of tagged items');
  assert.equal(request.match(/── \w+ ──/g).length, 2, 'two messages, nothing else');
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

test('the request and the refusal wrap their prose; the code and trace panels keep their columns', async () => {
  const html = await read('index.html');
  const pre = name => html.match(new RegExp(`<!-- ${name}_START -->[\\s\\S]*?<pre [^>]*style="([^"]*)"`))[1];
  for (const name of ['EXAMPLE_PAYLOAD', 'EXAMPLE_REFUSAL']) assert.ok(pre(name).includes('white-space: pre-wrap; overflow-wrap: anywhere;'), `${name} wraps`);
  for (const name of ['EXAMPLE_BEFORE', 'EXAMPLE_AFTER', 'EXAMPLE_TRACE']) assert.ok(!pre(name).includes('pre-wrap'), `${name} keeps its columns`);
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
  const rows = [...slide.matchAll(/<div class="rm"[^>]*><span[^>]*>([^<]+)<\/span><span[^>]*>([^<]+)<\/span><\/div>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows, [['0.97–0.99', 'CWA, with state the app writes from what the user said'], ['0.86', 'A rolling summary of the conversation'], ['0.82', 'Truncation: keep the system prompt, drop the oldest turns']]);
  assert.deepEqual(rows, measured.rows.map(row => [blocks.share(row.arms), row.label]));
  assert.ok(measured.rows.every(row => row.arms.every(a => a.metric === 's2.aptitude' && a.denominator === 3888)), 'every share is the same probes\' aptitude');
  const { source, fact_in_payload: fact } = measured;
  assert.deepEqual([source.budget, source.turns, fact['truncate-pinned'], fact['cwa-state']], [8192, 100, 0.9, 1]);
  assert.ok(slide.includes('conversations of up to 100 turns on an 8,192-token budget'));
  assert.ok(slide.includes('Truncation sent the fact the answer needed for 90% of questions. CWA\'s protected state sent it every time.'));
  // The caveat: one model, named; what the gain comes from; and the case where it vanishes.
  assert.ok(slide.includes(`One model (${source.model.replace(/^.*\//, '').replace(/-FP8$/, '')}), one budget.`));
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
  assert.ok(doors.includes('No API key is needed to see what would be sent.'));
});

test('the home page is four slides, each a full-height section with one heading, and nothing else of the old page', async () => {
  const html = await read('index.html');
  const slides = [...html.matchAll(/<section id="([a-z]+)" data-slide="(\d)" style="([^"]*)"/g)];
  assert.deepEqual(slides.map(m => [m[1], m[2]]), [['top', '1'], ['code', '2'], ['sent', '3'], ['measured', '4']]);
  for (const m of slides) assert.ok(m[3].includes('min-height: calc(100vh - 68px)') && m[3].includes('scroll-snap-align: start'), `${m[1]} fills the viewport and snaps`);
  assert.ok(html.includes('scroll-snap-type: y proximity'), 'the page snaps between slides');
  assert.match(html, /<h1[^>]*>Decide what your model sees\. Keep a record of why\.<\/h1>/);
  assert.ok(html.includes('>The same help-center bot, before and after.</h2>') && html.includes('>What the model receives, and what was left out.</h2>') && html.includes('>Long conversations push facts out of the window. Protected state keeps them.</h2>'));
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
  assert.ok(['EXAMPLE_PAYLOAD', 'EXAMPLE_TRACE', 'EXAMPLE_REFUSAL'].every(b => third.includes(`<!-- ${b}_START -->`)) && third.includes('href="#measured"'), 'the request, the trace and the refusal, then the measured slide');
});
