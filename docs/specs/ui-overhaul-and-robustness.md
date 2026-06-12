# LeadPilot — UI Overhaul, Bug Fixes & DOM Robustness Spec

**Status:** Draft for review
**Date:** 2026-06-09
**Author:** surabh@atliq.com (design via Claude Code)

---

## 1. Goal

Overhaul the LeadPilot Chrome extension's injected UI on LinkedIn Sales Navigator to a distinctive, production-grade "OPERATOR" design, while fixing the selection/counter bugs found in audit and making the extension **resilient to Sales Navigator DOM changes** so it doesn't silently break when LinkedIn ships layout updates.

Three surfaces are redesigned:
1. **In-page injected UI** — mode bar, "Select All" bar, per-row custom checkboxes, floating selection panel.
2. **Minimized pill** — collapsed state of the panel.
3. **Review modal** — the pre-save edit/confirm dialog.

Reference mockups (final, approved): `.superpowers/brainstorm/.../operator-v9-final.html` and `.../review-modal.html`.

---

## 2. Design System

### 2.1 Aesthetic — "OPERATOR"
A specialized instrument, not a consumer app. Dark overlay surfaces floating over LinkedIn's light UI, quiet until they need attention.

| Token | Value | Use |
|---|---|---|
| `--accent` | `#4361c2` | Primary indigo-slate (buttons, selected border, checkbox fill) |
| `--accent-pop` | `#8aa1ec` | Brightened accent for text/icons on dark (AA contrast) |
| `--accent-light` | `rgba(67,97,194,0.07)` | Subtle fills / selected-row wash |
| `--overlay` | `#131316` | Panel/modal base |
| `--surface` / `--surface2` / `--surface3` | `#1d1d22` / `#26262d` / `#2e2e38` | Layered dark surfaces |
| `--border` | `#34343f` | Hairline borders |
| `--txt-hi` / `--txt-body` / `--txt-mut` / `--txt-dim` | `#f4f5fa` / `#c4c6d6` / `#9a9cb0` / `#7d8095` | Text contrast ramp (all AA on dark) |
| `--green` / `--amber` | `#34d399` / `#fbbf24` | Success / duplicate-warning |

**Fonts:** `Plus Jakarta Sans` (all UI text) + `DM Mono` (counts, dates, URLs, numeric data). Bundle as web-safe fallbacks; **self-host the font files** in the extension (do not hotlink Google Fonts — CSP and offline reliability). LinkedIn's own rows keep their native font stack untouched.

### 2.2 Component spec

**Mode bar** — dark pill-bar, two segments (LeadPilot Mode / Sales Nav Mode). Active segment = solid `--accent`; idle = transparent with `--txt-mut`. Each carries a `DM Mono` count chip.

**Select All bar** — full-width, `--accent-light` fill + `--accent-mid` border, square accent-outlined checkbox, label "Select All for LeadPilot", and a `DM Mono` "`N / M on page`" counter.

**Per-row checkbox** — 18px, 3px radius. Off: `#c4c2bd` border on white. On: filled `--accent` + white SVG checkmark. Selected row also gets a 3px `--accent` left-border and a faint left-to-right wash, plus an `LP` badge beside the name.

**Floating panel** (336px, fixed top-right):
- Header: brand mark + "LeadPilot" + large `DM Mono` selected count. (No "LP Mode" pill — the mode bar already conveys mode.)
- Summary strip: `Queued / On page / Dupes` counts.
- Lead cards: avatar, name, title, remove button; a divided detail row showing **Company + Location only** (connection-degree removed as overkill).
- Footer: "Save to sheet tab" selector + primary "Save N Leads to Sheet" button + `Ctrl+L` quick-save hint.

**Minimized pill** — bottom-right, pulse dot + "LeadPilot" + count chip. Click to restore panel.

**Review modal** (720px, centered, dark): header (brand + count + close), "Saving to: <tab>" bar, bulk-apply row (Industry/Status + Apply to All), scrollable collapsible per-lead cards (all current fields: first/last name, Sales Nav URL + LinkedIn Profile URL with inline Edit, company/title, country/city, industry+status dropdowns with color dot, notes), duplicate cards flagged amber, footer with `N unique · M duplicate` summary + Cancel + "Confirm & Save N".

