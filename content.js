console.log('[LeadPilot] Content Script v3.0 — Review Modal');

// =============================================
// CONSTANTS
// =============================================
const INDUSTRY_OPTIONS = [
    'Technology', 'Finance & Banking', 'Healthcare', 'Manufacturing',
    'Retail & E-Commerce', 'Education', 'Real Estate', 'Consulting',
    'Marketing & Advertising', 'Media & Entertainment', 'Telecommunications',
    'Transportation & Logistics', 'Energy & Utilities', 'Legal Services',
    'Hospitality & Tourism', 'Agriculture', 'Construction', 'Pharmaceutical',
    'Automotive', 'Non-Profit', 'Government', 'Other'
];

const STATUS_OPTIONS = [
    'Pending', 'Requested', 'Connected', 'First Message Done', 'Replied', 'In Conversation'
];

const STATUS_COLORS = {
    'Pending': '#94a3b8',
    'Requested': '#f59e0b',
    'Connected': '#22c55e',
    'First Message Done': '#3b82f6',
    'Replied': '#14b8a6',
    'In Conversation': '#a855f7'
};

// =============================================
// HELPERS
// =============================================
function getText(selectors, context = document) {
    if (typeof selectors === 'string') selectors = [selectors];
    for (const sel of selectors) {
        try {
            const el = context.querySelector(sel);
            if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
        } catch (e) { }
    }
    return '';
}

function isActualJobTitle(text) {
    if (!text) return false;
    text = text.trim();
    if (/^\d+\s*(year|month|day)s?\b/i.test(text) && /\b(in\s+(role|company)|ago)\b/i.test(text)) return false;
    if (/^\d+\s*(year|month|day)s?\s*$/i.test(text)) return false;
    if (/^\d+\s*(year|month)s?\s+\d+\s*(year|month|day)s?/i.test(text)) return false;
    return true;
}

function getValidJobTitle(selectors, context = document) {
    if (typeof selectors === 'string') selectors = [selectors];
    for (const sel of selectors) {
        try {
            const els = context.querySelectorAll(sel);
            for (const el of els) {
                const txt = el.innerText?.trim();
                if (txt && isActualJobTitle(txt)) return txt;
            }
        } catch (e) { }
    }
    return '';
}

// =============================================
// PAGE TYPE DETECTION
// =============================================
function getPageType() {
    const url = window.location.href;
    if (url.includes('/sales/lists/people') || url.includes('/sales/search/people')) return 'list';
    if (url.includes('/sales/lead/') || url.includes('/sales/people/')) return 'profile';
    if (url.includes('/in/')) return 'linkedin-profile';
    return 'unknown';
}

// =============================================
// SELECTED LEADS QUEUE
// =============================================
let selectedLeads = [];
let lastSavedLeads = null; // For undo functionality
let undoTimeout = null;
const pendingProfileFetches = new Map(); // linkedinUrl -> Promise
const linkedInProfileUrlCache = new Map(); // salesNavUrl -> linkedinProfileUrl
let lastObservedProfileUrl = '';

// Mode: 'leadpilot' or 'salesnav' — persisted via chrome.storage
let lpMode = 'leadpilot';
chrome.storage.sync.get(['lpMode'], (result) => {
    if (result.lpMode) lpMode = result.lpMode;
});

function addToQueue(data) {
    if (selectedLeads.find(l => l.linkedinUrl === data.linkedinUrl)) return false;
    selectedLeads.push(data);
    renderPanel();
    updateSelectAllState();
    return true;
}

function removeFromQueue(index) {
    const removed = selectedLeads[index];
    selectedLeads.splice(index, 1);

    // Remove highlight from the corresponding row on the page
    if (removed && removed.linkedinUrl) {
        document.querySelectorAll('[data-lp-hooked] a[href*="/sales/lead/"], [data-lp-hooked] a[href*="/sales/people/"]').forEach(linkEl => {
            const rowUrl = linkEl.href.split('?')[0];
            if (rowUrl === removed.linkedinUrl) {
                const row = linkEl.closest('tr, li, div[data-view-name]');
                if (row) {
                    row.classList.remove('lp-row-selected');
                    removeCheckboxGlow(row);
                    // Uncheck the native checkbox
                    const cb = row.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = false;
                }
            }
        });
    }

    renderPanel();
    updateSelectAllState();
}

function clearQueue() {
    selectedLeads = [];
    document.querySelectorAll('.lp-row-selected').forEach(el => {
        el.classList.remove('lp-row-selected');
        removeCheckboxGlow(el);
        // Uncheck the native checkbox
        const cb = el.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
    });
    renderPanel();
    updateSelectAllState();
}

// =============================================
// MODE TOGGLE BAR
// =============================================
function injectModeToggle() {
    if (document.getElementById('lp-mode-bar')) {
        updateModeBarUI();
        return;
    }
    const bar = document.createElement('div');
    bar.id = 'lp-mode-bar';
    bar.innerHTML = `
        <div class="lp-mode-bar-inner">
            <button id="lp-mode-btn-lp" class="lp-mode-btn lp-mode-btn-lp">
                <span class="lp-mode-dot"></span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                LeadPilot Mode
                <span class="lp-mode-count" id="lp-mode-count-lp"></span>
            </button>
            <button id="lp-mode-btn-sn" class="lp-mode-btn lp-mode-btn-sn">
                <span class="lp-mode-dot"></span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                Sales Nav Mode
                <span class="lp-mode-count" id="lp-mode-count-sn"></span>
            </button>
        </div>
    `;
    // Append to body since it's position:fixed — no container dependency
    document.body.appendChild(bar);

    document.getElementById('lp-mode-btn-lp').addEventListener('click', () => setMode('leadpilot'));
    document.getElementById('lp-mode-btn-sn').addEventListener('click', () => setMode('salesnav'));
    updateModeBarUI();
}

function setMode(mode) {
    if (lpMode === mode) return;
    // Clear existing selections when switching mode
    if (lpMode === 'leadpilot') {
        clearQueue();
        // Remove Select All bar (not needed in Sales Nav mode)
        const selectAllBar = document.getElementById('lp-select-all-bar');
        if (selectAllBar) selectAllBar.remove();
    } else {
        // Uncheck any LinkedIn-natively-selected checkboxes
        document.querySelectorAll('[data-lp-hooked]').forEach(row => {
            const cb = row.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) {
                row.dataset.lpLetThrough = 'true';
                cb.click();
            }
        });
    }
    lpMode = mode;
    chrome.storage.sync.set({ lpMode: mode });
    updateModeBarUI();
    // Re-inject Select All if switching to LeadPilot
    if (mode === 'leadpilot') {
        injectSelectAll();
    }
}

function updateModeBarUI() {
    const lpBtn = document.getElementById('lp-mode-btn-lp');
    const snBtn = document.getElementById('lp-mode-btn-sn');
    if (!lpBtn || !snBtn) return;

    lpBtn.classList.toggle('lp-mode-active', lpMode === 'leadpilot');
    snBtn.classList.toggle('lp-mode-active', lpMode === 'salesnav');

    // Update counts
    const lpCount = document.getElementById('lp-mode-count-lp');
    const snCount = document.getElementById('lp-mode-count-sn');
    if (lpCount) lpCount.textContent = selectedLeads.length > 0 ? `(${selectedLeads.length})` : '';
    if (snCount) {
        const snSelected = document.querySelectorAll('[data-lp-hooked] input[type="checkbox"]:checked').length;
        snCount.textContent = snSelected > 0 ? `(${snSelected})` : '';
    }
}

