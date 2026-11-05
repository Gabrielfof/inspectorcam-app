'use strict';

/* ============================================================
   Diag — jurnal de diagnostic trimis către calculator.
   Evenimente scurte (cameră deschisă, poză primită, timp de procesare,
   erori, reîncărcări ale paginii), fără numere de înmatriculare.
   Se păstrează în telefon până ajung la calculator — supraviețuiesc
   și unei închideri bruște a paginii de către iOS.
   ============================================================ */
const Diag = (() => {
  const KEY = 'itp-diag';
  const MAX_EVENTS = 300;
  const FLUSH_MS = 20000;
  let flushing = false;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }

  function write(events) {
    try { localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX_EVENTS))); } catch {}
  }

  /* Notează un eveniment: log('photo_received', { kb: 2400, ms: 812 }) */
  function log(event, details) {
    const events = read();
    events.push({ t: new Date().toISOString(), e: String(event).slice(0, 40), d: details || null });
    write(events);
  }

  function deviceId() {
    try { return localStorage.getItem('itp-device-id') || ''; } catch { return ''; }
  }

  function standalone() {
    return !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  }

  /* Trimite evenimentele către calculator; cele trimise se șterg din telefon */
  async function flush() {
    if (flushing) return;
    const events = read();
    if (!events.length) return;
    flushing = true;
    try {
      const res = await fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          device: deviceId(),
          ua: navigator.userAgent,
          standalone: standalone(),
          screen: `${screen.width}x${screen.height}`,
          net: (navigator.connection && navigator.connection.effectiveType) || null,
          events,
        }),
      });
      if (res.ok) write(read().slice(events.length));   // păstrăm ce s-a notat între timp
    } catch {
      // fără conexiune — rămân în telefon pentru data viitoare
    } finally {
      flushing = false;
    }
  }

  function start() {
    // Cum s-a deschis pagina: „reload” = reîncărcată (ex. de iOS după cameră)
    let nav = null;
    try { nav = performance.getEntriesByType('navigation')[0]?.type || null; } catch {}
    log('app_start', {
      nav,
      standalone: standalone(),
      online: navigator.onLine,
      memGB: navigator.deviceMemory || null,
    });

    window.addEventListener('error', e => log('js_error', { msg: String(e.message).slice(0, 200), at: `${(e.filename || '').split('/').pop()}:${e.lineno}` }));
    window.addEventListener('unhandledrejection', e => log('js_rejection', { msg: String((e.reason && (e.reason.message || e.reason)) || '').slice(0, 200) }));
    window.addEventListener('pagehide', () => log('page_hide'));
    window.addEventListener('online', () => { log('online'); flush(); });
    window.addEventListener('offline', () => log('offline'));

    setTimeout(flush, 3000);
    setInterval(flush, FLUSH_MS);
  }

  return { log, flush, start };
})();
