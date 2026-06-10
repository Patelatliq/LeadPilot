(function (root) {
  const SELECTORS = {
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