// =============================================
// SELECT ALL FOR LEADPILOT
// =============================================
function injectSelectAll() {
    if (lpMode !== 'leadpilot') return;
    try {
        if (document.getElementById('lp-select-all-bar')) return;
        const container = document.querySelector(
            'div.search-results__result-list, ol.artdeco-list, table.artdeco-models-table, ' +
            'div[data-view-name="lead-search-results"], div.lists-detail__table-body-container'
        );
        if (!container || !container.parentElement) return;

        const bar = document.createElement('div');
        bar.id = 'lp-select-all-bar';
        bar.innerHTML = `
            <label class="lp-select-all-label">
                <input type="checkbox" id="lp-select-all-cb" class="lp-row-checkbox">
                <span class="lp-checkmark"></span>
                <span class="lp-select-all-text">Select All for LeadPilot</span>
                <span id="lp-page-count" class="lp-page-count"></span>
            </label>
        `;
        // Insert after the mode bar
        const modeBar = document.getElementById('lp-mode-bar');
        if (modeBar && modeBar.nextSibling) {
            container.parentElement.insertBefore(bar, modeBar.nextSibling);
        } else {
            container.parentElement.insertBefore(bar, container);
        }

        document.getElementById('lp-select-all-cb').addEventListener('change', async (e) => {
            const checked = e.target.checked;
            const textEl = bar.querySelector('.lp-select-all-text');
            if (checked) {
                textEl.textContent = 'Loading all leads...';
                await scrollToLoadAllRows();
                hookLinkedInCheckboxes(true);
                selectAllRowsForLeadPilot();
            } else {
                clearQueue();
            }
            textEl.textContent = 'Select All for LeadPilot';
            updateSelectAllState();
        });
    } catch (err) {
        console.warn('[LeadPilot] Select All injection skipped:', err.message);
    }
}

function selectAllRowsForLeadPilot() {
    const rows = document.querySelectorAll('[data-lp-hooked]');
    rows.forEach(row => {
        if (row.classList.contains('lp-row-selected')) return;
        const data = extractFromRow(row);
        if (data.linkedinUrl) {
            addToQueue(data);
            row.classList.add('lp-row-selected');
            applyCheckboxGlow(row, 'leadpilot');
            // Tick the native checkbox
            const cb = row.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = true;
        }
    });
}

// Scroll the results container to load all lazy rows
function scrollToLoadAllRows() {
    return new Promise((resolve) => {
        // Find the scrollable container (LinkedIn uses different ones)
        const scrollEl = document.querySelector(
            '.search-results__result-list, .os-viewport, ' +
            'div[class*="lead-list"] .os-viewport, main, ' +
            '.artdeco-card .os-viewport'
        ) || document.scrollingElement || document.documentElement;

        let lastHeight = 0;
        let sameCount = 0;
        const maxScrolls = 20;
        let scrollCount = 0;

        const scrollStep = () => {
            scrollEl.scrollTop = scrollEl.scrollHeight;
            window.scrollTo(0, document.body.scrollHeight);
            scrollCount++;

            const currentHeight = scrollEl.scrollHeight + document.body.scrollHeight;
            if (currentHeight === lastHeight) {
                sameCount++;
            } else {
                sameCount = 0;
            }
            lastHeight = currentHeight;

            // Stop if no new content loaded (2 consecutive same) or max scrolls
            if (sameCount >= 2 || scrollCount >= maxScrolls) {
                // Scroll back to top
                scrollEl.scrollTop = 0;
                window.scrollTo(0, 0);
                setTimeout(resolve, 300);
                return;
            }
            setTimeout(scrollStep, 400);
        };
        scrollStep();
    });
}

// Inject checkboxes without re-calling injectSelectAll (avoids recursion)
// This function is kept as a compatibility stub — now just hooks new rows
function injectListCheckboxes_noSelectAll() {
    hookLinkedInCheckboxes(true);
}

function updateSelectAllState() {
    const selectAllCb = document.getElementById('lp-select-all-cb');
    if (!selectAllCb) return;
    const allRows = document.querySelectorAll('[data-lp-hooked]');
    const selectedRows = document.querySelectorAll('[data-lp-hooked].lp-row-selected');
    selectAllCb.checked = allRows.length > 0 && selectedRows.length === allRows.length;
    selectAllCb.indeterminate = selectedRows.length > 0 && selectedRows.length < allRows.length;

    // Update page count
    const pageCount = document.getElementById('lp-page-count');
    if (pageCount) {
        pageCount.textContent = `(${selectedRows.length}/${allRows.length})`;
    }
}

// =============================================
// KEYBOARD SHORTCUTS
// =============================================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+L = Save all selected leads
        if (e.ctrlKey && !e.shiftKey && e.key === 'l') {
            e.preventDefault();
            if (selectedLeads.length > 0) {
                saveAllLeads();
            }
        }
    });
}

// =============================================
// TAB SELECTION — reads from chrome.storage
// =============================================
function getTabSelectorHTML() {
    return `
    <div class="lp-section lp-tab-section" id="lp-tab-section">
        <div class="lp-section-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            <span>Save To</span>
            <button id="lp-refresh-tabs" class="lp-mini-btn" title="Refresh tabs">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
            </button>
        </div>
        <button id="lp-tab-selector-btn" class="lp-tab-selector-btn">
            <span id="lp-tab-selector-label">No tabs selected</span>
            <svg class="lp-tab-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div id="lp-tab-dropdown" class="lp-tab-dropdown">
            <div id="lp-tab-checkboxes" class="lp-tab-checks">
                <span class="lp-tab-hint">Loading tabs...</span>
            </div>
        </div>
    </div>`;
}

function initTabSelector() {
    loadAndRenderTabs();

    // Listen for storage changes (when user adds/removes tabs in popup)
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes.sheetTabs || changes.selectedTabs)) {
            loadAndRenderTabs();
        }
    });

    // Set up dropdown toggle and outside-click close (once)
    setTimeout(() => {
        const refreshBtn = document.getElementById('lp-refresh-tabs');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                loadAndRenderTabs();
                refreshBtn.style.transform = 'rotate(360deg)';
                setTimeout(() => { refreshBtn.style.transform = ''; }, 400);
            });
        }

        const selectorBtn = document.getElementById('lp-tab-selector-btn');
        const dropdown = document.getElementById('lp-tab-dropdown');
        if (selectorBtn && dropdown) {
            selectorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropdown.classList.contains('lp-tab-dropdown-open');
                dropdown.classList.toggle('lp-tab-dropdown-open', !isOpen);
                const chevron = selectorBtn.querySelector('.lp-tab-chevron');
                if (chevron) chevron.style.transform = !isOpen ? 'rotate(180deg)' : '';
            });
            document.addEventListener('click', (e) => {
                const section = document.getElementById('lp-tab-section');
                if (section && !section.contains(e.target)) {
                    dropdown.classList.remove('lp-tab-dropdown-open');
                    const chevron = selectorBtn.querySelector('.lp-tab-chevron');
                    if (chevron) chevron.style.transform = '';
                }
            });
        }
    }, 150);
}

function loadAndRenderTabs() {
    chrome.storage.sync.get(['sheetTabs', 'selectedTabs'], (result) => {
        const tabs = result.sheetTabs || [];
        const selected = result.selectedTabs || [];
        console.log('[LeadPilot] Loaded tabs:', tabs, 'Selected:', selected);
        renderTabCheckboxes(tabs, selected);
    });
}

function updateTabSelectorLabel(tabs, selected) {
    const label = document.getElementById('lp-tab-selector-label');
    if (!label) return;
    const activeTabs = tabs.filter(t => selected.includes(t));
    if (activeTabs.length === 0) {
        label.textContent = 'No tabs selected';
    } else if (activeTabs.length <= 2) {
        label.textContent = activeTabs.join(', ');
    } else {
        label.textContent = activeTabs.slice(0, 2).join(', ') + ` +${activeTabs.length - 2}`;
    }
}

