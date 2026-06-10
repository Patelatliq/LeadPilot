(function (root) {
  function urlKey(input) {
    if (!input) return '';
    let s = String(input).trim();
    s = s.split('#')[0].split('?')[0];
    s = s.replace(/^https?:\/\//i, '').replace(/^\/\//, '');
    if (s.startsWith('/')) s = 'www.linkedin.com' + s;
    s = s.replace(/^www\./i, '');
    s = s.toLowerCase();
    s = s.replace(/(\/sales\/(?:lead|people)\/)([^/,]+).*$/, '$1$2');
    s = s.replace(/\/+$/, '');
    return s;
  }
  root.LeadPilot = root.LeadPilot || {};
  root.LeadPilot.urlKey = urlKey;
  if (typeof module !== 'undefined' && module.exports) module.exports = { urlKey };
})(typeof window !== 'undefined' ? window : globalThis);
