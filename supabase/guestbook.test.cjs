const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function page(fetch, configured = true) {
  const html = fs.readFileSync(path.join(__dirname, '../guestbook.html'), 'utf8');
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  if (configured) script = script.replace("'여기에_SUPABASE_URL'", "'https://example.supabase.co'").replace("'여기에_SUPABASE_PUBLISHABLE_KEY'", "'sb_publishable_test'");
  const elements = new Map();
  function node() {
    return { value: '', children: [], hidden: false, disabled: false, classList: { toggle() {} },
      setAttribute() {}, append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; },
      addEventListener(event, fn) { this[event] = fn; }, reset() {} };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    createElement: node
  };
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) document.getElementById(match[1]);
  const context = vm.createContext({ document, fetch, URL, AbortController, setTimeout, clearTimeout, atob });
  vm.runInContext(script, context);
  return { elements, settle: () => vm.runInContext('pendingLoad', context), submit: () => elements.get('guestbook-form').submit({ preventDefault() {} }) };
}
const row = { id: 'a', name: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>', created_at: '2026-01-01T00:00:00Z' };
const ok = rows => ({ ok: true, status: 200, json: async () => rows });

test('does not send requests before configuration', async () => {
  let calls = 0;
  const p = page(async () => { calls++; }, false);
  await p.settle();
  assert.equal(calls, 0);
  assert.equal(p.elements.get('config-note').hidden, false);
  assert.equal(p.elements.get('submit').disabled, true);
});
test('loads saved entries and treats HTML as text', async () => {
  const calls = [];
  const p = page(async (url, options) => { calls.push({ url, options }); return ok([row]); });
  await p.settle();
  assert.match(calls[0].url, /rest\/v1\/guestbook\?select=id,name,message,created_at/);
  assert.equal(calls[0].options.headers.apikey, 'sb_publishable_test');
  const item = p.elements.get('entries').children[0];
  assert.equal(item.children[0].textContent, row.name);
  assert.equal(item.children[1].textContent, row.message);
});
test('inserts trimmed fields, then reloads the list', async () => {
  const calls = [];
  const p = page(async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST' ? { ok: true, status: 204 } : ok([row]);
  });
  await p.settle();
  p.elements.get('name').value = ' 방문자 ';
  p.elements.get('message').value = ' 반가워요 ';
  await p.submit();
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: '방문자', message: '반가워요' });
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(p.elements.get('entries').children.length, 1);
  assert.equal(p.elements.get('write-status').textContent, '글이 저장되었습니다.');
});
test('failed insert preserves input and explains permissions', async () => {
  const p = page(async (url, options) => options.method === 'POST' ? { ok: false, status: 403 } : ok([]));
  await p.settle();
  p.elements.get('name').value = '방문자';
  p.elements.get('message').value = '보관할 글';
  await p.submit();
  assert.equal(p.elements.get('message').value, '보관할 글');
  assert.match(p.elements.get('write-status').textContent, /권한/);
  assert.equal(p.elements.get('submit').disabled, false);
});
