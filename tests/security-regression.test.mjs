import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('inline application JavaScript parses', () => {
  const start = html.indexOf('<script>\n');
  const end = html.lastIndexOf('</script></body>');
  assert.ok(start >= 0 && end > start, 'main inline script must exist');
  const source = html.slice(start + '<script>\n'.length, end);
  assert.doesNotThrow(() => new vm.Script(source), 'main inline script must be valid JavaScript');
});

test('HTML escaping encodes all HTML-sensitive characters', () => {
  const line = html.split('\n').find(value => value.startsWith('const esc='));
  assert.ok(line, 'HTML escape helper must exist');
  const escape = vm.runInNewContext(line + '\nesc');
  assert.equal(escape('<img src=x onerror="alert(1)"> & \'quoted\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;');
});

test('chapter titles and Markdown editor values are escaped before HTML interpolation', () => {
  assert.match(html, /value="\$\{esc\(c\.title\)\}"/);
  assert.match(html, /<textarea[^>]*>\$\{esc\(c\.md\)\}<\/textarea>/);
});

test('AI key is stored in session storage rather than written to persistent local storage', () => {
  assert.match(html, /sessionStorage\.setItem\('bf_ai_key'/);
  assert.doesNotMatch(html, /localStorage\.setItem\('bf_ai_key'/);
});

test('manuscript persistence failures are visible to the author', () => {
  assert.match(html, /Save failed: browser storage may be full or unavailable/);
});
