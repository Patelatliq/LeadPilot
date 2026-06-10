# Core: Selection Store, Account Safety & Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lead selection correct (deselect always decrements the count) and the extension account-safe, with a robust, centrally-configured DOM layer — without changing the current visual design yet.

**Architecture:** Introduce a single source of truth for selection (`selectionStore`, a `Map` keyed by canonical LinkedIn URL) plus a centralized `selectors` resolver. Rewire `content.js` so all selection state, counters, and row visuals are *derived* from the store. Remove the background profile-fetch and internal-API calls that risk account restriction. Replace the `setInterval` polling with a scoped, debounced `MutationObserver` and a single lifecycle owner that tears down listeners.

**Tech Stack:** Vanilla JS (Chrome MV3 content script), `node:test` for unit tests on pure modules (zero dependencies), manual verification on a live Sales Navigator page for DOM integration.

**Source spec:** `docs/specs/ui-overhaul-and-robustness.md` (§3 bug fixes, §4 robustness, §9 account safety).

**Companion plans (later):** `2` Shadow-DOM overlay redesign, `3` review modal redesign, `4` popup + Apps Script dedupe.

---

## File Structure

- **Create** `src/lib/urlKey.js` — canonicalizes a LinkedIn/Sales Nav URL into a stable identity key. Pure, no DOM.
- **Create** `src/lib/selectionStore.js` — the single source of truth: `Map<urlKey, LeadData>` with add/remove/has/clear/size + change subscribers. Pure, no DOM.
- **Create** `src/lib/selectors.js` — centralized ordered selector config + `resolve(target, root)` + `resolveAll(target, root)`. Minimal DOM coupling (only `querySelector`/`closest`), injectable root for testing.
- **Create** `test/urlKey.test.js`, `test/selectionStore.test.js`, `test/selectors.test.js` — `node:test` suites.
- **Create** `package.json` — test script only; no runtime deps.
- **Modify** `content.js` — replace `selectedLeads` array + DOM-derived counters with the store; fix `/ Y on page` (C1); remove fetch Strategies 2 & 3 (§9); replace `setInterval(main,1500)` with scoped MutationObserver; normalize URL compare for SPA nav (M4); centralize listener teardown.
- **Modify** `manifest.json` — load the new `src/lib/*.js` files before `content.js` in the content-script `js` array.

> The new modules expose globals on `window.LeadPilot` (MV3 content scripts share one isolated-world scope when listed together; no bundler needed). Each module guards with `window.LeadPilot = window.LeadPilot || {}`.

---

