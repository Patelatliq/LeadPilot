document.addEventListener('DOMContentLoaded', () => {
  const webAppUrlInput = document.getElementById('webAppUrl');
  const saveWebAppUrlBtn = document.getElementById('saveWebAppUrl');
  const connectTemplateInput = document.getElementById('connectTemplate');
  const saveConnectTemplateBtn = document.getElementById('saveConnectTemplate');
  const messageTemplateInput = document.getElementById('messageTemplate');
  const saveMessageTemplateBtn = document.getElementById('saveMessageTemplate');
  const statusDiv = document.getElementById('lp-status');
  const helpToggle = document.getElementById('helpToggle');
  const helpSection = document.getElementById('helpSection');
  const tabsList = document.getElementById('tabsList');
  const newTabInput = document.getElementById('newTabName');
  const addTabBtn = document.getElementById('addTab');
  const refreshTabsBtn = document.getElementById('refreshTabs');

  let sheetTabs = []; // Array of tab names

  // ---------------------------
  // Load saved settings
  // ---------------------------
  chrome.storage.sync.get(['webAppUrl', 'connectTemplate', 'messageTemplate', 'sheetTabs'], (result) => {
    if (result.webAppUrl) webAppUrlInput.value = result.webAppUrl;
    if (result.connectTemplate) connectTemplateInput.value = result.connectTemplate;
    if (result.messageTemplate) messageTemplateInput.value = result.messageTemplate;
    sheetTabs = result.sheetTabs || [];
    renderTabs();
  });

  // ---------------------------
  // Save Google Script URL + auto-fetch tabs
  // ---------------------------
  saveWebAppUrlBtn.addEventListener('click', async () => {
    const url = webAppUrlInput.value.trim();
    if (!url.startsWith('https://script.google.com/')) {
      showStatus('Invalid URL — must start with https://script.google.com/', 'error');
      return;
    }
    chrome.storage.sync.set({ webAppUrl: url }, () => {
      showStatus('✓ Script URL saved!', 'success');
    });
    // Auto-fetch tab names
    await fetchTabNames(url);
  });

  // ---------------------------
  // Fetch tab names from Google Sheet
  // ---------------------------
  async function fetchTabNames(url) {
    if (!url) {
      const result = await chrome.storage.sync.get(['webAppUrl']);
      url = result.webAppUrl;
    }
    if (!url) {
      showStatus('Set your Script URL first', 'error');
      return;
    }
    showStatus('Fetching sheet tabs...', 'info');
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.sheets && data.sheets.length > 0) {
        // Merge with existing tabs (keep custom ones)
        const newTabs = data.sheets.filter(t => !sheetTabs.includes(t));
        sheetTabs = [...sheetTabs, ...newTabs];
        // Remove duplicates
        sheetTabs = [...new Set(sheetTabs)];
        chrome.storage.sync.set({ sheetTabs });
        renderTabs();
        showStatus(`✓ Found ${data.sheets.length} tab(s)`, 'success');
      } else {
        showStatus('✓ Connected — no tabs found yet', 'success');
      }
    } catch (err) {
      console.error('[LeadPilot] Fetch tabs error:', err);
      showStatus('Could not fetch tabs — check URL', 'error');
    }
  }

  // ---------------------------
  // Refresh tabs button
  // ---------------------------
  refreshTabsBtn.addEventListener('click', () => fetchTabNames());

  // ---------------------------
  // Add new tab manually
  // ---------------------------
  addTabBtn.addEventListener('click', () => {
    const name = newTabInput.value.trim();
    if (!name) return;
    if (sheetTabs.includes(name)) {
      showStatus('Tab already exists', 'error');
      return;
    }
    sheetTabs.push(name);
    chrome.storage.sync.set({ sheetTabs });
    renderTabs();
    newTabInput.value = '';
    showStatus(`✓ "${name}" added`, 'success');
  });

  // ---------------------------
  // Render tab chips
  // ---------------------------
  function renderTabs() {
    if (!tabsList) return;
    if (sheetTabs.length === 0) {
      tabsList.innerHTML = '<div class="lp-tabs-empty">No tabs yet — connect your sheet or add manually</div>';
      return;
    }
    tabsList.innerHTML = sheetTabs.map((name, i) =>
      `<span class="lp-tab-chip">
        <span>${name}</span>
        <button class="lp-tab-remove" data-index="${i}" title="Remove">×</button>
      </span>`
    ).join('');

    tabsList.querySelectorAll('.lp-tab-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        sheetTabs.splice(idx, 1);
        chrome.storage.sync.set({ sheetTabs });
        renderTabs();
      });
    });
  }

  // ---------------------------
  // Templates
  // ---------------------------
  saveConnectTemplateBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ connectTemplate: connectTemplateInput.value }, () => {
      showStatus('✓ Connect template saved!', 'success');
    });
  });

  saveMessageTemplateBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ messageTemplate: messageTemplateInput.value }, () => {
      showStatus('✓ Message template saved!', 'success');
    });
  });

  // ---------------------------
  // Help toggle
  // ---------------------------
  helpToggle.addEventListener('click', (e) => {
    e.preventDefault();
    helpSection.style.display = helpSection.style.display === 'none' ? 'block' : 'none';
  });

  // ---------------------------
  // Status toast
  // ---------------------------
  function showStatus(msg, type = 'success') {
    statusDiv.textContent = msg;
    statusDiv.className = 'lp-status active ' + type;
    clearTimeout(statusDiv._timer);
    statusDiv._timer = setTimeout(() => {
      statusDiv.className = 'lp-status';
      statusDiv.textContent = '';
    }, 4000);
  }
});
