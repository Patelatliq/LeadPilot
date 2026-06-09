document.addEventListener('DOMContentLoaded', () => {
  const webAppUrlInput = document.getElementById('webAppUrl');
  const saveWebAppUrlBtn = document.getElementById('saveWebAppUrl');
  const connectTemplateInput = document.getElementById('connectTemplate');
  const saveConnectTemplateBtn = document.getElementById('saveConnectTemplate');
  const messageTemplateInput = document.getElementById('messageTemplate');
  const saveMessageTemplateBtn = document.getElementById('saveMessageTemplate');
  const statusDiv = document.getElementById('lp-status');
  const tabsList = document.getElementById('tabsList');
  const newTabInput = document.getElementById('newTabName');
  const addTabBtn = document.getElementById('addTab');
  const refreshTabsBtn = document.getElementById('refreshTabs');

  // Connection state elements
  const connectionDot = document.getElementById('lp-connection-dot');
  const urlEditState = document.getElementById('lp-url-edit-state');
  const urlConnectedState = document.getElementById('lp-url-connected-state');
  const urlTruncated = document.getElementById('lp-url-truncated');
  const urlEditTrigger = document.getElementById('lp-url-edit-trigger');

  // Collapsible section elements
  const templatesToggle = document.getElementById('templates-toggle');
  const templatesBody = document.getElementById('templates-body');
  const helpToggle = document.getElementById('help-toggle');
  const helpBody = document.getElementById('helpSection');

  let sheetTabs = [];

  // ---------------------------
  // Connection state display
  // ---------------------------
  function setConnectionState(url) {
    if (url) {
      const display = url.length > 42 ? url.slice(0, 22) + '...' + url.slice(-14) : url;
      urlTruncated.textContent = display;
      urlEditState.style.display = 'none';
      urlConnectedState.style.display = 'block';
      connectionDot.classList.add('connected');
      connectionDot.title = 'Connected';
    } else {
      urlEditState.style.display = 'block';
      urlConnectedState.style.display = 'none';
      connectionDot.classList.remove('connected');
      connectionDot.title = 'Not connected';
    }
  }

  urlEditTrigger.addEventListener('click', () => {
    chrome.storage.sync.get(['webAppUrl'], r => {
      webAppUrlInput.value = r.webAppUrl || '';
      urlEditState.style.display = 'block';
      urlConnectedState.style.display = 'none';
      webAppUrlInput.focus();
      webAppUrlInput.select();
    });
  });

  // ---------------------------
  // Collapsible sections
  // ---------------------------
  function initCollapsible(toggleEl, bodyEl) {
    toggleEl.addEventListener('click', () => {
      const isOpen = bodyEl.classList.contains('open');
      bodyEl.classList.toggle('open', !isOpen);
      toggleEl.classList.toggle('open', !isOpen);
    });
  }

  initCollapsible(templatesToggle, templatesBody);
  initCollapsible(helpToggle, helpBody);

  // ---------------------------
  // Load saved settings
  // ---------------------------
  chrome.storage.sync.get(['webAppUrl', 'connectTemplate', 'messageTemplate', 'sheetTabs'], (result) => {
    if (result.webAppUrl) webAppUrlInput.value = result.webAppUrl;
    if (result.connectTemplate) connectTemplateInput.value = result.connectTemplate;
    if (result.messageTemplate) messageTemplateInput.value = result.messageTemplate;
    sheetTabs = result.sheetTabs || [];
    renderTabs();
    setConnectionState(result.webAppUrl || null);
    if (result.webAppUrl) fetchTabNames(result.webAppUrl);
  });

  // ---------------------------
  // Save Google Script URL
  // ---------------------------
  saveWebAppUrlBtn.addEventListener('click', async () => {
    const url = webAppUrlInput.value.trim();
    if (!url.startsWith('https://script.google.com/')) {
      showStatus('Invalid URL — must start with https://script.google.com/', 'error');
      return;
    }
    chrome.storage.sync.set({ webAppUrl: url }, () => {
      showStatus('Script URL saved', 'success');
      setConnectionState(url);
    });
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
    showStatus('Fetching tabs...', 'info');
    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'fetchTabs', url }, (response) => {
          resolve(response);
        });
      });

      if (!result || !result.success) {
        showStatus(result?.error || 'Could not fetch tabs — check URL', 'error');
        return;
      }

      const data = result.data;
      if (data.sheets && data.sheets.length > 0) {
        sheetTabs = [...new Set(data.sheets)];
        chrome.storage.sync.set({ sheetTabs });
        renderTabs();
        showStatus(`${data.sheets.length} tab${data.sheets.length > 1 ? 's' : ''} found`, 'success');
      } else {
        sheetTabs = [];
        chrome.storage.sync.set({ sheetTabs });
        renderTabs();
        showStatus('Connected — no tabs yet', 'success');
      }
    } catch (err) {
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
    showStatus(`"${name}" added`, 'success');
  });

  newTabInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTabBtn.click();
  });

  // ---------------------------
  // Render tab list rows with checkboxes
  // ---------------------------
  function renderTabs() {
    if (!tabsList) return;
    if (sheetTabs.length === 0) {
      tabsList.innerHTML = '<div class="lp-tabs-empty">No tabs yet — connect your sheet or add manually</div>';
      return;
    }

    chrome.storage.sync.get(['selectedTabs'], (r) => {
      const sel = r.selectedTabs || [];
      tabsList.innerHTML = sheetTabs.map((name) => {
        const checked = sel.includes(name) ? 'checked' : '';
        const safeId = 'lp-ptab-' + name.replace(/[^a-zA-Z0-9]/g, '_');
        return `<label class="lp-tab-row" for="${safeId}">
          <input type="checkbox" id="${safeId}" value="${name}" ${checked}>
          <span class="lp-tab-row-name">${name}</span>
        </label>`;
      }).join('');

      // Save selection on checkbox change
      tabsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const selected = Array.from(tabsList.querySelectorAll('input:checked')).map(c => c.value);
          chrome.storage.sync.set({ selectedTabs: selected });
        });
      });
    });
  }

  // ---------------------------
  // Templates
  // ---------------------------
  saveConnectTemplateBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ connectTemplate: connectTemplateInput.value }, () => {
      showStatus('Connect template saved', 'success');
    });
  });

  saveMessageTemplateBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ messageTemplate: messageTemplateInput.value }, () => {
      showStatus('Message template saved', 'success');
    });
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
    }, 3500);
  }
});
