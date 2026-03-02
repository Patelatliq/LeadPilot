console.log('[LeadPilot] Content Script v2.1 — Fixed');

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

function addToQueue(data) {
    if (selectedLeads.find(l => l.linkedinUrl === data.linkedinUrl)) return false;
    selectedLeads.push(data);
    renderPanel();
    return true;
}

function removeFromQueue(index) {
    selectedLeads.splice(index, 1);
    renderPanel();
}

function clearQueue() {
    selectedLeads = [];
    document.querySelectorAll('.lp-row-checkbox:checked').forEach(cb => cb.checked = false);
    document.querySelectorAll('.lp-row-selected').forEach(el => el.classList.remove('lp-row-selected'));
    renderPanel();
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

    return { firstName, lastName, linkedinUrl, companyName, jobTitle, country, city, companyService: '' };
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

    return { firstName, lastName, linkedinUrl, companyName, jobTitle, country, city, companyService };
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

        // Insert at beginning of row (before the first real cell content)
        row.insertBefore(wrapper, row.firstChild);
    });
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

    <div id="lp-panel-body">
      <div class="lp-section">
        <div class="lp-section-label">
          <span>Selected Leads</span>
          <span id="lp-count" class="lp-badge">0</span>
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
        <button id="lp-clear" class="lp-btn-clear">Clear Selection</button>
      </div>

      <div id="lp-status-bar" class="lp-status-bar"></div>
    </div>
  `;
    document.body.appendChild(panel);

    // Toggle minimize
    document.getElementById('lp-panel-toggle').addEventListener('click', () => {
        document.getElementById('lp-panel-body').classList.toggle('lp-collapsed');
        document.getElementById('lp-panel').classList.toggle('lp-minimized');
    });

    document.getElementById('lp-save-all').addEventListener('click', saveAllLeads);
    document.getElementById('lp-clear').addEventListener('click', clearQueue);

    // Make panel draggable
    makeDraggable(panel);

    // Initialize tab selector (with storage change listener)
    initTabSelector();
}

// =============================================
// RENDER PANEL
// =============================================
function renderPanel() {
    const container = document.getElementById('lp-cards-container');
    const countEl = document.getElementById('lp-count');
    const saveBtn = document.getElementById('lp-save-all');
    if (!container) return;

    countEl.textContent = selectedLeads.length;
    saveBtn.disabled = selectedLeads.length === 0;

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
      <button class="lp-card-remove" data-index="${i}" title="Remove">
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

    const saveBtn = document.getElementById('lp-save-all');
    const total = selectedLeads.length;
    const tabs = getSelectedTabs();

    console.log('[LeadPilot] Saving to tabs:', tabs);

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="lp-spinner"></span> Saving 0/${total}...`;
    updateStatus('Saving leads...', '#818cf8');

    let saved = 0, failed = 0;

    for (let i = 0; i < selectedLeads.length; i++) {
        const lead = selectedLeads[i];
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
        const tabInfo = tabs.length > 0 ? ` → ${tabs.join(', ')}` : '';
        updateStatus(`✓ ${saved} lead${saved > 1 ? 's' : ''} saved!${tabInfo}`, '#34d399');
        saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Saved!`;
        setTimeout(() => {
            clearQueue();
            saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save All to Sheet`;
            saveBtn.disabled = true;
        }, 2500);
    } else {
        updateStatus(`${saved} saved, ${failed} failed`, '#f87171');
        saveBtn.innerHTML = `${saved} saved, ${failed} failed — Retry?`;
        saveBtn.disabled = false;
    }
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

    // Save profile
    document.getElementById('lp-save-profile').addEventListener('click', () => {
        const data = extractFromProfile();
        const tabs = getSelectedTabs();
        const btn = document.getElementById('lp-save-profile');
        btn.innerHTML = '<span class="lp-spinner"></span> Saving...';
        btn.disabled = true;
        console.log('[LeadPilot] Saving profile to tabs:', tabs);
        chrome.runtime.sendMessage({
            action: 'saveLead',
            data,
            selectedTabs: tabs
        }, (resp) => {
            if (resp?.success) {
                btn.innerHTML = '✓ Saved!';
                updateStatus(resp.message || 'Lead saved!', '#34d399');
            } else {
                btn.innerHTML = '✗ Failed';
                btn.disabled = false;
                updateStatus(resp?.error || 'Save failed', '#f87171');
            }
            setTimeout(() => {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Lead`;
                btn.disabled = false;
            }, 2500);
        });
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
        document.querySelectorAll('.lp-checkbox-wrap').forEach(el => el.remove());
        selectedLeads = [];
    }

    if (pageType === 'list') {
        injectListCheckboxes();
        injectPanel();
    } else if (pageType === 'profile' || pageType === 'linkedin-profile') {
        injectProfilePanel();
    }
}

setInterval(main, 1500);
