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

    // Deselect the corresponding checkbox on the page
    if (removed && removed.linkedinUrl) {
        document.querySelectorAll('.lp-row-checkbox').forEach(cb => {
            const row = cb.closest('tr, li, div[data-view-name]');
            if (!row) return;
            const linkEl = row.querySelector('a[href*="/sales/lead/"], a[href*="/sales/people/"], .artdeco-entity-lockup__title a');
            if (linkEl) {
                const rowUrl = linkEl.href.split('?')[0];
                if (rowUrl === removed.linkedinUrl) {
                    cb.checked = false;
                    row.classList.remove('lp-row-selected');
                }
            }
        });
    }

    renderPanel();
    updateSelectAllState();
}

function clearQueue() {
    selectedLeads = [];
    document.querySelectorAll('.lp-row-checkbox:checked').forEach(cb => cb.checked = false);
    document.querySelectorAll('.lp-row-selected').forEach(el => el.classList.remove('lp-row-selected'));
    renderPanel();
    updateSelectAllState();
}

// =============================================
// SELECT ALL CHECKBOX
// =============================================
function injectSelectAll() {
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
                <span class="lp-select-all-text">Select All on Page</span>
                <span id="lp-page-count" class="lp-page-count"></span>
            </label>
        `;
        container.parentElement.insertBefore(bar, container);

        document.getElementById('lp-select-all-cb').addEventListener('change', async (e) => {
            const checked = e.target.checked;
            const textEl = bar.querySelector('.lp-select-all-text');

            if (checked) {
                // Scroll through the page to force LinkedIn to render all lazy-loaded rows
                textEl.textContent = 'Loading all leads...';
                await scrollToLoadAllRows();
                // Inject checkboxes on any new rows that appeared
                injectListCheckboxes_noSelectAll();
            }

            // Now select/deselect all checkboxes
            document.querySelectorAll('.lp-row-checkbox:not(#lp-select-all-cb)').forEach(cb => {
                if (cb.checked !== checked) {
                    cb.checked = checked;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            textEl.textContent = 'Select All on Page';
            updateSelectAllState();
        });
    } catch (err) {
        console.warn('[LeadPilot] Select All injection skipped:', err.message);
    }
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
function injectListCheckboxes_noSelectAll() {
    const rows = document.querySelectorAll(
        'tr.artdeco-models-table-row, li.artdeco-list__item, ' +
        'div[data-view-name="lead-lists-lead-detail-view"], ol.artdeco-list > li, ' +
        'tbody tr, div.lists-detail__table-body-container tr, div[class*="lead-list"] tr'
    );
    rows.forEach((row) => {
        if (row.querySelector('.lp-row-checkbox')) return;
        const nameEl = row.querySelector(
            '[data-anonymize="person-name"], a[href*="/sales/lead/"], a[href*="/sales/people/"], .artdeco-entity-lockup__title a, td:first-child a'
        );
        if (!nameEl) return;

        const wrapper = document.createElement('label');
        wrapper.className = 'lp-checkbox-wrap';
        wrapper.innerHTML = `<input type="checkbox" class="lp-row-checkbox"><span class="lp-checkmark"></span>`;
        wrapper.title = 'Select for LeadPilot';
        wrapper.addEventListener('click', (e) => e.stopPropagation());

        const checkbox = wrapper.querySelector('.lp-row-checkbox');
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
                const data = extractFromRow(row);
                addToQueue(data);
                row.classList.add('lp-row-selected');
            } else {
                const data = extractFromRow(row);
                const idx = selectedLeads.findIndex(l => l.linkedinUrl === data.linkedinUrl);
                if (idx >= 0) removeFromQueue(idx);
                row.classList.remove('lp-row-selected');
            }
        });

        const isTableRow = row.tagName === 'TR';
        if (isTableRow) {
            const td = document.createElement('td');
            td.className = 'lp-checkbox-cell';
            td.style.cssText = 'width:32px;min-width:32px;padding:0 2px;text-align:center;vertical-align:middle;';
            td.appendChild(wrapper);
            row.insertBefore(td, row.firstChild);
        } else {
            row.style.position = 'relative';
            wrapper.classList.add('lp-checkbox-absolute');
            row.insertBefore(wrapper, row.firstChild);
        }
    });
}

function updateSelectAllState() {
    const selectAllCb = document.getElementById('lp-select-all-cb');
    if (!selectAllCb) return;
    const allCbs = document.querySelectorAll('.lp-row-checkbox:not(#lp-select-all-cb)');
    const checkedCbs = document.querySelectorAll('.lp-row-checkbox:not(#lp-select-all-cb):checked');
    selectAllCb.checked = allCbs.length > 0 && checkedCbs.length === allCbs.length;
    selectAllCb.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;

    // Update page count
    const pageCount = document.getElementById('lp-page-count');
    if (pageCount) {
        pageCount.textContent = `(${checkedCbs.length}/${allCbs.length})`;
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
    <div class="lp-section lp-tab-section">
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
        <div id="lp-tab-checkboxes" class="lp-tab-checks">
            <span class="lp-tab-hint">Loading tabs...</span>
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

    // Refresh button
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
    }, 100);
}

function loadAndRenderTabs() {
    chrome.storage.sync.get(['sheetTabs', 'selectedTabs'], (result) => {
        const tabs = result.sheetTabs || [];
        const selected = result.selectedTabs || [];
        console.log('[LeadPilot] Loaded tabs:', tabs, 'Selected:', selected);
        renderTabCheckboxes(tabs, selected);
    });
}

function renderTabCheckboxes(tabs, selected) {
    const container = document.getElementById('lp-tab-checkboxes');
    if (!container) return;

    if (tabs.length === 0) {
        container.innerHTML = `<span class="lp-tab-hint">Open LeadPilot popup → add your sheet tab names</span>`;
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
            console.log('[LeadPilot] Tabs selected:', selectedTabs);
        });
    });
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

    return { firstName, lastName, linkedinUrl, companyName, jobTitle, country, city, companyService: '', status: 'Pending' };
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

    return { firstName, lastName, linkedinUrl, companyName, jobTitle, country, city, companyService, status: 'Pending' };
}

// =============================================
// INJECT CHECKBOXES ON LIST ROWS
// =============================================
function injectListCheckboxes() {
    const rows = document.querySelectorAll(
        'tr.artdeco-models-table-row, li.artdeco-list__item, ' +
        'div[data-view-name="lead-lists-lead-detail-view"], ol.artdeco-list > li, ' +
        'tbody tr, div.lists-detail__table-body-container tr, div[class*="lead-list"] tr'
    );

    rows.forEach((row) => {
        if (row.querySelector('.lp-row-checkbox')) return;
        const nameEl = row.querySelector(
            '[data-anonymize="person-name"], a[href*="/sales/lead/"], a[href*="/sales/people/"], .artdeco-entity-lockup__title a, td:first-child a'
        );
        if (!nameEl) return;

        const wrapper = document.createElement('label');
        wrapper.className = 'lp-checkbox-wrap';
        wrapper.innerHTML = `<input type="checkbox" class="lp-row-checkbox"><span class="lp-checkmark"></span>`;
        wrapper.title = 'Select for LeadPilot';

        // Prevent click from propagating to the row
        wrapper.addEventListener('click', (e) => e.stopPropagation());

        const checkbox = wrapper.querySelector('.lp-row-checkbox');
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
                const data = extractFromRow(row);
                addToQueue(data);
                row.classList.add('lp-row-selected');
            } else {
                const data = extractFromRow(row);
                const idx = selectedLeads.findIndex(l => l.linkedinUrl === data.linkedinUrl);
                if (idx >= 0) removeFromQueue(idx);
                row.classList.remove('lp-row-selected');
            }
        });

        // Dynamic positioning based on row type
        const isTableRow = row.tagName === 'TR';
        if (isTableRow) {
            // For table rows: create a proper td cell
            const td = document.createElement('td');
            td.className = 'lp-checkbox-cell';
            td.style.cssText = 'width:32px;min-width:32px;padding:0 2px;text-align:center;vertical-align:middle;';
            td.appendChild(wrapper);
            row.insertBefore(td, row.firstChild);
        } else {
            // For list/div rows: absolute position on the left
            row.style.position = 'relative';
            wrapper.classList.add('lp-checkbox-absolute');
            row.insertBefore(wrapper, row.firstChild);
        }
    });

    // Inject Select All bar and update counts
    injectSelectAll();
    updateSelectAllState();
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
    <div class="lp-panel-header">
      <div class="lp-panel-logo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
          <line x1="12" y1="22" x2="12" y2="15.5"/>
          <polyline points="22 8.5 12 15.5 2 8.5"/>
          <polyline points="2 15.5 12 8.5 22 15.5"/>
          <line x1="12" y1="2" x2="12" y2="8.5"/>
        </svg>
        <span>LeadPilot</span>
      </div>
      <button id="lp-panel-toggle" class="lp-toggle-btn" title="Minimize">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>

    <div id="lp-panel-body" class="lp-collapsed">
      <div class="lp-section">
        <div class="lp-section-label">
          <span>Selected Leads</span>
          <span id="lp-count" class="lp-badge">0</span>
          <span id="lp-total-count" class="lp-total-count"></span>
        </div>
        <div id="lp-cards-container" class="lp-cards-container">
          <div class="lp-empty-state">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
            <p>Select leads using checkboxes</p>
          </div>
        </div>
      </div>

      ${getTabSelectorHTML()}

      <div class="lp-actions">
        <button id="lp-save-all" class="lp-btn-save" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save All to Sheet
        </button>
        <span class="lp-shortcut-hint">Ctrl+L</span>
        <button id="lp-clear" class="lp-btn-clear">Clear Selection</button>
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

    // Status color dot — update on change
    overlay.querySelectorAll('.lp-status-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const dot = sel.closest('.lp-status-select-wrap')?.querySelector('.lp-status-dot');
            if (dot) dot.style.background = getStatusColor(sel.value);
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
            <div class="lp-review-field">
                <label>LinkedIn URL</label>
                <input type="text" data-field="linkedinUrl" value="${escapeAttr(lead.linkedinUrl)}" placeholder="LinkedIn profile URL" />
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
    <div class="lp-panel-header">
      <div class="lp-panel-logo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
          <line x1="12" y1="22" x2="12" y2="15.5"/>
          <polyline points="22 8.5 12 15.5 2 8.5"/>
          <polyline points="2 15.5 12 8.5 22 15.5"/>
          <line x1="12" y1="2" x2="12" y2="8.5"/>
        </svg>
        <span>LeadPilot</span>
      </div>
      <button id="lp-panel-toggle" class="lp-toggle-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
    <div id="lp-panel-body">
      <div id="lp-profile-preview" class="lp-section"></div>

      ${getTabSelectorHTML()}

      <div class="lp-actions">
        <button id="lp-save-profile" class="lp-btn-save">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save Lead
        </button>
        <button id="lp-connect-profile" class="lp-btn-action">👋 Copy Connect Template</button>
        <button id="lp-message-profile" class="lp-btn-action">💬 Copy Message Template</button>
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
        document.querySelectorAll('.lp-checkbox-wrap').forEach(el => el.remove());
        selectedLeads = [];
    }

    try {
        if (pageType === 'list') {
            injectListCheckboxes();
            injectPanel();
        } else if (pageType === 'profile' || pageType === 'linkedin-profile') {
            injectProfilePanel();
        }
    } catch (err) {
        console.error('[LeadPilot] Main loop error:', err);
    }
}

setInterval(main, 1500);
