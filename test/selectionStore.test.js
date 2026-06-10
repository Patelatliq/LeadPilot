const { test } = require('node:test');
const assert = require('node:assert');
const { createSelectionStore } = require('../src/lib/selectionStore.js');

function lead(url, extra = {}) {
  return Object.assign({ linkedinUrl: url, firstName: 'A', lastName: 'B' }, extra);
}

test('add then size reflects unique keys', () => {
  const s = createSelectionStore();
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  s.add(lead('https://www.linkedin.com/sales/lead/DEF,Y'));
  assert.strictEqual(s.size(), 2);
});

test('adding the same lead twice (diff query) does not double-count', () => {
  const s = createSelectionStore();
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X?sessionId=1'));
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X?sessionId=2'));
  assert.strictEqual(s.size(), 1);
});

test('remove by url decrements size — the deselect bug', () => {
  const s = createSelectionStore();
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  s.add(lead('https://www.linkedin.com/sales/lead/DEF,Y'));
  s.remove('https://www.linkedin.com/sales/lead/ABC,NAME_SEARCH');
  assert.strictEqual(s.size(), 1);
  assert.strictEqual(s.has('https://www.linkedin.com/sales/lead/ABC'), false);
});

test('has() is query/host-insensitive', () => {
  const s = createSelectionStore();
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  assert.strictEqual(s.has('/sales/lead/ABC'), true);
});

test('toggle adds when absent and removes when present', () => {
  const s = createSelectionStore();
  const l = lead('https://www.linkedin.com/sales/lead/ABC,X');
  assert.strictEqual(s.toggle(l), true);
  assert.strictEqual(s.size(), 1);
  assert.strictEqual(s.toggle(l), false);
  assert.strictEqual(s.size(), 0);
});

test('values() returns stored lead data in insertion order', () => {
  const s = createSelectionStore();
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X', { firstName: 'Grif' }));
  s.add(lead('https://www.linkedin.com/sales/lead/DEF,Y', { firstName: 'Kerri' }));
  assert.deepStrictEqual(s.values().map(v => v.firstName), ['Grif', 'Kerri']);
});

test('subscribers fire on add/remove/clear with current size', () => {
  const s = createSelectionStore();
  const seen = [];
  s.subscribe(() => seen.push(s.size()));
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  s.remove('https://www.linkedin.com/sales/lead/ABC,X');
  s.add(lead('https://www.linkedin.com/sales/lead/DEF,Y'));
  s.clear();
  assert.deepStrictEqual(seen, [1, 0, 1, 0]);
});

test('clear empties the store', () => {
  const s = createSelectionStore();
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  s.clear();
  assert.strictEqual(s.size(), 0);
});

test('unsubscribe stops further notifications', () => {
  const s = createSelectionStore();
  let calls = 0;
  const unsub = s.subscribe(() => { calls++; });
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  unsub();
  s.add(lead('https://www.linkedin.com/sales/lead/DEF,Y'));
  assert.strictEqual(calls, 1);
});

test('a throwing subscriber does not block others', () => {
  const s = createSelectionStore();
  let secondFired = false;
  s.subscribe(() => { throw new Error('boom'); });
  s.subscribe(() => { secondFired = true; });
  s.add(lead('https://www.linkedin.com/sales/lead/ABC,X'));
  assert.strictEqual(secondFired, true);
});