function renderTabCheckboxes(tabs, selected) {
    const container = document.getElementById('lp-tab-checkboxes');
    if (!container) return;

    if (tabs.length === 0) {
        container.innerHTML = `<span class="lp-tab-hint">Open LeadPilot popup → add tab names</span>`;
        updateTabSelectorLabel([], []);
        return;
    }

    container.innerHTML = tabs.map(tab => {
        const isChecked = selected.includes(tab) ? 'checked' : '';
        const id = 'lp-tab-' + tab.replace(/[^a-zA-Z0-9]/g, '_');
        return `
        <label class="lp-tab-check-item" for="${id}">
            <input type="checkbox" class="lp-tab-cb" id="${id}" value="${tab}" ${isChecked} />
            <span class="lp-tab-mark"></span>
            <span class="lp-tab-name">${tab}</span>
        </label>`;
    }).join('');

    // Save selection on any checkbox change
    container.querySelectorAll('.lp-tab-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const selectedTabs = getSelectedTabs();
            chrome.storage.sync.set({ selectedTabs });
            updateTabSelectorLabel(tabs, selectedTabs);
        });
    });

    // Update label to reflect current selection
    updateTabSelectorLabel(tabs, selected);
}

function getSelectedTabs() {
    const checks = document.querySelectorAll('.lp-tab-cb:checked');
    return Array.from(checks).map(cb => cb.value);
}

// =============================================
// EXTRACT FROM LIST ROW
// =============================================
function extractFromRow(row) {
    let fullName = getText([
        '[data-anonymize="person-name"]',
        'a[href*="/sales/lead/"] span',
        'a[href*="/sales/people/"] span',
        '.artdeco-entity-lockup__title a',
        '.artdeco-entity-lockup__title span',
        'a[href*="/sales/lead/"]',
        'a[href*="/sales/people/"]',
        'td:first-child a'
    ], row);
    fullName = fullName.replace(/·.*$/, '').replace(/\d+(st|nd|rd|th)/, '').trim();

    let linkedinUrl = '';
    const linkEl = row.querySelector('a[href*="/sales/lead/"], a[href*="/sales/people/"], .artdeco-entity-lockup__title a');
    if (linkEl) {
        linkedinUrl = linkEl.href.split('?')[0];
        if (linkedinUrl.startsWith('/')) linkedinUrl = 'https://www.linkedin.com' + linkedinUrl;
    }

    let jobTitle = getValidJobTitle([
        '[data-anonymize="job-title"]',
        '.artdeco-entity-lockup__subtitle',
        '.artdeco-entity-lockup__subtitle span',
        'span[class*="subtitle"]'
    ], row);
    if (!jobTitle) {
        jobTitle = getText([
            '[data-anonymize="job-title"]',
            '.artdeco-entity-lockup__subtitle'
        ], row);
    }

    let companyName = '';
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
        for (let i = 1; i < cells.length; i++) {
            const companyLink = cells[i].querySelector('a[href*="/sales/company/"], a[href*="/company/"]');
            if (companyLink) { companyName = companyLink.innerText.trim(); break; }
        }
    }
    if (!companyName) companyName = getText(['[data-anonymize="company-name"]', 'a[href*="/sales/company/"]'], row);
    companyName = companyName.replace(/\(\+?\d+\)/, '').trim();

    let geography = '';
    if (cells.length >= 3) {
        for (let i = 2; i < cells.length; i++) {
            const cellText = cells[i].innerText?.trim() || '';
            if (cellText && (cellText.includes(',') || cellText.includes('United') || cellText.includes('India') || cellText.includes('Dubai'))) {
                if (!cellText.includes('activity') && !cellText.includes('Add note') && !cellText.includes('/20')) {
                    geography = cellText; break;
                }
            }
        }
    }
    if (!geography) geography = getText(['[data-anonymize="location"]', '.artdeco-entity-lockup__metadata'], row);

    let city = '', country = '';
    if (geography) {
        const parts = geography.split(',').map(s => s.trim());
        city = parts[0] || '';
        country = parts.length >= 2 ? parts[parts.length - 1] : '';
    }

    let firstName = '', lastName = '';
    if (fullName) {
        const nameParts = fullName.trim().split(/\s+/);
        firstName = nameParts[0] || '';
        lastName = nameParts.slice(1).join(' ') || '';
    }

    // Try to find the LinkedIn /in/ profile URL — cache first (populated by MutationObserver)
    let linkedinProfileUrl = linkedInProfileUrlCache.get(linkedinUrl) || '';
    if (!linkedinProfileUrl) {
        const profileLinkEl = row.querySelector('a[href*="linkedin.com/in/"], a[href*="/in/"]');
        if (profileLinkEl && !profileLinkEl.href.includes('/sales/')) {
            linkedinProfileUrl = profileLinkEl.href.split('?')[0];
            if (linkedinProfileUrl.startsWith('/')) linkedinProfileUrl = 'https://www.linkedin.com' + linkedinProfileUrl;
        }
    }

    return { firstName, lastName, linkedinUrl, linkedinProfileUrl, companyName, jobTitle, country, city, companyService: '', status: 'Pending' };
}

// =============================================
// FETCH LINKEDIN PROFILE URL FROM SALES NAV PAGE
// =============================================
// =============================================
// MUTATION OBSERVER — capture LinkedIn profile URLs
// from Sales Navigator's own preview panels / dropdowns
// =============================================

