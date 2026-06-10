(function (root) {
  const { urlKey } = (root.LeadPilot && root.LeadPilot.urlKey)
    ? root.LeadPilot
    : require('./urlKey.js');

  function createSelectionStore() {
    const map = new Map();
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
