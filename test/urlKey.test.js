const { test } = require('node:test');
const assert = require('node:assert');
const { urlKey } = require('../src/lib/urlKey.js');

test('strips query string and hash', () => {
  assert.strictEqual(
    urlKey('https://www.linkedin.com/sales/lead/ABC123,NAME_SEARCH?sessionId=xyz#foo'),
    'linkedin.com/sales/lead/abc123'
  );
});

test('drops the comma-suffixed tracking segment on sales lead urls', () => {
  assert.strictEqual(
    urlKey('https://www.linkedin.com/sales/lead/ABC123,NAME_SEARCH,abc'),
    'linkedin.com/sales/lead/abc123'
  );
});

test('normalizes host and trailing slash', () => {
  assert.strictEqual(
    urlKey('https://linkedin.com/in/jane-doe/'),
    'linkedin.com/in/jane-doe'
  );
});

test('handles protocol-relative and path-only inputs', () => {
  assert.strictEqual(urlKey('/sales/lead/ABC123'), 'linkedin.com/sales/lead/abc123');
});

test('returns empty string for falsy input', () => {
  assert.strictEqual(urlKey(''), '');
  assert.strictEqual(urlKey(null), '');
  assert.strictEqual(urlKey(undefined), '');
});