function initProfileUrlObserver() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Collect all linkedin.com/in/ links in the new subtree
                const allLinks = [];
                if (node.matches?.('a[href*="linkedin.com/in/"]')) allLinks.push(node);
                node.querySelectorAll?.('a[href*="linkedin.com/in/"]').forEach(l => allLinks.push(l));

                for (const link of allLinks) {
                    const href = link.href || '';
                    if (!href || href.includes('/sales/')) continue;
                    const profileUrl = href.split('?')[0];

                    // Look for the associated Sales Navigator URL in the same panel
                    const panel = link.closest(
                        '[class*="profile"], [class*="preview"], [class*="detail"], ' +
                        '[class*="sidebar"], [class*="drawer"], [class*="entity"], ' +
                        '[class*="result"], [class*="lead"]'
                    ) || link.parentElement;

                    const salesLink = panel?.querySelector('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
                    if (salesLink) {
                        const salesUrl = salesLink.href.split('?')[0];
                        linkedInProfileUrlCache.set(salesUrl, profileUrl);

                        // Immediately update any matching queued lead
                        const lead = selectedLeads.find(l => l.linkedinUrl === salesUrl);
                        if (lead && !lead.linkedinProfileUrl) {
                            lead.linkedinProfileUrl = profileUrl;
                            pendingProfileFetches.delete(salesUrl);
                        }
                    } else {
                        // No Sales Nav link nearby — store as most recently observed
                        lastObservedProfileUrl = profileUrl;
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// Search the current page's embedded JSON data (no network request needed)
function findPublicIdOnCurrentPage(salesNavUrl) {
    try {
        const handle = salesNavUrl.match(/\/sales\/(?:lead|people)\/([A-Za-z0-9_-]+)/)?.[1];
        if (!handle) return '';

        // Search <code> elements — LinkedIn embeds SSR data here
        for (const code of document.querySelectorAll('code')) {
            const text = code.textContent;
            if (!text || !text.includes(handle)) continue;
            const m = text.match(/"publicIdentifier"\s*:\s*"([a-zA-Z0-9_%-]+)"/);
            if (m) return 'https://www.linkedin.com/in/' + m[1];
        }

        // Search JSON script tags
        for (const script of document.querySelectorAll('script[type="application/json"]')) {
            const text = script.textContent;
            if (!text || !text.includes(handle)) continue;
            const m = text.match(/"publicIdentifier"\s*:\s*"([a-zA-Z0-9_%-]+)"/);
            if (m) return 'https://www.linkedin.com/in/' + m[1];
        }
    } catch(e) {}
    return '';
}

async function fetchLinkedInProfileUrl(salesNavUrl) {
    // Strategy 1: search current page's embedded data (instant, no fetch)
    const pageResult = findPublicIdOnCurrentPage(salesNavUrl);
    if (pageResult) return pageResult;

    // Strategy 2: fetch the Sales Navigator profile page HTML
    try {
        const resp = await fetch(salesNavUrl, {
            credentials: 'include',
            headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });
        if (resp.ok) {
            const html = await resp.text();
            const m1 = html.match(/"publicIdentifier"\s*:\s*"([a-zA-Z0-9_%-]+)"/);
            if (m1) return 'https://www.linkedin.com/in/' + m1[1];
            const m2 = html.match(/"vanityName"\s*:\s*"([a-zA-Z0-9_%-]+)"/);
            if (m2) return 'https://www.linkedin.com/in/' + m2[1];
            const m3 = html.match(/href="(https:\/\/www\.linkedin\.com\/in\/[^"?#]+)/);
            if (m3) return m3[1];
        }
    } catch(e) {}

    // Strategy 3: Sales Navigator internal API
    try {
        const handle = salesNavUrl.match(/\/sales\/(?:lead|people)\/([^,?#]+)/)?.[1];
        const csrf = (document.cookie.match(/JSESSIONID="?([^";]+)/) || [])[1] || 'ajax:0';
        if (handle) {
            const apiUrl = `https://www.linkedin.com/sales-api/salesApiProfiles?handles=${encodeURIComponent(handle)}&decorationId=com.linkedin.sales.deco.desktop.openlink.SalesProfile-7`;
            const apiResp = await fetch(apiUrl, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'X-RestLi-Protocol-Version': '2.0.0',
                    'Csrf-Token': csrf,
                }
            });
            if (apiResp.ok) {
                const text = await apiResp.text();
                const m = text.match(/"publicIdentifier"\s*:\s*"([a-zA-Z0-9_%-]+)"/);
                if (m) return 'https://www.linkedin.com/in/' + m[1];
            }
        }
    } catch(e) {}

    return '';
}

// =============================================
// EXTRACT FROM PROFILE PAGE
// =============================================
function extractFromProfile() {
    const url = window.location.href;
    let firstName = '', lastName = '', fullName = '';
    let jobTitle = '', companyName = '', linkedinUrl = url.split('?')[0];
    let country = '', city = '', companyService = '';

    if (url.includes('/sales/')) {
        fullName = getText(['[data-anonymize="person-name"]', '.profile-topcard-person-entity__name', 'h1']);

        jobTitle = getValidJobTitle([
            '[data-anonymize="job-title"]',
            '.profile-topcard__summary-position-title',
            '.artdeco-entity-lockup__subtitle',
            '.profile-topcard-person-entity__content span[data-anonymize="title"]',
            'span[data-anonymize="title"]'
        ]);

        if (!jobTitle) {
            const expSection = document.querySelector('.profile-topcard__summary-position');
            if (expSection) {
                const titleEl = expSection.querySelector('span[data-anonymize="title"], .profile-topcard__summary-position-title');
                if (titleEl) {
                    const txt = titleEl.innerText?.trim();
                    if (isActualJobTitle(txt)) jobTitle = txt;
                }
            }
        }

        if (!jobTitle) {
            jobTitle = getText(['[data-anonymize="job-title"]', '.profile-topcard__summary-position-title', '.artdeco-entity-lockup__subtitle']);
        }

        companyName = getText(['[data-anonymize="company-name"]', '.profile-topcard__summary-position a']);
        const loc = getText(['.profile-topcard__location-data', '.profile-topcard-person-entity__location', '[data-anonymize="location"]']);
        if (loc) { const p = loc.split(',').map(s => s.trim()); city = p[0] || ''; country = p.length >= 2 ? p[p.length - 1] : ''; }
        companyService = getText(['.profile-topcard__summary-industry']);
    } else {
        fullName = getText(['h1.text-heading-xlarge', 'h1']);
        jobTitle = getText(['.text-body-medium.break-words']);
        companyName = getText(['button[aria-label*="Current company"]', '.inline-show-more-text']);
        const loc = getText(['.text-body-small.inline.t-black--light.break-words']);
        if (loc) { const p = loc.split(',').map(s => s.trim()); city = p[0] || ''; country = p.length >= 2 ? p[p.length - 1] : ''; }
    }

    if (!fullName) { const t = document.title || ''; if (t.includes('|')) fullName = t.split('|')[0].split('-')[0].trim(); }
    if (fullName) { const np = fullName.trim().split(/\s+/); firstName = np[0] || ''; lastName = np.slice(1).join(' ') || ''; }

    // Try to find the regular LinkedIn /in/ profile URL on the Sales Navigator profile page
    let linkedinProfileUrl = '';
    const profileLink = document.querySelector(
        'a[href*="linkedin.com/in/"]:not([href*="/sales/"]), ' +
        'a[href*="/in/"][target="_blank"]:not([href*="/sales/"]), ' +
        '[data-control-name="view_member_profile"] a, ' +
        'a[aria-label*="LinkedIn profile"]'
    );
    if (profileLink) {
        linkedinProfileUrl = profileLink.href.split('?')[0];
        if (linkedinProfileUrl.startsWith('/')) linkedinProfileUrl = 'https://www.linkedin.com' + linkedinProfileUrl;
    }

    return { firstName, lastName, linkedinUrl, linkedinProfileUrl, companyName, jobTitle, country, city, companyService, status: 'Pending' };
}

// =============================================
// HOOK LINKEDIN'S NATIVE CHECKBOXES
// =============================================
function hookLinkedInCheckboxes(skipSelectAll = false) {
    const rows = document.querySelectorAll(
        'tr.artdeco-models-table-row, li.artdeco-list__item, ' +
        'div[data-view-name="lead-lists-lead-detail-view"], ol.artdeco-list > li, ' +
        'tbody tr, div.lists-detail__table-body-container tr, div[class*="lead-list"] tr'
    );

    rows.forEach((row) => {
        if (row.dataset.lpHooked) return;

        const nameEl = row.querySelector(
            '[data-anonymize="person-name"], a[href*="/sales/lead/"], a[href*="/sales/people/"], .artdeco-entity-lockup__title a, td:first-child a'
        );
        if (!nameEl) return;

        const linkedinCheckbox = row.querySelector('input[type="checkbox"]');
        if (!linkedinCheckbox) return;

        row.dataset.lpHooked = 'true';

        linkedinCheckbox.addEventListener('click', function(e) {
            // Let-through flag for Sales Nav mode or programmatic clicks
            if (row.dataset.lpLetThrough === 'true') {
                delete row.dataset.lpLetThrough;
                return;
            }

            // ---- SALES NAV MODE: let everything through natively ----
            if (lpMode === 'salesnav') {
                return; // don't intercept
            }

            // ---- LEADPILOT MODE ----
            e.preventDefault();
            e.stopImmediatePropagation();

            if (row.classList.contains('lp-row-selected')) {
                // Deselect from LeadPilot
                const data = extractFromRow(row);
                const idx = selectedLeads.findIndex(l => l.linkedinUrl === data.linkedinUrl);
                if (idx >= 0) removeFromQueue(idx);
                row.classList.remove('lp-row-selected');
                removeCheckboxGlow(row);
                linkedinCheckbox.checked = false; // uncheck the tick
            } else {
                // Select for LeadPilot
                const data = extractFromRow(row);
                addToQueue(data);
                row.classList.add('lp-row-selected');
                linkedinCheckbox.checked = true; // show the tick
                applyCheckboxGlow(row, 'leadpilot');

                if (!data.linkedinProfileUrl && data.linkedinUrl) {
                    fetchLinkedInProfileUrl(data.linkedinUrl).then(profileUrl => {
                        if (profileUrl) {
                            const lead = selectedLeads.find(l => l.linkedinUrl === data.linkedinUrl);
                            if (lead) lead.linkedinProfileUrl = profileUrl;
                        }
                    });
                }
            }
            updateModeBarUI();
            updateSelectAllState();
        }, true);
    });

    // Inject mode toggle and Select All
    injectModeToggle();
    if (!skipSelectAll) {
        injectSelectAll();
    }
    updateSelectAllState();
}

// =============================================
// VISUAL INDICATORS — CHECKBOX GLOW + BADGE
// =============================================
function applyCheckboxGlow(row, mode) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb) return;
    // Find or create glow wrapper
    const parent = cb.closest('label, td, div') || cb.parentElement;
    if (!parent) return;
    parent.classList.add('lp-glow-parent');

    // Remove existing badge
    const oldBadge = parent.querySelector('.lp-micro-badge');
    if (oldBadge) oldBadge.remove();

    if (mode === 'leadpilot') {
        parent.classList.add('lp-glow-purple');
        parent.classList.remove('lp-glow-blue');
        // Add LP micro-badge
        const badge = document.createElement('span');
        badge.className = 'lp-micro-badge lp-badge-purple';
        badge.textContent = 'LP';
        parent.appendChild(badge);
    }
}

function removeCheckboxGlow(row) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb) return;
    const parent = cb.closest('.lp-glow-parent') || cb.parentElement;
    if (!parent) return;
    parent.classList.remove('lp-glow-parent', 'lp-glow-purple', 'lp-glow-blue');
    const badge = parent.querySelector('.lp-micro-badge');
    if (badge) badge.remove();
}

