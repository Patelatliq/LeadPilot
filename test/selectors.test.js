const { test } = require('node:test');
const assert = require('node:assert');
const { SELECTORS, resolveText, resolveEl } = require('../src/lib/selectors.js');

function fakeRoot(map) {
  return {
    querySelector(sel) {
      if (sel in map) return { innerText: map[sel], textContent: map[sel] };
      return null;
    }
  };
}

test('SELECTORS exposes ordered candidate lists for core targets', () => {
  assert.ok(Array.isArray(SELECTORS.personName));
  assert.ok(SELECTORS.personName[0].includes('data-anonymize'));
  assert.ok(Array.isArray(SELECTORS.companyName));
  assert.ok(Array.isArray(SELECTORS.location));
  assert.ok(Array.isArray(SELECTORS.jobTitle));
});

test('resolveText returns first matching candidate text, trimmed', () => {
  const root = fakeRoot({ '[data-anonymize="person-name"]': '  Griffin Driver  ' });
  assert.strictEqual(resolveText(SELECTORS.personName, root), 'Griffin Driver');
});

test('resolveText falls through to a later candidate when earlier ones miss', () => {
  const root = fakeRoot({ '.artdeco-entity-lockup__title a': 'Kerri Lidman' });
  assert.strictEqual(resolveText(SELECTORS.personName, root), 'Kerri Lidman');
});

test('resolveText returns empty string when nothing matches', () => {
  assert.strictEqual(resolveText(SELECTORS.personName, fakeRoot({})), '');
});

test('resolveEl returns the first matching element', () => {
  const root = fakeRoot({ '[data-anonymize="person-name"]': 'X' });
  const el = resolveEl(SELECTORS.personName, root);
  assert.ok(el && el.textContent === 'X');
});

test('resolveEl returns null when nothing matches', () => {
  assert.strictEqual(resolveEl(SELECTORS.personName, fakeRoot({})), null);
});

test('resolveEl returns null for null scope', () => {
  assert.strictEqual(resolveEl(SELECTORS.personName, null), null);
});