## Task 0: Test harness (zero-dependency)

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json` with a node:test script**

```json
{
  "name": "leadpilot",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Verify the runner works (no tests yet = passes with 0)**

Run: `npm test`
Expected: exits 0, output shows `tests 0` (or "no test files" depending on Node version — either is acceptable as long as exit code is 0).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add node:test harness for pure modules"
```

---

## Task 1: URL canonicalization (`urlKey`)

A lead's identity must be stable across DOM re-renders, query strings, trailing slashes, and host variants. This key is the backbone of the single-source-of-truth fix (spec C2/C3).

**Files:**
- Create: `src/lib/urlKey.js`
- Test: `test/urlKey.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/urlKey.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/urlKey.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/urlKey.js
(function (root) {
  function urlKey(input) {
    if (!input) return '';
    let s = String(input).trim();
    // strip hash and query
    s = s.split('#')[0].split('?')[0];
    // ensure we have a host; prepend canonical host for path-only / protocol-relative
    s = s.replace(/^https?:\/\//i, '').replace(/^\/\//, '');
    if (s.startsWith('/')) s = 'www.linkedin.com' + s;
    // normalize host: drop leading www.
    s = s.replace(/^www\./i, '');
    // lowercase
    s = s.toLowerCase();
    // for /sales/lead/ and /sales/people/, keep only the first id segment (before comma)
    s = s.replace(/(\/sales\/(?:lead|people)\/)([^/,]+).*$/, '$1$2');
    // drop trailing slash
    s = s.replace(/\/+$/, '');
    return s;
  }

  root.LeadPilot = root.LeadPilot || {};
  root.LeadPilot.urlKey = urlKey;
  if (typeof module !== 'undefined' && module.exports) module.exports = { urlKey };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 `urlKey` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/urlKey.js test/urlKey.test.js
git commit -m "feat: add stable urlKey canonicalization for lead identity"
```

---

## Task 2: Selection store (single source of truth)

This is the core fix for the reported bug. All selection lives here, keyed by `urlKey`. Removal is by key — never by array index or DOM re-extraction (spec C2/C3, M1).

**Files:**
- Create: `src/lib/selectionStore.js`
- Test: `test/selectionStore.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/selectionStore.test.js
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
  s.remove('https://www.linkedin.com/sales/lead/ABC,NAME_SEARCH'); // different suffix, same id
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
  assert.strictEqual(s.toggle(l), true);   // now selected
  assert.strictEqual(s.size(), 1);
  assert.strictEqual(s.toggle(l), false);  // now deselected
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/selectionStore.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/selectionStore.js
(function (root) {
  const { urlKey } = (root.LeadPilot && root.LeadPilot.urlKey)
    ? root.LeadPilot
    : require('./urlKey.js');

  function createSelectionStore() {
    const map = new Map();        // urlKey -> leadData
    const subs = new Set();

    function notify() { subs.forEach(fn => { try { fn(); } catch (e) {} }); }

    function add(lead) {
      const key = urlKey(lead && lead.linkedinUrl);
      if (!key) return false;
      const existed = map.has(key);
      map.set(key, lead);
      if (!existed) notify();
      return true;
    }

    function remove(url) {
      const key = urlKey(url);
      if (!key || !map.has(key)) return false;
      map.delete(key);
      notify();
      return true;
    }

    function has(url) { return map.has(urlKey(url)); }

    function toggle(lead) {
      const key = urlKey(lead && lead.linkedinUrl);
      if (!key) return false;
      if (map.has(key)) { map.delete(key); notify(); return false; }
      map.set(key, lead); notify(); return true;
    }

    function clear() {
      if (map.size === 0) return;
      map.clear();
      notify();
    }

    function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

    return {
      add, remove, has, toggle, clear, subscribe,
      size: () => map.size,
      keys: () => Array.from(map.keys()),
      values: () => Array.from(map.values()),
    };
  }

  root.LeadPilot = root.LeadPilot || {};
  root.LeadPilot.createSelectionStore = createSelectionStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSelectionStore };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `selectionStore` tests pass (and `urlKey` tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/selectionStore.js test/selectionStore.test.js
git commit -m "feat: selection store as single source of truth (fixes deselect count)"
```

---

## Task 3: Centralized selector resolver

All Sales-Nav selectors live in one place with ordered fallback chains, stable attributes first (spec §4.1). The resolver is injectable for testing via a stubbed `root`.

**Files:**
- Create: `src/lib/selectors.js`
- Test: `test/selectors.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/selectors.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { SELECTORS, resolveText } = require('../src/lib/selectors.js');

// Minimal fake element: querySelector returns a node from a map of selector->text
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
  assert.ok(SELECTORS.personName[0].includes('data-anonymize'));  // stable attr first
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/selectors.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/selectors.js
(function (root) {
  // Ordered candidate lists — STABLE data attributes first, hashed artdeco classes last.
  const SELECTORS = {
    // a results row container, located by walking up from a lead anchor (see rowOf)
    leadAnchor: ['a[href*="/sales/lead/"]', 'a[href*="/sales/people/"]'],
    rowContainer: ['li.artdeco-list__item', 'tr', 'li', '[data-x--people-list--row]'],
    resultsContainer: ['[data-view-name="lead-search-results"]', 'ol.artdeco-list', 'table'],
    personName: [
      '[data-anonymize="person-name"]',
      '.artdeco-entity-lockup__title a',
      '.artdeco-entity-lockup__title span',
      'a[href*="/sales/lead/"] span',
      'a[href*="/sales/people/"] span',
    ],
    jobTitle: [
      '[data-anonymize="job-title"]',
      '[data-anonymize="title"]',
      '.artdeco-entity-lockup__subtitle',
      'span[class*="subtitle"]',
    ],
    companyName: [
      '[data-anonymize="company-name"]',
      'a[href*="/sales/company/"]',
      'a[href*="/company/"]',
    ],
    location: [
      '[data-anonymize="location"]',
      '.artdeco-entity-lockup__metadata',
    ],
  };

  function resolveText(candidates, scope) {
    if (!scope || !candidates) return '';
    for (const sel of candidates) {
      const el = scope.querySelector(sel);
      if (el) {
        const t = (el.innerText != null ? el.innerText : el.textContent) || '';
        const trimmed = String(t).trim();
        if (trimmed) return trimmed;
      }
    }
    return '';
  }

  function resolveEl(candidates, scope) {
    if (!scope || !candidates) return null;
    for (const sel of candidates) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  root.LeadPilot = root.LeadPilot || {};
  root.LeadPilot.SELECTORS = SELECTORS;
  root.LeadPilot.resolveText = resolveText;
  root.LeadPilot.resolveEl = resolveEl;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SELECTORS, resolveText, resolveEl };
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `selectors` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/selectors.js test/selectors.test.js
git commit -m "feat: centralized ordered selector resolver (stable attrs first)"
```

---

## Task 4: Load new modules in the content script

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Read the current content-script block**

Run: `cat manifest.json`
Expected: a `content_scripts` array whose `js` is `["content.js"]` (or similar). Note the exact current value before editing.

- [ ] **Step 2: Prepend the lib files so globals exist before `content.js` runs**

In `manifest.json`, change the content script `js` array to load libs first:

```json
"js": [
  "src/lib/urlKey.js",
  "src/lib/selectionStore.js",
  "src/lib/selectors.js",
  "content.js"
]
```

Leave `matches`, `css`, and all other keys unchanged.

- [ ] **Step 3: Verify the extension still loads**

Manual: open `chrome://extensions`, enable Developer mode, click "Reload" on LeadPilot. Open a Sales Navigator search page, open DevTools console, run:

```js
window.LeadPilot && Object.keys(window.LeadPilot)
```

Expected: array includes `urlKey`, `createSelectionStore`, `SELECTORS`, `resolveText`, `resolveEl`. No console errors on load.

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "build: load lib modules before content.js"
```

---

## Task 5: Rewire selection to the store (fixes deselect-count + C1 counter)

Replace the `selectedLeads` array and DOM-derived counts with the store. This is the integration that makes the unit-tested fix real in the page.

**Files:**
- Modify: `content.js` — selection state (`:79`), `removeFromQueue` (`:100-123`), checkbox toggle (`:813-820`), panel render counts (`:1055`, `:1077`, `:1084`), select-all state (`:331-344`).

- [ ] **Step 1: Replace the array declaration with a store instance**

Find (near `content.js:79`):

```js
let selectedLeads = [];
```

Replace with:

```js
const selectionStore = window.LeadPilot.createSelectionStore();
// Back-compat shim: code paths still reading `selectedLeads` get a live snapshot.
Object.defineProperty(window, '__lpSelected', { get: () => selectionStore.values() });
```

- [ ] **Step 2: Make checkbox toggle drive the store, keyed by URL stamped on the row**

In the checkbox change handler (around `content.js:813-820`), replace the add/remove branch with:

```js
// `row` is the hooked row element; stamp identity once so we never re-extract on toggle.
if (!row.dataset.lpRow) {
  const data = extractFromRow(row);
  row.dataset.lpRow = data.linkedinUrl || '';
  row._lpData = data;
}
const data = row._lpData || extractFromRow(row);

if (linkedinCheckbox.checked) {
  selectionStore.add(data);
  row.classList.add('lp-row-selected');
} else {
  selectionStore.remove(row.dataset.lpRow);   // remove by stable key — the bug fix
  row.classList.remove('lp-row-selected');
}
```

- [ ] **Step 3: Replace `removeFromQueue` (index-based) with key-based removal**

Find `function removeFromQueue(` (around `content.js:100`). Replace its entire body with:

```js
function removeFromQueue(url) {
  const removed = selectionStore.remove(url);
  if (removed) {
    // reflect on any visible row with this identity
    const key = window.LeadPilot.urlKey(url);
    document.querySelectorAll('[data-lp-row]').forEach(row => {
      if (window.LeadPilot.urlKey(row.dataset.lpRow) === key) {
        row.classList.remove('lp-row-selected');
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      }
    });
  }
  return removed;
}
```

- [ ] **Step 4: Fix the panel "remove" buttons to pass the URL, not an index**

In the panel render (around `content.js:1077`), change the remove button markup to carry the URL:

```js
`<button class="lp-lead-remove" data-url="${escapeAttr(lead.linkedinUrl)}" title="Remove">×</button>`
```

And its click handler (around `content.js:1084`):

```js
btn.addEventListener('click', () => removeFromQueue(btn.dataset.url));
```

- [ ] **Step 5: Fix the "/ Y on page" counter (C1) and render from the store**

In the panel render counts (around `content.js:1055`), replace:

```js
const totalOnPage = document.querySelectorAll('.lp-row-checkbox:not(#lp-select-all-cb)').length;
```

with:

```js
const totalOnPage = document.querySelectorAll('[data-lp-row]').length;
const selectedCount = selectionStore.size();
```

Ensure the count label uses `selectedCount` (the store), and the leads list iterates `selectionStore.values()` instead of the old array.

- [ ] **Step 6: Re-render panel/counters whenever the store changes**

After the store is created (Step 1), add a single subscription near panel setup:

```js
selectionStore.subscribe(() => {
  renderPanel();        // existing panel render fn — now reads from the store
  updateSelectAllState();
});
```

- [ ] **Step 7: Derive select-all state from the store**

In `updateSelectAllState` (around `content.js:331-344`), compute checked/indeterminate from the store vs. visible rows:

```js
const rows = document.querySelectorAll('[data-lp-row]');
const total = rows.length;
let selected = 0;
rows.forEach(r => { if (selectionStore.has(r.dataset.lpRow)) selected++; });
const cb = document.getElementById('lp-select-all-cb');
if (cb) {
  cb.checked = total > 0 && selected === total;
  cb.indeterminate = selected > 0 && selected < total;
}
```

- [ ] **Step 8: Manual verification of the bug fix**

Manual on a live Sales Navigator search page (reload the extension first):
1. Enter LeadPilot mode. Check 3 leads → panel count shows `3`, "X / Y on page" shows `3 / <N>`.
2. Uncheck one lead → **count immediately shows `2`** (this is the reported bug — confirm it decrements).
3. Remove a lead via the panel × button → count shows `1`, the row's checkbox + highlight clear.
4. Select-all checkbox toggles all visible rows and reflects indeterminate state.

Record the result. Expected: every count change is immediate and consistent.

- [ ] **Step 9: Commit**

```bash
git add content.js
git commit -m "fix: drive selection + counters from store; deselect decrements (C1/C2/C3)"
```

---

## Task 6: Remove account-risk profile fetching (§9)

Keep only the passive page-data read. Remove the background page fetch and the internal `sales-api` call.

**Files:**
- Modify: `content.js` — `fetchLinkedInProfileUrl` (`:661-706`), its call site (`:829-836`), `pendingProfileFetches` references (`:82`, `:1094-1102`).

- [ ] **Step 1: Reduce `fetchLinkedInProfileUrl` to passive-only**

Replace the entire `fetchLinkedInProfileUrl` function (`content.js:661-706`) with:

```js
// ACCOUNT SAFETY (spec §9): passive only — read profile id from already-loaded
// page data. No background page fetch, no internal sales-api calls.
function resolveProfileUrlPassive(salesNavUrl) {
  return findPublicIdOnCurrentPage(salesNavUrl) || '';
}
```

- [ ] **Step 2: Update the call site to be synchronous and non-fetching**

At the former call site (around `content.js:829-836`), replace the `fetchLinkedInProfileUrl(...).then(...)` block with:

```js
data.linkedinProfileUrl = resolveProfileUrlPassive(data.linkedinUrl);
```

- [ ] **Step 3: Remove the now-unused `pendingProfileFetches` await**

Delete the `pendingProfileFetches` declaration (`content.js:82`) and the await loop that drains it before opening the modal (`content.js:1094-1102`). The modal opens immediately since resolution is now synchronous.

- [ ] **Step 4: Grep to confirm no risky calls remain**

Run: `grep -nE "sales-api|fetch\(salesNavUrl|fetchLinkedInProfileUrl|pendingProfileFetches" content.js`
Expected: **no matches**. (If `findPublicIdOnCurrentPage` itself contains a `fetch`, inspect and remove that too — it must only read the DOM/embedded JSON.)

- [ ] **Step 5: Manual verification**

Manual: open DevTools → Network tab, filter to `linkedin.com`. Select several leads and open the review modal. Expected: **no new requests** to `/sales/lead/...` profile pages or `/sales-api/...`. The `LinkedIn Profile URL` field is populated when the id was on the page, empty otherwise; the Sales Nav URL is always present.

- [ ] **Step 6: Commit**

```bash
git add content.js
git commit -m "security: remove background profile fetch + internal API calls (account safety §9)"
```

---

## Task 7: Replace polling with a scoped MutationObserver + lifecycle teardown

Fixes the leaks (M2/m4/m6) and the virtualization desync (M1) and the query-string queue-wipe (M4).

**Files:**
- Modify: `content.js` — `setInterval(main, 1500)` (`:1727`), profile-URL observer (`:590-634`, `:1725`), SPA-nav compare (`:1690-1710`), document-level listeners (`:350`, `:422-429`, `:911-935`).

- [ ] **Step 1: Add a single lifecycle owner near the top of `content.js`**

```js
const lpLifecycle = {
  _cleanups: [],
  add(fn) { this._cleanups.push(fn); },
  addListener(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    this.add(() => target.removeEventListener(type, handler, opts));
  },
  teardown() { this._cleanups.splice(0).forEach(fn => { try { fn(); } catch (e) {} }); },
};
```

- [ ] **Step 2: Locate the results container and observe only it, debounced**

Add:

```js
let lpObserver = null;
function startResultsObserver() {
  if (lpObserver) { lpObserver.disconnect(); lpObserver = null; }
  const anchor = document.querySelector(window.LeadPilot.SELECTORS.leadAnchor.join(','));
  const container =
    (anchor && anchor.closest(window.LeadPilot.SELECTORS.resultsContainer.join(','))) ||
    document.querySelector(window.LeadPilot.SELECTORS.resultsContainer.join(',')) ||
    document.body;

  let scheduled = false;
  lpObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      hookLinkedInCheckboxes();   // existing hook fn (idempotent via data-lp-hooked)
      reconcileRowVisuals();      // Step 3
    });
  });
  lpObserver.observe(container, { childList: true, subtree: true });
  lpLifecycle.add(() => { if (lpObserver) lpObserver.disconnect(); lpObserver = null; });
}
```

- [ ] **Step 3: Add a reconciliation pass (fixes recycled-row stale state, M1)**

```js
function reconcileRowVisuals() {
  document.querySelectorAll('[data-lp-row]').forEach(row => {
    const selected = selectionStore.has(row.dataset.lpRow);
    row.classList.toggle('lp-row-selected', selected);
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = selected;
  });
}
```

- [ ] **Step 4: Normalize the SPA-nav URL compare (M4) and only reset on real list change**

Replace the `window.location.href` comparison in `main()` (`content.js:1690-1710`) with a path-only compare so query/pagination changes don't wipe the queue:

```js
const currentPath = location.pathname;   // ignore query + hash
if (currentPath !== lastPath) {
  lastPath = currentPath;
  lpLifecycle.teardown();     // remove old observers/listeners
  selectionStore.clear();     // genuine context change → reset queue
  // re-inject UI + re-hook for the new page
  startResultsObserver();
}
```

(Declare `let lastPath = location.pathname;` where `lastPageUrl` was declared.)

- [ ] **Step 5: Remove the old polling + body-wide observer**

Delete `setInterval(main, 1500)` (`content.js:1727`) and replace the call to `initProfileUrlObserver()` (`:1725`) — that observer watched all of `document.body` for the profile-fetch flow which no longer exists. Remove `initProfileUrlObserver` (`:590-634`) entirely. Run `main()` once on load and let the MutationObserver drive subsequent updates:

```js
main();
startResultsObserver();
```

- [ ] **Step 6: Route document-level listeners through the lifecycle owner**

For the drag listeners (`content.js:911-935`), the keydown handler (`:350`), and the tab-selector outside-click (`:422-429`), change `document.addEventListener(...)` to `lpLifecycle.addListener(document, ...)` so they're torn down on SPA nav and never accumulate.

- [ ] **Step 7: Manual verification**

Manual on a live Sales Navigator search page:
1. Select 3 leads, scroll down to load more (infinite scroll), scroll back up. Expected: original 3 still show checked + highlighted; no stale highlights on newly-recycled rows.
2. Change a filter (URL query changes) without leaving the list. Expected: **queue is preserved** (count unchanged).
3. Navigate to a different list / page path. Expected: queue resets to 0.
4. Leave the page open 5 minutes interacting; in DevTools console run `getEventListeners(document)` (Chrome) before and after several filter changes. Expected: listener counts do **not** grow unbounded.

- [ ] **Step 8: Commit**

```bash
git add content.js
git commit -m "perf: scoped MutationObserver + lifecycle teardown; preserve queue on query change (M1/M2/M4)"
```

---

## Task 8: Run full unit suite + final manual smoke

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: PASS — all `urlKey`, `selectionStore`, `selectors` suites green.

- [ ] **Step 2: Full manual smoke on live Sales Navigator**

Reload the extension, then verify end-to-end: enter LeadPilot mode → select/deselect (counts correct) → select-all → open review modal (opens instantly, no network calls) → confirm save still writes to the sheet. Record results.

- [ ] **Step 3: Final commit / tag**

```bash
git add -A
git commit -m "test: core selection-store + safety plan complete"
```

---

## Self-Review (completed by author)

- **Spec coverage:** C1 (Task 5.5), C2/C3 (Tasks 1–2, 5), M1 (Task 7.3), M2/m4/m6 (Task 7), M4 (Task 7.4), §9 account safety (Task 6), §4 robustness selectors (Task 3, 7.2). Visual redesign, review-modal, popup, and Apps Script dedupe are intentionally deferred to plans 2–4.
- **Placeholder scan:** no TBD/“handle edge cases”/“similar to” — all code shown inline.
- **Type/name consistency:** `selectionStore` API (`add/remove/has/toggle/clear/subscribe/size/keys/values`) used consistently across Tasks 2, 5, 7; `urlKey` and `SELECTORS`/`resolveText` names match across modules and call sites; row identity is `data-lp-row` (the URL) everywhere; `removeFromQueue(url)` takes a URL in both definition (5.3) and call sites (5.4).
- **Known integration caveat:** exact line numbers reference the current `content.js`; the implementer should match by the quoted code, not the line number, since edits shift lines. Each modify-step quotes the find target.