// =============================================
// DRAGGABLE PANEL LOGIC
// =============================================
function makeDraggable(panel) {
    const header = panel.querySelector('.lp-panel-header');
    let isDragging = false;
    let startX, startY, startRight, startBottom;

    header.style.cursor = 'grab';

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.lp-toggle-btn')) return; // Don't drag when clicking toggle
        isDragging = true;
        header.style.cursor = 'grabbing';

        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startRight = window.innerWidth - rect.right;
        startBottom = window.innerHeight - rect.bottom;

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newRight = startRight - dx;
        let newBottom = startBottom - dy;

        // Constrain to viewport
        const panelW = panel.offsetWidth;
        const panelH = panel.offsetHeight;
        newRight = Math.max(0, Math.min(window.innerWidth - panelW, newRight));
        newBottom = Math.max(0, Math.min(window.innerHeight - panelH, newBottom));

        panel.style.right = newRight + 'px';
        panel.style.bottom = newBottom + 'px';
        panel.style.top = 'auto'; // override default top
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = 'grab';
        }
    });
}

// =============================================
// FLOATING SIDE PANEL (LIST PAGE)
// =============================================
function injectPanel() {
    if (document.getElementById('lp-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'lp-panel';
    panel.innerHTML = `
    <div id="lp-panel-pill">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
      <span id="lp-pill-text">LeadPilot</span>
      <span id="lp-pill-count"></span>
    </div>

    <div class="lp-panel-header">
      <div class="lp-panel-logo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        <span>LeadPilot</span>
      </div>
      <button id="lp-panel-toggle" class="lp-toggle-btn" title="Minimize">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>

    <div id="lp-panel-body" class="lp-collapsed">
      <div class="lp-section">
        <div class="lp-section-label">
          <span>Selected</span>
          <span id="lp-count" class="lp-badge">0</span>
          <span id="lp-total-count" class="lp-total-count"></span>
        </div>
        <div id="lp-cards-container" class="lp-cards-container">
          <div class="lp-empty-state">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
            <p>Select leads using checkboxes</p>
          </div>
        </div>
      </div>

      ${getTabSelectorHTML()}

      <div class="lp-actions">
        <button id="lp-save-all" class="lp-btn-save" disabled>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          <span class="lp-save-label">Save All to Sheet</span>
        </button>
        <span class="lp-shortcut-hint">Ctrl+L</span>
        <button id="lp-clear" class="lp-btn-clear">Clear</button>
      </div>

      <div id="lp-status-bar" class="lp-status-bar"></div>
      <div id="lp-undo-bar" class="lp-undo-bar" style="display:none;"></div>
    </div>
  `;
    document.body.appendChild(panel);

    // Toggle minimize
    document.getElementById('lp-panel-toggle').addEventListener('click', () => {
        document.getElementById('lp-panel-body').classList.toggle('lp-collapsed');
        document.getElementById('lp-panel').classList.toggle('lp-minimized');
    });

    // Pill click — expand
    document.getElementById('lp-panel-pill').addEventListener('click', () => {
        document.getElementById('lp-panel-body').classList.remove('lp-collapsed');
        document.getElementById('lp-panel').classList.remove('lp-minimized');
    });

    // Start minimized
    document.getElementById('lp-panel').classList.add('lp-minimized');

    document.getElementById('lp-save-all').addEventListener('click', saveAllLeads);
    document.getElementById('lp-clear').addEventListener('click', clearQueue);

    // Make panel draggable
    makeDraggable(panel);

    // Initialize tab selector (with storage change listener)
    initTabSelector();

    // Initialize keyboard shortcuts
    initKeyboardShortcuts();
}

// =============================================
// RENDER PANEL
// =============================================
function renderPanel() {
    const container = document.getElementById('lp-cards-container');
    const countEl = document.getElementById('lp-count');
    const totalCountEl = document.getElementById('lp-total-count');
    const saveBtn = document.getElementById('lp-save-all');
    if (!container) return;

    countEl.textContent = selectedLeads.length;
    saveBtn.disabled = selectedLeads.length === 0;

    // Sync pill count
    const pillCount = document.getElementById('lp-pill-count');
    if (pillCount) pillCount.textContent = selectedLeads.length > 0 ? selectedLeads.length : '';

    // Update save button label with count
    const saveLabel = saveBtn.querySelector('.lp-save-label');
    if (saveLabel) {
        saveLabel.textContent = selectedLeads.length > 0
            ? `Save ${selectedLeads.length} Lead${selectedLeads.length !== 1 ? 's' : ''}`
            : 'Save All to Sheet';
    }

    // Update lead count: X / Y on page
    const totalOnPage = document.querySelectorAll('.lp-row-checkbox:not(#lp-select-all-cb)').length;
    if (totalCountEl) {
        totalCountEl.textContent = totalOnPage > 0 ? `/ ${totalOnPage} on page` : '';
    }

    if (selectedLeads.length === 0) {
        container.innerHTML = `
      <div class="lp-empty-state">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
        <p>Select leads using checkboxes</p>
      </div>`;
        return;
    }

    container.innerHTML = selectedLeads.map((lead, i) => `
    <div class="lp-card">
      <div class="lp-card-avatar">${(lead.firstName?.[0] || '?').toUpperCase()}</div>
      <div class="lp-card-info">
        <div class="lp-card-name">${lead.firstName} ${lead.lastName}</div>
        <div class="lp-card-detail">${lead.jobTitle || '—'}</div>
        <div class="lp-card-detail">${lead.companyName || '—'} · ${lead.city || ''}${lead.country ? ', ' + lead.country : ''}</div>
      </div>
      <button class="lp-card-remove" data-index="${i}" title="Remove" aria-label="Remove lead">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

    container.querySelectorAll('.lp-card-remove').forEach(btn => {
        btn.addEventListener('click', () => removeFromQueue(parseInt(btn.dataset.index)));
    });
}

// =============================================
// SAVE ALL LEADS
// =============================================
async function saveAllLeads() {
    if (selectedLeads.length === 0) return;

    // Wait for any in-flight profile URL fetches before opening the modal
    if (pendingProfileFetches.size > 0) {
        const saveBtn = document.getElementById('lp-save-all');
        const saveLabel = saveBtn?.querySelector('.lp-save-label');
        const origText = saveLabel?.textContent;
        if (saveLabel) saveLabel.textContent = 'Fetching URLs…';
        await Promise.allSettled(pendingProfileFetches.values());
        if (saveLabel && origText) saveLabel.textContent = origText;
    }

    const tabs = getSelectedTabs();
    showReviewModal([...selectedLeads], tabs, false);
}

// =============================================
// DUPLICATE CHECK
// =============================================
async function checkDuplicates(leads) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['savedLeadUrls'], (result) => {
            const savedUrls = result.savedLeadUrls || [];
            const checked = leads.map(lead => ({
                ...lead,
                isDuplicate: savedUrls.includes(lead.linkedinUrl)
            }));
            resolve(checked);
        });
    });
}

function saveDuplicateUrls(leads) {
    chrome.storage.local.get(['savedLeadUrls'], (result) => {
        const savedUrls = result.savedLeadUrls || [];
        const newUrls = leads.map(l => l.linkedinUrl).filter(u => u && !savedUrls.includes(u));
        chrome.storage.local.set({ savedLeadUrls: [...savedUrls, ...newUrls] });
    });
}

// =============================================
// REVIEW MODAL
// =============================================
async function showReviewModal(leads, tabs, isProfile = false) {
    // Check for duplicates
    const checkedLeads = await checkDuplicates(leads);

    // Remove any existing modal
    closeReviewModal();

    const overlay = document.createElement('div');
    overlay.id = 'lp-review-overlay';
    const isBulk = checkedLeads.length > 1;
    const bulkApplyHTML = isBulk ? `
        <div class="lp-bulk-apply-bar">
            <div class="lp-bulk-apply-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                <span>Bulk Apply to All</span>
            </div>
            <div class="lp-bulk-apply-fields">
                <div class="lp-review-field lp-field-industry">
                    <label>Industry</label>
                    <select id="lp-bulk-industry">
                        <option value="">— Keep Individual —</option>
                        ${INDUSTRY_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                </div>
                <div class="lp-review-field lp-field-status">
                    <label>Status</label>
                    <select id="lp-bulk-status">
                        <option value="">— Keep Individual —</option>
                        ${STATUS_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                </div>
                <button id="lp-bulk-apply-btn" class="lp-bulk-apply-btn">Apply to All</button>
            </div>
        </div>
    ` : '';

    overlay.innerHTML = `
    <div class="lp-review-modal">
        <div class="lp-review-header">
            <div class="lp-review-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
                    <line x1="12" y1="22" x2="12" y2="15.5"/>
                    <polyline points="22 8.5 12 15.5 2 8.5"/>
                    <polyline points="2 15.5 12 8.5 22 15.5"/>
                    <line x1="12" y1="2" x2="12" y2="8.5"/>
                </svg>
                <span>Review Before Saving</span>
                <span class="lp-review-count">${checkedLeads.length} lead${checkedLeads.length > 1 ? 's' : ''}</span>
            </div>
            <button id="lp-review-close" class="lp-review-close-btn" title="Cancel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <div class="lp-review-tabs-info">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            <span>Saving to: ${tabs.length > 0 ? tabs.join(', ') : 'Default sheet'}</span>
        </div>
        ${bulkApplyHTML}
        <div class="lp-review-body" id="lp-review-body">
            ${checkedLeads.map((lead, i) => renderReviewCard(lead, i)).join('')}
        </div>
        <div class="lp-review-footer">
            <button id="lp-review-cancel" class="lp-review-btn lp-review-btn-cancel">Cancel</button>
            <button id="lp-review-save" class="lp-review-btn lp-review-btn-save">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Confirm & Save
            </button>
        </div>
    </div>`;

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('lp-review-visible'));

    // Close handlers - stopPropagation to prevent bubbling issues
    document.getElementById('lp-review-close').addEventListener('click', (e) => { e.stopPropagation(); closeReviewModal(); });
    document.getElementById('lp-review-cancel').addEventListener('click', (e) => { e.stopPropagation(); closeReviewModal(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeReviewModal(); });

    // Collapse/expand cards
    overlay.querySelectorAll('.lp-review-card-header').forEach(header => {
        header.addEventListener('click', () => {
            const card = header.closest('.lp-review-card');
            card.classList.toggle('lp-review-card-collapsed');
        });
    });

    // Remove lead from review
    overlay.querySelectorAll('.lp-review-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = btn.closest('.lp-review-card');
            card.style.transform = 'translateX(100%)';
            card.style.opacity = '0';
            setTimeout(() => {
                card.remove();
                const remaining = overlay.querySelectorAll('.lp-review-card');
                overlay.querySelector('.lp-review-count').textContent = `${remaining.length} lead${remaining.length > 1 ? 's' : ''}`;
                if (remaining.length === 0) closeReviewModal();
            }, 250);
        });
    });

    // Bulk apply button handler
    const bulkApplyBtn = document.getElementById('lp-bulk-apply-btn');
    if (bulkApplyBtn) {
        bulkApplyBtn.addEventListener('click', () => {
            const bulkIndustry = document.getElementById('lp-bulk-industry').value;
            const bulkStatus = document.getElementById('lp-bulk-status').value;
            if (bulkIndustry) {
                overlay.querySelectorAll('[data-field="companyService"]').forEach(sel => { sel.value = bulkIndustry; });
            }
            if (bulkStatus) {
                overlay.querySelectorAll('[data-field="status"]').forEach(sel => {
                    sel.value = bulkStatus;
                    const dot = sel.closest('.lp-status-select-wrap')?.querySelector('.lp-status-dot');
                    if (dot) dot.style.background = getStatusColor(bulkStatus);
                });
            }
            if (bulkIndustry || bulkStatus) {
                bulkApplyBtn.textContent = '✓ Applied!';
                bulkApplyBtn.style.background = 'rgba(34, 197, 94, 0.2)';
                bulkApplyBtn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                bulkApplyBtn.style.color = '#22c55e';
                setTimeout(() => {
                    bulkApplyBtn.textContent = 'Apply to All';
                    bulkApplyBtn.style.background = '';
                    bulkApplyBtn.style.borderColor = '';
                    bulkApplyBtn.style.color = '';
                }, 1500);
            }
        });
    }

    // Status color dot + status pill — update on change
    overlay.querySelectorAll('.lp-status-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const color = getStatusColor(sel.value);
            const dot = sel.closest('.lp-status-select-wrap')?.querySelector('.lp-status-dot');
            if (dot) dot.style.background = color;
            const pill = sel.closest('.lp-review-card')?.querySelector('.lp-review-status-pill');
            if (pill) {
                pill.textContent = sel.value;
                pill.style.cssText = `background:${color}20;color:${color};border:1px solid ${color}40;`;
            }
        });
    });

    // LinkedIn URL edit toggle
    overlay.querySelectorAll('[data-url-edit]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = btn.previousElementSibling;
            if (input && input.hasAttribute('readonly')) {
                input.removeAttribute('readonly');
                input.focus();
                btn.textContent = 'Lock';
            } else if (input) {
                input.setAttribute('readonly', '');
                btn.textContent = 'Edit';
            }
        });
    });

    // Save handler
    document.getElementById('lp-review-save').addEventListener('click', async () => {
        const cards = overlay.querySelectorAll('.lp-review-card');
        const editedLeads = [];
        cards.forEach(card => {
            editedLeads.push({
                firstName: card.querySelector('[data-field="firstName"]').value,
                lastName: card.querySelector('[data-field="lastName"]').value,
                linkedinUrl: card.querySelector('[data-field="linkedinUrl"]').value,
                linkedinProfileUrl: card.querySelector('[data-field="linkedinProfileUrl"]')?.value || '',
                companyName: card.querySelector('[data-field="companyName"]').value,
                jobTitle: card.querySelector('[data-field="jobTitle"]').value,
                country: card.querySelector('[data-field="country"]').value,
                city: card.querySelector('[data-field="city"]').value,
                companyService: card.querySelector('[data-field="companyService"]').value,
                status: card.querySelector('[data-field="status"]').value,
                notes: card.querySelector('[data-field="notes"]')?.value || ''
            });
        });
        await saveFinalLeads(editedLeads, tabs, isProfile);
    });
}

function getStatusColor(status) {
    return STATUS_COLORS[status] || '#94a3b8';
}

function renderReviewCard(lead, index) {
    const industryOptions = INDUSTRY_OPTIONS.map(opt => {
        const selected = (lead.companyService && lead.companyService.toLowerCase().includes(opt.toLowerCase())) ? 'selected' : '';
        return `<option value="${opt}" ${selected}>${opt}</option>`;
    }).join('');
    const hasMatch = INDUSTRY_OPTIONS.some(opt => lead.companyService && lead.companyService.toLowerCase().includes(opt.toLowerCase()));

    const statusOptions = STATUS_OPTIONS.map(opt => {
        const selected = (lead.status === opt) ? 'selected' : '';
        const color = getStatusColor(opt);
        return `<option value="${opt}" ${selected} style="color:${color};font-weight:600;">${opt}</option>`;
    }).join('');

    const dupBadge = lead.isDuplicate ? `<span class="lp-dup-badge">⚠ Duplicate</span>` : '';
    const statusColor = getStatusColor(lead.status || 'Pending');

    return `
    <div class="lp-review-card ${lead.isDuplicate ? 'lp-review-card-dup' : ''}" data-index="${index}">
        <div class="lp-review-card-header">
            <div class="lp-review-card-avatar">${(lead.firstName?.[0] || '?').toUpperCase()}</div>
            <div class="lp-review-card-title">
                <span class="lp-review-card-name">${lead.firstName} ${lead.lastName}</span>
                <span class="lp-review-card-sub">${lead.jobTitle || 'No title'} · ${lead.companyName || 'No company'}</span>
            </div>
            <span class="lp-review-status-pill" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;">${lead.status || 'Pending'}</span>
            ${dupBadge}
            <button class="lp-review-remove" title="Remove" aria-label="Remove lead">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <svg class="lp-review-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="lp-review-card-body">
            <div class="lp-review-row">
                <div class="lp-review-field">
                    <label>First Name</label>
                    <input type="text" data-field="firstName" value="${escapeAttr(lead.firstName)}" placeholder="Enter first name" />
                </div>
                <div class="lp-review-field">
                    <label>Last Name</label>
                    <input type="text" data-field="lastName" value="${escapeAttr(lead.lastName)}" placeholder="Enter last name" />
                </div>
            </div>
            <div class="lp-review-field lp-field-url">
                <label>Sales Navigator URL</label>
                <input type="text" data-field="linkedinUrl" value="${escapeAttr(lead.linkedinUrl)}" placeholder="Sales Navigator URL" readonly />
                <button class="lp-url-edit-link" data-url-edit>Edit</button>
            </div>
            <div class="lp-review-field lp-field-url">
                <label>LinkedIn Profile URL</label>
                <input type="text" data-field="linkedinProfileUrl" value="${escapeAttr(lead.linkedinProfileUrl || '')}" placeholder="Not detected on this page" readonly />
                <button class="lp-url-edit-link" data-url-edit>Edit</button>
            </div>
            <div class="lp-review-row">
                <div class="lp-review-field">
                    <label>Company</label>
                    <input type="text" data-field="companyName" value="${escapeAttr(lead.companyName)}" placeholder="Company name" />
                </div>
                <div class="lp-review-field">
                    <label>Job Title</label>
                    <input type="text" data-field="jobTitle" value="${escapeAttr(lead.jobTitle)}" placeholder="Job title" />
                </div>
            </div>
            <div class="lp-review-row">
                <div class="lp-review-field">
                    <label>Country</label>
                    <input type="text" data-field="country" value="${escapeAttr(lead.country)}" placeholder="Country" />
                </div>
                <div class="lp-review-field">
                    <label>City</label>
                    <input type="text" data-field="city" value="${escapeAttr(lead.city)}" placeholder="City" />
                </div>
            </div>
            <div class="lp-review-row">
                <div class="lp-review-field lp-field-industry">
                    <label>Industry</label>
                    <select data-field="companyService">
                        <option value="">— Select Industry —</option>
                        ${industryOptions}
                        ${!hasMatch && lead.companyService ? `<option value="${escapeAttr(lead.companyService)}" selected>${escapeAttr(lead.companyService)}</option>` : ''}
                    </select>
                </div>
                <div class="lp-review-field lp-field-status">
                    <label>Status</label>
                    <div class="lp-status-select-wrap">
                        <span class="lp-status-dot" style="background:${statusColor}"></span>
                        <select data-field="status" class="lp-status-select">
                            ${statusOptions}
                        </select>
                    </div>
                </div>
            </div>
            <div class="lp-review-field lp-field-notes">
                <label>Notes</label>
                <textarea data-field="notes" class="lp-notes-textarea" rows="2" placeholder="Add personal notes about this lead..."></textarea>
            </div>
        </div>
    </div>`;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeReviewModal() {
    const overlay = document.getElementById('lp-review-overlay');
    if (!overlay) return;
    overlay.classList.remove('lp-review-visible');
    setTimeout(() => overlay.remove(), 250);
}

async function saveFinalLeads(leads, tabs, isProfile) {
    const saveBtn = document.getElementById('lp-review-save');
    const total = leads.length;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="lp-spinner"></span> Saving 0/${total}...`;

    let saved = 0, failed = 0;

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        try {
            await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'saveLead',
                    data: lead,
                    selectedTabs: tabs
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError.message);
                        return;
                    }
                    if (response && response.success) resolve();
                    else reject(response?.error || 'Unknown error');
                });
            });
            saved++;
        } catch (err) {
            failed++;
            console.error('[LeadPilot] Failed:', lead.firstName, err);
        }
        saveBtn.innerHTML = `<span class="lp-spinner"></span> Saving ${saved + failed}/${total}...`;
    }

    if (failed === 0) {
        // Store URLs for duplicate checking
        saveDuplicateUrls(leads);
        saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All Saved!`;
        updateStatus(`✓ ${saved} lead${saved > 1 ? 's' : ''} saved!`, '#34d399');

        // Store for undo
        lastSavedLeads = { leads: [...leads], tabs: [...tabs], isProfile };

        setTimeout(() => {
            closeReviewModal();
            if (!isProfile) clearQueue();
            showUndoToast(leads.length);
        }, 1000);
    } else {
        saveBtn.innerHTML = `${saved} saved, ${failed} failed — Close & Retry`;
        saveBtn.disabled = false;
        updateStatus(`${saved} saved, ${failed} failed`, '#f87171');
    }
}

// =============================================
// UNDO SAVE (5-second toast)
// =============================================
function showUndoToast(count) {
    // Clear previous undo timer
    if (undoTimeout) clearTimeout(undoTimeout);

    const undoBar = document.getElementById('lp-undo-bar');
    if (!undoBar) return;

    let secondsLeft = 5;
    undoBar.style.display = 'flex';
    undoBar.innerHTML = `
        <span class="lp-undo-text">✓ ${count} lead${count > 1 ? 's' : ''} saved</span>
        <button id="lp-undo-btn" class="lp-undo-btn">Undo (${secondsLeft}s)</button>
    `;

    const undoBtn = document.getElementById('lp-undo-btn');
    const countdown = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
            clearInterval(countdown);
            undoBar.style.display = 'none';
            lastSavedLeads = null;
            return;
        }
        if (undoBtn) undoBtn.textContent = `Undo (${secondsLeft}s)`;
    }, 1000);

    undoTimeout = setTimeout(() => {
        clearInterval(countdown);
        undoBar.style.display = 'none';
        lastSavedLeads = null;
    }, 5000);

    undoBtn.addEventListener('click', () => {
        clearTimeout(undoTimeout);
        clearInterval(countdown);

        if (lastSavedLeads) {
            undoBtn.textContent = 'Undoing...';
            undoBtn.disabled = true;

            // Remove URLs from local duplicate list
            chrome.storage.local.get(['savedLeadUrls'], (result) => {
                const savedUrls = result.savedLeadUrls || [];
                const toRemove = lastSavedLeads.leads.map(l => l.linkedinUrl);
                const filtered = savedUrls.filter(u => !toRemove.includes(u));
                chrome.storage.local.set({ savedLeadUrls: filtered });
            });

            // Delete from Google Sheet
            chrome.runtime.sendMessage({
                action: 'deleteLead',
                linkedinUrls: lastSavedLeads.leads.map(l => l.linkedinUrl),
                selectedTabs: lastSavedLeads.tabs
            }, (response) => {
                undoBar.style.display = 'none';
                if (response && response.success) {
                    updateStatus('\u21a9 Undo successful \u2014 leads removed from sheet', '#34d399');
                } else {
                    updateStatus('\u21a9 Undo: removed locally, sheet delete may have failed', '#fbbf24');
                }
                lastSavedLeads = null;
            });
        } else {
            undoBar.style.display = 'none';
        }
    });
}

// =============================================
// PROFILE PAGE PANEL
// =============================================
function injectProfilePanel() {
    if (document.getElementById('lp-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'lp-panel';
    panel.innerHTML = `
    <div id="lp-panel-pill">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
      <span id="lp-pill-text">LeadPilot</span>
      <span id="lp-pill-count"></span>
    </div>

    <div class="lp-panel-header">
      <div class="lp-panel-logo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        <span>LeadPilot</span>
      </div>
      <button id="lp-panel-toggle" class="lp-toggle-btn">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
    <div id="lp-panel-body">
      <div id="lp-profile-preview" class="lp-section"></div>

      ${getTabSelectorHTML()}

      <div class="lp-actions">
        <button id="lp-save-profile" class="lp-btn-save">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save Lead
        </button>
        <button id="lp-connect-profile" class="lp-btn-action">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          Connect Template
        </button>
        <button id="lp-message-profile" class="lp-btn-action">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Message Template
        </button>
      </div>
      <div id="lp-status-bar" class="lp-status-bar"></div>
    </div>
  `;
    document.body.appendChild(panel);

    // Toggle
    document.getElementById('lp-panel-toggle').addEventListener('click', () => {
        document.getElementById('lp-panel-body').classList.toggle('lp-collapsed');
        document.getElementById('lp-panel').classList.toggle('lp-minimized');
    });

    // Pill click — expand
    document.getElementById('lp-panel-pill').addEventListener('click', () => {
        document.getElementById('lp-panel-body').classList.remove('lp-collapsed');
        document.getElementById('lp-panel').classList.remove('lp-minimized');
    });

    // Save profile — open review modal
    document.getElementById('lp-save-profile').addEventListener('click', () => {
        const data = extractFromProfile();
        const tabs = getSelectedTabs();
        showReviewModal([data], tabs, true);
    });

    // Copy templates
    document.getElementById('lp-connect-profile').addEventListener('click', () => {
        chrome.storage.sync.get(['connectTemplate'], r => {
            const t = (r.connectTemplate || "Hi [Name], I'd like to connect.").replace(/\[Name\]/g, extractFromProfile().firstName);
            navigator.clipboard.writeText(t).then(() => updateStatus('Template copied!', '#34d399'));
        });
    });

    document.getElementById('lp-message-profile').addEventListener('click', () => {
        chrome.storage.sync.get(['messageTemplate'], r => {
            const t = (r.messageTemplate || "Hi [Name], ...").replace(/\[Name\]/g, extractFromProfile().firstName);
            navigator.clipboard.writeText(t).then(() => updateStatus('Template copied!', '#34d399'));
        });
    });

    // Make draggable
    makeDraggable(panel);

    // Init tab selector
    initTabSelector();

    // Auto preview
    setTimeout(() => {
        const data = extractFromProfile();
        const preview = document.getElementById('lp-profile-preview');
        if (preview && data.firstName) {
            preview.innerHTML = `
        <div class="lp-card" style="border:none;padding:0;background:none;">
          <div class="lp-card-avatar">${(data.firstName[0] || '?').toUpperCase()}</div>
          <div class="lp-card-info">
            <div class="lp-card-name">${data.firstName} ${data.lastName}</div>
            <div class="lp-card-detail">${data.jobTitle || '—'}</div>
            <div class="lp-card-detail">${data.companyName || '—'} · ${data.city || ''}${data.country ? ', ' + data.country : ''}</div>
          </div>
        </div>`;
        }
    }, 2000);
}

// =============================================
// STATUS BAR
// =============================================
function updateStatus(msg, color = '#94a3b8') {
    const bar = document.getElementById('lp-status-bar');
    if (!bar) return;
    bar.style.color = color;
    bar.textContent = msg;
    setTimeout(() => { bar.textContent = ''; }, 5000);
}

// =============================================
// MAIN LOOP
// =============================================
let lastUrl = '';
function main() {
    const currentUrl = window.location.href;
    const pageType = getPageType();

    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        const oldPanel = document.getElementById('lp-panel');
        if (oldPanel) oldPanel.remove();
        const oldSelectAll = document.getElementById('lp-select-all-bar');
        if (oldSelectAll) oldSelectAll.remove();
        const oldModeBar = document.getElementById('lp-mode-bar');
        if (oldModeBar) oldModeBar.remove();
        // Clean up hook markers and visual indicators
        document.querySelectorAll('[data-lp-hooked]').forEach(el => {
            removeCheckboxGlow(el);
            delete el.dataset.lpHooked;
        });
        document.querySelectorAll('.lp-row-selected').forEach(el => el.classList.remove('lp-row-selected'));
        selectedLeads = [];
    }

    try {
        if (pageType === 'list') {
            hookLinkedInCheckboxes();
            injectPanel();
        } else if (pageType === 'profile' || pageType === 'linkedin-profile') {
            injectProfilePanel();
        }
    } catch (err) {
        console.error('[LeadPilot] Main loop error:', err);
    }
}

// Start the profile URL observer once on page load
initProfileUrlObserver();

setInterval(main, 1500);