### 2.3 Isolation
All injected overlay UI (panel, pill, modal, mode bar) renders inside a **Shadow DOM root** with styles scoped inside it, so LinkedIn CSS cannot clobber LeadPilot and vice versa. Per-row checkboxes (which must live inside LinkedIn's row DOM) use `lp-`-prefixed classes with high-specificity scoped rules and avoid relying on inherited styles.

---

## 3. Bug Fixes (from audit)

### Critical
- **C2/C3 — Deselect doesn't decrement count (root cause).** Selection lives in three drifting places: the `selectedLeads` array, the row's `.lp-row-selected` class + native `checkbox.checked`, and a DOM-derived counter. On deselect the row is re-extracted from a possibly re-rendered DOM, the URL lookup fails, `removeFromQueue` is never called, and the array (hence count) never decrements. **Fix:** single source of truth — a `Map` keyed by stable lead id (canonical URL). All UI (row class, checkbox, panel, counters) is *derived* from the store. Removal is by key, never by array index or re-extraction.
- **C1 — "`/ Y on page`" always 0.** `content.js:1055` queries `.lp-row-checkbox:not(#lp-select-all-cb)`, which only ever matches the select-all box. **Fix:** count hooked rows via the row registry / `[data-lp-row]`.

### Major
- **M1 — Virtualization desync.** Recycled/re-rendered rows lose `data-lp-hooked` and `.lp-row-selected`; selection visuals aren't restored and recycled nodes can show stale highlight. **Fix:** after every (re)hook, reconcile each visible row's visual state against the store by key.
- **M3 — `pendingProfileFetches` never populated.** ⚠️ **Reversed for account safety — see §9.** Do NOT make the background fetches reliable; instead remove them. Profile URL resolves passively only.
- **M4 — Queue wiped on query-string-only URL changes.** SPA filter/pagination changes clear `selectedLeads`. **Fix:** compare normalized path (strip query/hash); only reset on real list-context change.
- **M5/M6 — Duplicate sheet rows on retry / no server dedupe.** Retry re-sends already-saved leads; Apps Script appends unconditionally. **Fix:** track per-lead save success and retry only failures; have `writeLeadToSheet` upsert by LinkedIn-URL column.

### Minor
- **M2/m4/m6 — Leaks:** profile-URL observer watches all of `document.body` forever; `setInterval(main,1500)` never clears; document-level drag/keydown/outside-click listeners accumulate across SPA re-injections. **Fix:** scope+disconnect observers, clear intervals on unknown pages, and register/teardown listeners through a single lifecycle owner.
- **m3 — Background "assume success on unparseable response"** masks real failures. **Fix:** treat non-JSON/non-2xx as failure.

---

## 4. DOM Robustness Strategy (primary requirement)

Sales Navigator uses auto-generated/hashed `artdeco-*` classes and changes layout without notice. The extension must degrade gracefully and **self-report** rather than silently die.

### 4.1 Centralized, ordered selector resolution
All selectors live in **one `SELECTORS` config module** (single place to update). Each logical target (row container, person name, profile link, company, location, job title, results container) is an **ordered candidate list**, tried until one resolves:

1. **Stable data attributes first** — `[data-anonymize="person-name" | "company-name" | "job-title" | "location"]`, `[data-view-name]`, `[data-x-*]`. These are semantic and survive cosmetic class churn.
2. **Href-pattern anchors** — match by `href` regex (`/sales/lead/`, `/sales/people/`, `/sales/company/`, `/in/`) rather than class/tag. Row identity = canonical profile URL.
3. **Structural fallbacks** — nearest ancestor `<li>`/`<tr>` that contains a lead anchor; subtitle = sibling text node; location = remaining cell text.
4. **`artdeco-*` classes last** — kept only as a final fallback, never primary.

### 4.2 Row identity & idempotency
- A row's identity is its **canonical LinkedIn URL** (query/hash stripped, host normalized), stored on the node as `data-lp-row="<url>"` at hook time so later operations never re-extract from a mutated DOM.
- Injection is idempotent: guard with `data-lp-hooked`; never double-inject checkboxes/listeners.

### 4.3 MutationObserver instead of polling
- Replace the 1.5s `setInterval` with a **debounced MutationObserver scoped to the results container** (located by walking up from the first detected row). On mutation: detect new rows, hook them, and **reconcile** visual selection state from the store.
- Re-locate the container if it's removed; disconnect + re-attach on real SPA navigation. Never observe all of `document.body`.

### 4.4 Defensive extraction
- Every field extraction is wrapped so a single missing field yields partial data, never a thrown error that breaks the hook loop.
- Geography uses `[data-anonymize="location"]` as **primary** (drop the hardcoded country word-list to a last-resort heuristic).

### 4.5 Self-healing & visible failure
- **Health check** after each hook pass: if the page looks like a results page but **zero rows resolved**, log a structured diagnostic and retry once with the full fallback chain.
- If still zero, show a **non-blocking banner** in the panel: *"Couldn't detect leads — Sales Navigator's layout may have changed."* Failures become visible instead of a dead, silent extension.
- A single `SELECTOR_VERSION` constant + the centralized config make a future selector update a one-file change shippable via normal extension update.

### 4.6 Listener/observer lifecycle
A single lifecycle owner registers every observer, interval, and document-level listener and tears them all down on SPA navigation / teardown, preventing the accumulation leaks (M2/m6).

---

## 5. Architecture changes

- **`selectionStore`** — `Map<canonicalUrl, LeadData>` as the single source of truth; emits change events. Pure module, unit-testable.
- **`render(store)`** — panel/pill/counters are pure functions of the store; no DOM-derived counts.
- **`selectors.js`** — the centralized ordered-selector config + resolver (`resolve(target, root)`).
- **`domBridge`** — hooks rows, owns the MutationObserver, reconciles row visuals from the store, owns lifecycle teardown.
- **Shadow DOM host** for overlay UI; self-hosted fonts.
- Apps Script `writeLeadToSheet` → upsert by URL column.

---

## 6. Build sequence

1. `selectionStore` + selector config/resolver (pure modules).
2. `domBridge`: row hooking, MutationObserver, reconciliation, lifecycle teardown. → fixes C2/C3/M1/M2/M4.
3. Re-render panel/pill/counters from store; fix `/ Y on page` (C1).
4. New design CSS in Shadow DOM; self-host fonts; custom checkboxes.
5. Review modal redesign (keep all fields/handlers; new styling; `N unique · M dup` footer).
6. Save flow: populate `pendingProfileFetches` (M3); per-lead retry (M5); Apps Script upsert (M6); background failure handling (m3).
7. Health check + visible-failure banner.
8. Manual verification on a live Sales Navigator list (scroll/paginate/SPA-nav/deselect/duplicate paths).

---

## 9. Account Safety (hard constraint)

The user's LinkedIn account must not be put at risk of restriction. LinkedIn detects automation primarily via **server-side signals**: background requests to pages the user didn't navigate to, and calls to internal APIs. Passive DOM work (reading already-rendered content, overlaying our own UI) produces no such signal.

**Risky behavior in current code — to be removed:**
- `fetchLinkedInProfileUrl()` Strategy 2 (`content.js:668`) — background `fetch()` of Sales Nav profile pages the user didn't open. **Remove.**
- Strategy 3 (`content.js:689`) — direct calls to LinkedIn's internal `sales-api` with the user's CSRF token. **Remove.**
- `setMode()` synthetic `cb.click()` (`content.js:186`) — replace with controlled `.checked` state + scoped events so LinkedIn's own bulk-action handlers never fire.

**Kept (safe):**
- `fetchLinkedInProfileUrl()` Strategy 1 (`content.js:663`, `findPublicIdOnCurrentPage`) — reads profile data already embedded in the current page. No network request.
- All redesign, row reading, state store, Shadow DOM, MutationObserver — passive overlay only.

**Tradeoff:** profile `/in/` URL resolves only when present in already-loaded page data; otherwise the field is left empty. The Sales Navigator URL is always captured. No bulk background loads, ever. This supersedes audit item M3.

### §9 UPDATE (2026-06-09) — user reinstated auto-fetch with risk mitigations
After seeing that passive-only left the LinkedIn Profile URL column largely empty for search-result leads, the user opted back into automatic resolution, explicitly accepting the risk, and asked to "do everything to reduce the risk." Current behavior:
- **Strategy 1 (passive page read)** runs first and short-circuits with no network call whenever the id is already on the page.
- **Strategies 2 (profile-page fetch) and 3 (internal sales-api)** are restored as fallbacks but are gated behind a **throttled background queue** with these mitigations:
  - **Sequential only** — one resolve at a time, never parallel bursts.
  - **Jittered delays** (~1.5–4s, randomized) between network resolves — fixed cadences are the easiest automation signal; randomization mimics human pacing.
  - **Dedupe** — a given lead is fetched at most once per session.
  - **Lazy/spread** — resolution is queued at selection time so requests spread over the user's working time rather than firing in a burst at save.
  - **Skip-if-deselected** — queued leads removed before processing are skipped (no wasted requests).
  - Save waits (capped ~12s) for the queue to drain so the review modal shows resolved URLs; unresolved ones remain editable.
- Residual risk remains non-zero (any request to LinkedIn for a page/endpoint the user didn't open is detectable). This is the user's accepted tradeoff for fill-rate.

---

## 7. Decisions (confirmed) & out of scope

**Confirmed with user (2026-06-09):**
- **Profile URLs: passive-only.** Strategy 1 kept; Strategies 2 & 3 removed. (§9)
- **Popup: restyle to match** the OPERATOR design system — now in scope.
- **Shadow DOM: adopted** for all injected overlay UI.

**Out of scope:**
- New backend features beyond the dedupe upsert.
- Non–Sales-Navigator LinkedIn surfaces beyond current profile-page support.

---

## 8. Acceptance criteria
- Deselecting any lead (row checkbox, panel remove, or mode switch) decrements the count immediately and consistently. ✅ the reported bug.
- "`N / M on page`" shows correct live numbers.
- Selecting → infinite-scroll → scrolling back preserves selection visuals; no stale highlights on recycled rows.
- Query-string filter/pagination changes do **not** wipe the queue.
- Retrying a partially failed save creates **no** duplicate rows.
- Simulated selector breakage (rename primary classes) still resolves rows via fallbacks; total breakage shows the banner, not a silent no-op.
- No unbounded growth of listeners/observers over a long session.
- All injected overlay UI visually matches the approved mockups and is unaffected by LinkedIn CSS.
