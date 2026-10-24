'use strict';

/* ============================================================
   Photo step definitions
   ============================================================ */
const ALL_STEPS = [
  { id: 'fata',          label: 'Față — plăcuță vizibilă',        hint: 'Asigurați-vă că numărul de înmatriculare se vede clar' },
  { id: 'stand-franare', label: 'Vehicul pe standul de frânare',   hint: 'Fotografiați vehiculul pe standul de frânare' },
  { id: 'motor',         label: 'Compartiment motor',              hint: 'Ridicați capota și fotografiați motorul', configKey: 'enable_motor_photo' },
  { id: 'odometru',      label: 'Indicația odometrului',           hint: 'Fotografiați afișajul cu kilometrii parcurși' },
  { id: 'interior',      label: 'Amenajare interioară',            hint: 'Fotografiați interiorul vehiculului', configKey: 'enable_interior_photo' },
  { id: 'final',         label: 'Ecuson aplicat pe plăcuță',       hint: 'Fotografiați plăcuța după aplicarea ecusonului ITP' },
  { id: 'extra-1',       label: 'Fotografie suplimentară 1',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_1' },
  { id: 'extra-2',       label: 'Fotografie suplimentară 2',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_2' },
  { id: 'extra-3',       label: 'Fotografie suplimentară 3',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_3' },
  { id: 'extra-4',       label: 'Fotografie suplimentară 4',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_4' },
  { id: 'extra-5',       label: 'Fotografie suplimentară 5',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_5' },
  { id: 'extra-6',       label: 'Fotografie suplimentară 6',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_6' },
  { id: 'extra-7',       label: 'Fotografie suplimentară 7',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_7' },
  { id: 'extra-8',       label: 'Fotografie suplimentară 8',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_8' },
  { id: 'extra-9',       label: 'Fotografie suplimentară 9',       hint: 'Fotografiați detalii suplimentare ale vehiculului', configKey: 'enable_extra_9' },
];

/* ============================================================
   App module
   ============================================================ */
const App = (() => {
  /* ---- state ---- */
  const state = {
    inspector:    null,
    config:       {},
    inspectors:   [],
    activePlates: new Map(), // plate → {id, plate, notes, photos, currentStep, activeSteps, appendToInspectionId?}
    currentPlate: null,
  };

  let cameraRunning = false;
  let cameraMode = 'none'; // 'stream' | 'fileinput'

  // Cât așteptăm după OpenCV la o poză, dacă încă se încarcă (prima utilizare)
  const DOCSCAN_WAIT_MS = 5000;

  /* Helper: inspecția curentă (placa activă în cameră) */
  function currentInspection() {
    return state.activePlates.get(state.currentPlate);
  }

  /* ============================================================
     Screen navigation
     ============================================================ */
  function show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(screenId);
    if (el) el.classList.add('active');
  }

  /* ============================================================
     Init
     ============================================================ */
  async function init() {
    show('screen-loading');
    initCropEditor();

    // Restore session
    try {
      const saved = sessionStorage.getItem('itp-inspector');
      if (saved) state.inspector = JSON.parse(saved);
    } catch { /* ignore */ }

    // F2: Restore active plates (supraviețuiesc sleep/reload)
    try {
      const savedPlates = await Storage.getActivePlates();
      for (const insp of savedPlates) {
        // Repară pozele: reconstituie blob din dataUrl dacă blob-ul e invalid,
        // sau generează dataUrl dacă lipseşte — evită "?" după reload iOS
        for (const photo of (insp.photos || [])) {
          if (photo.dataUrl && (!(photo.blob instanceof Blob) || photo.blob.size === 0)) {
            try {
              photo.blob = await fetch(photo.dataUrl).then(r => r.blob());
              photo.baseBlob = photo.blob;
            } catch { /* lasăm blob-ul invalid, va fi filtrat la upload */ }
          } else if (!photo.dataUrl && photo.blob instanceof Blob && photo.blob.size > 0) {
            photo.dataUrl = await blobToDataUrl(photo.blob);
          }
        }
        state.activePlates.set(insp.plate, insp);
      }
    } catch { /* ignore */ }

    try {
      [state.config, state.inspectors] = await Promise.all([
        Sync.fetchConfig(),
        Sync.fetchInspectors(),
      ]);

      if (state.inspector) {
        goHome();
      } else {
        showLogin();
      }
    } catch (err) {
      showOffline();
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }

    startSyncLoop();
  }

  /* ============================================================
     Login
     ============================================================ */
  const DAYS_RO   = ['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'];
  const MONTHS_RO = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];

  let _clockTimer = null;

  function startLoginClock() {
    function tick() {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const dateEl = document.getElementById('login-date');
      const timeEl = document.getElementById('login-time');
      if (dateEl) dateEl.textContent = `${DAYS_RO[now.getDay()]}, ${now.getDate()} ${MONTHS_RO[now.getMonth()]} ${now.getFullYear()}`;
      if (timeEl) timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    tick();
    clearInterval(_clockTimer);
    _clockTimer = setInterval(tick, 10_000);
  }

  function stopLoginClock() {
    clearInterval(_clockTimer);
    _clockTimer = null;
  }

  function getInitials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function showLogin() {
    const stationEl = document.getElementById('login-station-name');
    if (stationEl) stationEl.textContent = state.config.station_name || '';

    startLoginClock();

    // Inspecții azi
    Sync.fetchTodayInspections().then(list => {
      const el = document.getElementById('login-stat-inspections');
      if (el) el.textContent = list.length;
    }).catch(() => {});

    const list = document.getElementById('inspector-list');
    list.innerHTML = '';

    if (state.inspectors.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0">Niciun inspector configurat. Adăugați inspectori din aplicația de pe calculator.</p>';
    } else {
      state.inspectors.forEach(insp => {
        const btn = document.createElement('button');
        btn.className = 'inspector-btn';
        btn.innerHTML = `<img class="inspector-flag" src="/icons/flag.png" alt="">${escHtml(insp.name)}`;
        btn.addEventListener('click', () => handleInspectorSelect(insp));
        list.appendChild(btn);
      });
    }

    show('screen-login');
  }

  async function handleInspectorSelect(inspector) {
    try {
      await Sync.verifyPin(inspector.id, '');
      loginAs(inspector);
    } catch {
      showPinPrompt(inspector);
    }
  }

  function showPinPrompt(inspector) {
    const modal    = document.getElementById('pin-modal');
    const pinInput = document.getElementById('pin-input');

    document.getElementById('pin-inspector-name').textContent = inspector.name;
    pinInput.value = '';

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add('open'));
    });

    function closeModal() {
      pinInput.blur();
      modal.classList.remove('open');
      modal.style.display = 'none';
    }

    document.getElementById('pin-confirm-btn').onclick = async () => {
      const pin = pinInput.value;
      try {
        await Sync.verifyPin(inspector.id, pin);
        closeModal();
        loginAs(inspector);
      } catch {
        toast('PIN incorect. Încercați din nou.', 'error');
        pinInput.value = '';
        pinInput.focus();
      }
    };

    document.getElementById('pin-cancel-btn').onclick = closeModal;

    setTimeout(() => pinInput.focus(), 350);
  }

  function loginAs(inspector) {
    state.inspector = inspector;
    sessionStorage.setItem('itp-inspector', JSON.stringify(inspector));
    stopLoginClock();
    goHome();
  }

  function logout() {
    state.activePlates.clear();
    state.currentPlate = null;
    sessionStorage.removeItem('itp-inspector');
    state.inspector = null;
    Camera.stop();
    cameraRunning = false;
    cameraMode = 'none';
    Storage.clearActivePlates().catch(() => {});
    showLogin();
  }

  /* IDs-urile inspecțiilor ascunse local în sesiunea curentă */
  const hiddenInspectionIds = new Set();

  /* ============================================================
     Home
     ============================================================ */
  async function goHome() {
    if (cameraRunning) { Camera.stop(); cameraRunning = false; cameraMode = 'none'; }
    state.currentPlate = null;

    document.getElementById('home-station-name').textContent = state.config.station_name || 'InspectorCam';
    document.getElementById('home-inspector-name').textContent = state.inspector.name;
    renderActivePlates();
    show('screen-home');
    preloadDocScan();

    const today = new Date().toISOString().slice(0, 10);

    const [serverInspections, allPending] = await Promise.all([
      Sync.fetchTodayInspections().catch(() => []),
      Storage.getPending().catch(() => []),
    ]);

    // Sincronizăm completed_plates din server — previne duplicate chiar dacă
    // store-ul local era gol (upgrade DB) sau inspecția a fost trimisă pe alt device
    for (const insp of serverInspections) {
      if ((insp.datetime || '').slice(0, 10) === today) {
        Storage.saveCompletedPlate({
          id:           insp.id,
          plate:        insp.plate,
          date:         today,
          photos_saved: (insp.photos || []).length,
        }).catch(() => {});
      }
    }

    const pendingToday = allPending.filter(p => (p.datetime || '').slice(0, 10) === today);

    const allItems = [
      ...serverInspections.map(i => ({ ...i, status: 'synced' })),
      ...pendingToday.map(p => ({
        id:             p.id,
        plate:          p.plate,
        datetime:       p.datetime,
        inspector_name: state.inspector.name,
        status:         'pending',
      })),
    ]
      .filter(i => !hiddenInspectionIds.has(i.id))
      .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    renderTodayList(allItems);
  }

  function renderActivePlates() {
    const list = document.getElementById('active-plates-list');
    if (!list) return;
    list.innerHTML = '';

    for (const [plate, insp] of state.activePlates) {
      const count = insp.photos.length;
      const chip = document.createElement('div');
      chip.className = 'active-plate-chip';
      chip.innerHTML = `
        <div class="chip-left">
          <span class="chip-plate">${escHtml(plate)}</span>
          <span class="chip-photos">${count} ${count === 1 ? 'fotografie' : 'fotografii'}</span>
        </div>
        <div class="chip-actions">
          <span class="chip-edit">Modifică nr.</span>
          <span class="chip-cancel">Anulează</span>
        </div>
      `;
      chip.addEventListener('click', () => resumePlate(plate));
      chip.querySelector('.chip-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        editPlate(plate);
      });
      chip.querySelector('.chip-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        cancelCase(plate);
      });
      list.appendChild(chip);
    }
  }

  function renderTodayList(items) {
    document.getElementById('today-count').textContent = items.length;
    const container = document.getElementById('today-list');

    if (items.length === 0) {
      container.innerHTML = '<p class="no-inspections">Nicio inspecție înregistrată azi.</p>';
      return;
    }

    container.innerHTML = items.map(insp => {
      const time = new Date(insp.datetime).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
      const badge = insp.status === 'pending'
        ? '<span class="sync-badge pending">local</span>'
        : '<span class="sync-badge synced">ok</span>';
      const photoCount = (insp.photos || []).length;
      const addBtn = insp.status === 'synced'
        ? `<button class="btn-add-more" onclick="event.stopPropagation();App.reopenForMorePhotos('${escHtml(insp.plate)}','${escHtml(insp.id)}','${photoCount}')">+ Poze</button>`
        : '';
      const clickable = insp.status === 'synced'
        ? `onclick="App.viewInspection('${escHtml(insp.id)}','${escHtml(insp.plate)}','${escHtml(insp.datetime)}')" style="cursor:pointer"`
        : '';
      const deleteBtn = `<button class="btn-delete-inspection" onclick="event.stopPropagation();App.deleteInspection('${escHtml(insp.id || '')}','${insp.status}')" title="Șterge">✕</button>`;
      return `
        <div class="inspection-item" ${clickable}>
          <span class="inspection-plate">${escHtml(insp.plate)}</span>
          <div class="inspection-time-row">${deleteBtn}<span class="inspection-time">${time}</span></div>
          <span class="inspection-inspector">${escHtml(insp.inspector_name || '')}</span>
          ${badge}${addBtn}
        </div>`;
    }).join('');
  }

  /* ============================================================
     New inspection — plate input
     ============================================================ */
  function startNewInspection() {
    document.getElementById('plate-input').value = '';
    show('screen-plate');
    setTimeout(() => document.getElementById('plate-input').focus(), 300);
  }

  function getActiveSteps() {
    if (state.config.custom_steps) {
      try {
        const parsed = JSON.parse(state.config.custom_steps);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return ALL_STEPS.filter(step => {
      if (!step.configKey) return true;
      return state.config[step.configKey] !== '0';
    });
  }

  /* Formatare automată număr de înmatriculare:
     BV33ABG → BV-33-ABG  |  B123XYZ → B-123-XYZ
     MAI01ABC → MAI-01-ABC  |  A12345 → A-12345 (armată) */
  const SPECIAL_PREFIXES_3 = ['MAI', 'GUV', 'DEP', 'SNT', 'SRI', 'POL'];

  function formatPlate(raw) {
    const s = raw.replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length < 2) return s;

    let county, rest;
    const threePrefix = SPECIAL_PREFIXES_3.find(p => s.startsWith(p));
    if (threePrefix) {
      // Prefix special de 3 litere: MAI, GUV, DEP etc.
      county = threePrefix;
      rest   = s.slice(3);
    } else if (s[0] === 'B' && s.length > 1 && /\d/.test(s[1])) {
      // București: B urmat direct de cifră
      county = 'B';
      rest   = s.slice(1);
    } else if (s[0] === 'A' && s.length > 1 && /\d/.test(s[1])) {
      // Armată: A urmat direct de cifre
      county = 'A';
      rest   = s.slice(1);
    } else {
      county = s.slice(0, 2);
      rest   = s.slice(2);
    }

    const digits  = (rest.match(/^\d+/) || [''])[0];
    const letters = rest.slice(digits.length).replace(/\d/g, '');

    return [county, digits, letters].filter(p => p.length > 0).join('-');
  }

  function formatPlateInput(input) {
    const formatted = formatPlate(input.value);
    input.value = formatted;
  }

  async function confirmPlate() {
    const raw = formatPlate(document.getElementById('plate-input').value);
    if (!raw) { toast('Introduceți numărul de înmatriculare.', 'error'); return; }

    // Dacă placa e deja activă, continuăm cu ea
    if (state.activePlates.has(raw)) {
      resumePlate(raw);
      return;
    }

    // Verificăm dacă a fost trimisă azi → adăugăm la inspecția existentă,
    // la fel ca la „+ Poze” (etapa e limitată la numărul de pași existenți)
    try {
      const today     = new Date().toISOString().slice(0, 10);
      const completed = await Storage.getCompletedPlates();
      const match     = completed.find(c => c.plate === raw && c.date === today);
      if (match) {
        reopenForMorePhotos(raw, match.id, match.photos_saved || 0);
        return;
      }
    } catch { /* ignorăm */ }

    const insp = {
      id:                   generateId(),
      plate:                raw,
      notes:                '',
      photos:               [],
      currentStep:          0,
      activeSteps:          getActiveSteps(),
      appendToInspectionId: null,
    };
    state.activePlates.set(raw, insp);
    state.currentPlate = raw;
    Storage.saveActivePlate(insp).catch(() => {});
    startStep(0);
  }

  /* Continuă fotografierea pentru o mașină activă */
  function resumePlate(plate) {
    state.currentPlate = plate;
    const insp = state.activePlates.get(plate);
    // Găsim primul pas fără fotografie
    const nextIdx = insp.activeSteps.findIndex(step => !insp.photos.some(p => p.step === step.id));
    startStep(nextIdx >= 0 ? nextIdx : 0);
  }

  /* ============================================================
     Camera / photo steps
     ============================================================ */
  async function startStep(index) {
    const insp = currentInspection();
    insp.currentStep = index;
    const step  = insp.activeSteps[index];
    const total = insp.activeSteps.length;

    document.getElementById('step-counter').textContent = `Etapa ${index + 1}`;
    const stepLabelEl = document.getElementById('step-label');
    if (stepLabelEl) stepLabelEl.textContent = `Etapa ${index + 1}`;
    const stepHintEl = document.getElementById('step-hint');
    if (stepHintEl) stepHintEl.textContent = step.hint || step.label;

    // Afișăm placa curentă în cameră
    const plateIndicator = document.getElementById('camera-plate-indicator');
    if (plateIndicator) plateIndicator.textContent = state.currentPlate || '';

    // Reset UI
    document.getElementById('camera-fallback').classList.add('hidden');

    // Note indicator
    // Placeholder-ele ✓ (poze deja pe server) nu au imagine locală
    const existing = insp.photos.find(p => p.step === step.id && !p.uploaded);
    updateNoteIndicator(existing?.note || '');

    show('screen-camera');

    if (existing) {
      showPreview(existing.blob);
    } else {
      hidePreview();
      if (cameraMode === 'fileinput') {
        const captureBtn = document.querySelector('.btn-capture');
        if (captureBtn) captureBtn.onclick = captureViaFileInput;
        showStepInstruction(index + 1, total, `Etapa ${index + 1}`);
      } else {
        await ensureCameraRunning();
      }
    }

    // F1: actualizează strip-ul cu pozele deja făcute
    renderPhotoStrip();
  }

  /* F1: Strip minimal cu pozele deja făcute (apare jos în cameră) */
  function renderPhotoStrip() {
    const insp = currentInspection();
    if (!insp) return;
    const strip = document.getElementById('photo-strip');
    if (!strip) return;

    if (insp.photos.length === 0) {
      strip.classList.add('hidden');
      return;
    }

    strip.classList.remove('hidden');

    strip.innerHTML = '';

    insp.activeSteps.forEach((step, idx) => {
      const photo = insp.photos.find(p => p.step === step.id);
      const thumb = document.createElement('div');
      thumb.className = 'strip-thumb' +
        (idx === insp.currentStep ? ' strip-active' : '') +
        (photo ? '' : ' strip-empty');

      if (photo && photo.uploaded) {
        // Poza e deja pe server, nu există local — nu se poate deschide
        thumb.classList.add('strip-uploaded');
        thumb.textContent = '✓';
      } else if (photo) {
        const img = document.createElement('img');
        img.src = photo.dataUrl || URL.createObjectURL(photo.blob);
        img.alt = step.label;
        thumb.appendChild(img);
        thumb.addEventListener('click', () => { if (idx !== insp.currentStep) startStep(idx); });
      } else {
        thumb.textContent = String(idx + 1);
      }

      strip.appendChild(thumb);
    });
  }

  function showStepInstruction(index, _total, label) {
    document.getElementById('step-instruction-label').textContent = label;
    document.getElementById('step-instruction').classList.remove('hidden');
    const insp = currentInspection();
    const finalizeBtn = document.getElementById('step-finalize-btn');
    if (finalizeBtn) {
      if (insp && insp.photos.filter(p => !p.uploaded).length > 0) {
        finalizeBtn.classList.remove('hidden');
      } else {
        finalizeBtn.classList.add('hidden');
      }
    }
  }

  function hideStepInstruction() {
    document.getElementById('step-instruction').classList.add('hidden');
  }

  function startCapture() {
    hideStepInstruction();
    captureViaFileInput();
  }

  async function ensureCameraRunning() {
    if (cameraRunning) return;
    const video = document.getElementById('camera-video');
    try {
      await Camera.start(video);
      cameraRunning = true;
      cameraMode = 'stream';
    } catch (err) {
      video.classList.add('hidden');
      cameraRunning = true;
      cameraMode = 'fileinput';
      const captureBtn = document.querySelector('.btn-capture');
      if (captureBtn) captureBtn.onclick = captureViaFileInput;
      const insp = currentInspection();
      const total = insp.activeSteps.length;
      showStepInstruction(insp.currentStep + 1, total, `Etapa ${insp.currentStep + 1}`);
    }
  }

  function captureViaFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      // Capturăm referința ÎNAINTE de orice await — dacă userul dă back sau
      // închide telefonul în timp ce se procesează, inspecția rămâne accesibilă
      const insp = currentInspection();
      if (!insp) return;
      const step = insp.activeSteps[insp.currentStep];
      if (!step) return;

      hideStepInstruction();
      toast('Se procesează…', 'info');
      try {
        const raw = await Camera.fileToCanvas(file);
        await processAndSave(raw, { step, insp, source: 'camera', watermark: buildWatermark() });
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    input.click();
  }

  async function capturePhoto() {
    const insp = currentInspection();
    if (!insp) return;
    const step = insp.activeSteps[insp.currentStep];
    if (!step) return;
    try {
      const raw = Camera.captureCanvas();
      await processAndSave(raw, { step, insp, source: 'camera', watermark: buildWatermark() });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function importFromGallery() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      const insp = currentInspection();
      if (!insp) return;
      const step = insp.activeSteps[insp.currentStep];
      if (!step) return;

      toast('Se procesează imaginea…', 'info');
      try {
        const raw = await Camera.fileToCanvas(file);
        const cropped = await processAndSave(raw, { step, insp, source: 'import', watermark: buildWatermark(true) });
        if (!cropped) toast('Fotografie importată și marcată.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    input.click();
  }

  /* Detectează documentul (dacă există), decupează automat, aplică watermark-ul
     și salvează. Poza originală se păstrează pentru ajustarea manuală a colțurilor.
     Returnează true dacă s-a decupat un document. */
  async function processAndSave(raw, { step, insp, source, watermark }) {
    let quad = null;
    let finalCanvas = raw;
    try {
      // Așteptăm OpenCV doar puțin — dacă nu e gata, poza rămâne întreagă
      if (await DocScan.waitReady(DOCSCAN_WAIT_MS)) {
        quad = await DocScan.detect(raw);
        const warped = quad && await DocScan.warp(raw, quad);
        if (warped) finalCanvas = warped;
        else quad = null;
      }
    } catch (err) {
      console.warn('[docscan]', err);
      quad = null;
      finalCanvas = raw;
    }

    const [blob, originalBlob] = await Promise.all([
      Camera.finalize(finalCanvas, watermark),
      Camera.canvasToBlob(raw).catch(() => null),
    ]);

    await savePhoto({ step: step.id, blob, source, originalBlob, quad, autoQuad: quad, watermark }, insp);

    // Afișăm rezultatul doar dacă inspectorul e încă la aceeași etapă
    if (currentInspection() === insp && insp.activeSteps[insp.currentStep] === step) {
      showPreview(blob);
      renderPhotoStrip();
      if (quad) toast('Document detectat și decupat automat.', 'success');
    }
    return !!quad;
  }

  function buildWatermark(isImport = false) {
    return {
      datetime: formatDateTime(new Date()),
      isImport,
    };
  }

  function blobToDataUrl(blob) {
    return new Promise(resolve => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  }

  async function savePhoto(data, inspRef) {
    const insp = inspRef || currentInspection();
    if (!insp) return;
    const dataUrl = await blobToDataUrl(data.blob);
    const photo = {
      step:         data.step,
      blob:         data.blob,
      baseBlob:     data.blob,
      dataUrl,           // URL stabil — nu dispare după sleep iOS
      source:       data.source,
      note:         '',
      timestamp:    new Date().toISOString(),
      // Decupare document — originalul (fără watermark) permite reajustarea colțurilor
      originalBlob: data.originalBlob || null,
      quad:         data.quad || null,
      autoQuad:     data.autoQuad || null,
      watermark:    data.watermark || null,
    };

    const idx = insp.photos.findIndex(p => p.step === data.step);
    if (idx >= 0) {
      insp.photos[idx] = photo;
    } else {
      insp.photos.push(photo);
    }

    // F2: persistăm în IndexedDB după fiecare poză (supraviețuiește sleep)
    Storage.saveActivePlate(insp).catch(() => {});
  }

  /* ---- note modal ---- */
  function openNoteModal() {
    const insp  = currentInspection();
    const step  = insp.activeSteps[insp.currentStep];
    const photo = insp.photos.find(p => p.step === step.id && !p.uploaded);

    if (!photo) { toast('Faceți mai întâi o fotografie.', 'error'); return; }

    document.getElementById('note-textarea').value = photo.note || '';
    document.getElementById('note-modal').classList.add('open');
    setTimeout(() => document.getElementById('note-textarea').focus(), 300);
  }

  function closeNoteModal() {
    document.getElementById('note-modal').classList.remove('open');
  }

  async function saveNote() {
    const text  = document.getElementById('note-textarea').value.trim();
    const insp  = currentInspection();
    const step  = insp.activeSteps[insp.currentStep];
    const photo = insp.photos.find(p => p.step === step.id && !p.uploaded);
    if (!photo) { closeNoteModal(); return; }

    closeNoteModal();

    try {
      photo.blob = await Camera.applyNote(photo.baseBlob, text);
      photo.note = text;
      photo.dataUrl = await blobToDataUrl(photo.blob);
      // Persistăm — altfel notița se pierde dacă iOS reîncarcă pagina
      Storage.saveActivePlate(insp).catch(() => {});
      updateNoteIndicator(text);
      showPreview(photo.blob);
      toast(text ? 'Notiță salvată și aplicată pe fotografie.' : 'Notiță ștearsă.', 'success');
    } catch (err) {
      toast('Eroare la aplicarea notiței: ' + err.message, 'error');
    }
  }

  function updateNoteIndicator(text) {
    const el = document.getElementById('note-indicator');
    if (text) {
      el.textContent = text.substring(0, 30) + (text.length > 30 ? '…' : '');
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  /* ---- preview / retake ---- */
  function showPreview(blob) {
    const url = URL.createObjectURL(blob);
    document.getElementById('preview-img').src = url;
    document.getElementById('camera-video').classList.add('hidden');
    document.getElementById('camera-fallback').classList.add('hidden');
    document.getElementById('preview-img').classList.remove('hidden');
    document.getElementById('capture-controls').classList.add('hidden');
    document.getElementById('preview-controls').classList.remove('hidden');
    updateCropButton();
  }

  function hidePreview() {
    document.getElementById('preview-img').classList.add('hidden');
    document.getElementById('camera-video').classList.remove('hidden');
    document.getElementById('capture-controls').classList.remove('hidden');
    document.getElementById('preview-controls').classList.add('hidden');
    updateCropButton();
  }

  function retakePhoto() {
    hidePreview();
    if (cameraMode === 'fileinput') {
      const captureBtn = document.querySelector('.btn-capture');
      if (captureBtn) captureBtn.onclick = captureViaFileInput;
      captureViaFileInput();
    } else {
      ensureCameraRunning();
    }
  }

  /* ============================================================
     Decupare document — ajustare manuală a colțurilor
     ============================================================ */
  const crop = {
    photo:   null,  // fotografia editată
    insp:    null,
    src:     null,  // canvas cu poza originală (fără watermark)
    quad:    null,  // 4 colțuri în coordonatele imaginii: tl, tr, br, bl
    scale:   1,     // px ecran / px imagine
    offX:    0,
    offY:    0,
    active:  -1,    // colțul tras acum
    grabDX:  0,
    grabDY:  0,
    pointer: null,
    raf:     0,
    busy:    false,
  };

  const HANDLE_R   = 13;   // raza colțului desenat (px CSS)
  const HANDLE_HIT = 44;   // zona de atingere în jurul colțului (px CSS)
  const LOUPE_R    = 58;   // lupa care arată colțul de sub deget
  const LOUPE_ZOOM = 2.5;

  function currentPhoto() {
    const insp = currentInspection();
    if (!insp) return null;
    const step = insp.activeSteps[insp.currentStep];
    return step ? insp.photos.find(p => p.step === step.id && !p.uploaded) || null : null;
  }

  /* După reload pe iOS, blob-urile din IndexedDB pot ieși goale */
  function hasOriginal(photo) {
    return photo.originalBlob instanceof Blob && photo.originalBlob.size > 0;
  }

  /* Butonul de decupare din previzualizare: apare doar când avem originalul */
  function updateCropButton() {
    const btn = document.getElementById('crop-btn');
    if (!btn) return;
    const previewVisible = !document.getElementById('preview-img').classList.contains('hidden');
    const photo = previewVisible ? currentPhoto() : null;
    if (!photo || !hasOriginal(photo) || !DocScan.isReady()) {
      btn.classList.add('hidden');
      return;
    }
    btn.textContent = photo.quad ? '✂ Ajustează decupajul' : '✂ Decupează document';
    btn.classList.toggle('crop-btn-active', !!photo.quad);
    btn.classList.remove('hidden');
  }

  function defaultQuad(w, h) {
    const mx = w * 0.1, my = h * 0.1;
    return [
      { x: mx,     y: my },
      { x: w - mx, y: my },
      { x: w - mx, y: h - my },
      { x: mx,     y: h - my },
    ];
  }

  async function openCropEditor() {
    const photo = currentPhoto();
    if (!photo || !hasOriginal(photo) || crop.busy) return;
    if (!DocScan.isReady()) { toast('Funcția de decupare încă se încarcă…', 'info'); return; }

    crop.busy = true;
    try {
      crop.src   = await Camera.fileToCanvas(photo.originalBlob);
      crop.photo = photo;
      crop.insp  = currentInspection();
      const w = crop.src.width, h = crop.src.height;
      // Fără decupaj automat: încercăm încă o dată detecția, altfel un cadru implicit
      const start = photo.quad || photo.autoQuad || await DocScan.detect(crop.src) || defaultQuad(w, h);
      crop.quad = start.map(p => ({ x: p.x, y: p.y }));
      crop.active = -1;

      document.getElementById('crop-editor').classList.add('open');
      layoutCropCanvas();
    } catch (err) {
      toast('Nu s-a putut deschide editorul: ' + err.message, 'error');
      closeCropEditor();
    } finally {
      crop.busy = false;
    }
  }

  function closeCropEditor() {
    document.getElementById('crop-editor').classList.remove('open');
    cancelAnimationFrame(crop.raf);
    crop.photo = crop.insp = crop.src = crop.quad = null;
    crop.active = -1;
    crop.pointer = null;
  }

  function layoutCropCanvas() {
    if (!crop.src) return;
    const canvas = document.getElementById('crop-canvas');
    const stage  = canvas.parentElement;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width  = cw + 'px';
    canvas.style.height = ch + 'px';

    // Margine ca să poată fi prinse și colțurile de la marginea pozei
    const pad = 28;
    const iw = crop.src.width, ih = crop.src.height;
    crop.scale = Math.min((cw - pad * 2) / iw, (ch - pad * 2) / ih);
    crop.offX = (cw - iw * crop.scale) / 2;
    crop.offY = (ch - ih * crop.scale) / 2;
    drawCrop();
  }

  function toScreen(p) {
    return { x: crop.offX + p.x * crop.scale, y: crop.offY + p.y * crop.scale };
  }

  function drawCrop() {
    const canvas = document.getElementById('crop-canvas');
    if (!crop.src || !canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const iw = crop.src.width * crop.scale, ih = crop.src.height * crop.scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(crop.src, crop.offX, crop.offY, iw, ih);

    const pts = crop.quad.map(toScreen);

    // Întunecăm tot ce rămâne în afara documentului
    ctx.beginPath();
    ctx.rect(crop.offX, crop.offY, iw, ih);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 3; i >= 1; i--) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill('evenodd');

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FF5F1F';
    ctx.stroke();

    pts.forEach((p, i) => {
      const r = i === crop.active ? HANDLE_R + 4 : HANDLE_R;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = i === crop.active ? 'rgba(255,95,31,0.35)' : 'rgba(255,255,255,0.25)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = i === crop.active ? '#FF5F1F' : '#FFFFFF';
      ctx.stroke();
    });

    if (crop.active >= 0) drawLoupe(ctx, cw, pts[crop.active]);
  }

  /* Lupă cu zona de sub deget — degetul acoperă colțul, lupa îl arată mărit */
  function drawLoupe(ctx, cw, p) {
    const margin = 14;
    const lx = p.x < cw / 2 ? cw - LOUPE_R - margin : LOUPE_R + margin;
    const ly = LOUPE_R + margin;
    const q = crop.quad[crop.active];
    const k = crop.scale * LOUPE_ZOOM;

    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.clip();
    // Desenăm toată poza mărită, centrată pe colț — fără sursă parțială în afara
    // imaginii (Safari vechi nu desenează nimic în acel caz)
    ctx.save();
    ctx.translate(lx, ly);
    ctx.scale(k, k);
    ctx.translate(-q.x, -q.y);
    ctx.drawImage(crop.src, 0, 0);
    ctx.restore();

    // Laturile care pleacă din colț, desenate și în lupă
    const toLoupe = pt => ({ x: lx + (pt.x - q.x) * k, y: ly + (pt.y - q.y) * k });
    const prev = toLoupe(crop.quad[(crop.active + 3) % 4]);
    const next = toLoupe(crop.quad[(crop.active + 1) % 4]);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(lx, ly);
    ctx.lineTo(next.x, next.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FF5F1F';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly);
    ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  }

  function scheduleCropDraw() {
    cancelAnimationFrame(crop.raf);
    crop.raf = requestAnimationFrame(drawCrop);
  }

  function cropPointerPos(e) {
    const rect = document.getElementById('crop-canvas').getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onCropPointerDown(e) {
    if (!crop.quad || crop.pointer !== null) return;
    const pos = cropPointerPos(e);
    let best = -1, bestD = Infinity;
    crop.quad.forEach((p, i) => {
      const s = toScreen(p);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > HANDLE_HIT) return;

    e.preventDefault();
    const s = toScreen(crop.quad[best]);
    crop.active = best;
    crop.grabDX = s.x - pos.x;   // colțul nu „sare” sub deget
    crop.grabDY = s.y - pos.y;
    crop.pointer = e.pointerId;
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    scheduleCropDraw();
  }

  function onCropPointerMove(e) {
    if (e.pointerId !== crop.pointer || crop.active < 0) return;
    e.preventDefault();
    const pos = cropPointerPos(e);
    const x = (pos.x + crop.grabDX - crop.offX) / crop.scale;
    const y = (pos.y + crop.grabDY - crop.offY) / crop.scale;
    crop.quad[crop.active] = {
      x: Math.max(0, Math.min(crop.src.width,  x)),
      y: Math.max(0, Math.min(crop.src.height, y)),
    };
    scheduleCropDraw();
  }

  function onCropPointerUp(e) {
    if (e.pointerId !== crop.pointer) return;
    crop.pointer = null;
    crop.active = -1;
    scheduleCropDraw();
  }

  async function resetCrop() {
    const src = crop.src;
    if (!src || crop.busy) return;
    crop.busy = true;
    try {
      const q = (crop.photo && crop.photo.autoQuad) || await DocScan.detect(src) || defaultQuad(src.width, src.height);
      if (crop.src !== src) return; // editorul s-a închis între timp
      crop.quad = q.map(p => ({ x: p.x, y: p.y }));
      scheduleCropDraw();
    } finally {
      crop.busy = false;
    }
  }

  /* Salvează noua variantă a fotografiei (decupată sau întreagă) */
  async function commitCrop(useQuad) {
    const photo = crop.photo, insp = crop.insp, src = crop.src;
    if (!photo || !src || crop.busy) return;

    let quad = null;
    let canvas = src;
    if (useQuad) {
      quad = DocScan.orderCorners(crop.quad);
      if (!quad || !DocScan.isConvexQuad(quad) || DocScan.polygonArea(quad) < src.width * src.height * 0.02) {
        toast('Colțurile nu formează un document valid. Ajustați-le din nou.', 'error');
        return;
      }
    }

    crop.busy = true;
    try {
      if (useQuad) {
        canvas = await DocScan.warp(src, quad);
        if (crop.photo !== photo) return;  // editorul a fost închis între timp
        if (!canvas) { toast('Decuparea a eșuat. Încercați din nou.', 'error'); return; }
      }
      const watermark = photo.watermark || buildWatermark(photo.source === 'import');
      const base = await Camera.finalize(canvas, watermark);
      const finalBlob = photo.note ? await Camera.applyNote(base, photo.note) : base;

      photo.baseBlob = base;
      photo.blob     = finalBlob;
      photo.dataUrl  = await blobToDataUrl(finalBlob);
      photo.quad     = quad;
      Storage.saveActivePlate(insp).catch(() => {});

      closeCropEditor();
      if (currentPhoto() === photo) {
        showPreview(finalBlob);
        renderPhotoStrip();
      }
      toast(quad ? 'Decupaj aplicat.' : 'Se folosește fotografia întreagă.', 'success');
    } catch (err) {
      toast('Eroare la salvare: ' + err.message, 'error');
    } finally {
      crop.busy = false;
    }
  }

  function applyCrop()  { commitCrop(true); }
  function removeCrop() { commitCrop(false); }

  function initCropEditor() {
    const canvas = document.getElementById('crop-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown',   onCropPointerDown);
    canvas.addEventListener('pointermove',   onCropPointerMove);
    canvas.addEventListener('pointerup',     onCropPointerUp);
    canvas.addEventListener('pointercancel', onCropPointerUp);
    window.addEventListener('resize', () => {
      if (document.getElementById('crop-editor').classList.contains('open')) layoutCropCanvas();
    });
  }

  /* Încărcăm OpenCV în fundal, ca să fie gata până la prima poză */
  function preloadDocScan() {
    setTimeout(() => {
      DocScan.load().then(ok => { if (ok) updateCropButton(); });
    }, 1500);
  }

  async function cancelCase(plate) {
    if (!confirm(`Anulezi cazul ${plate}? Pozele făcute vor fi șterse.`)) return;
    const insp = state.activePlates.get(plate);
    if (insp) await Storage.deleteActivePlate(insp.id).catch(() => {});
    state.activePlates.delete(plate);
    renderActivePlates();
  }

  async function cancelCurrentCase() {
    const plate = state.currentPlate;
    if (!plate) return;
    if (!confirm(`Anulezi cazul ${plate}? Pozele făcute vor fi șterse.`)) return;
    Camera.stop();
    cameraRunning = false;
    cameraMode = 'none';
    const insp = state.activePlates.get(plate);
    if (insp) await Storage.deleteActivePlate(insp.id).catch(() => {});
    state.activePlates.delete(plate);
    state.currentPlate = null;
    goHome();
  }

  async function deleteInspection(id, status) {
    if (status === 'pending') {
      if (!confirm('Ștergi această inspecție din coada de trimitere? Nu va mai fi trimisă la calculator.')) return;
      await Storage.deletePending(id).catch(() => {});
    } else {
      if (!confirm('Ascunzi această inspecție din lista de azi?')) return;
      if (id) hiddenInspectionIds.add(id);
    }
    goHome();
  }

  async function editPlate(oldPlate) {
    const raw = prompt(`Modifică numărul de înmatriculare:\n(${oldPlate})`, oldPlate);
    if (!raw || !raw.trim()) return;
    const newPlate = formatPlate(raw.trim());
    if (!newPlate || newPlate === oldPlate) return;
    if (state.activePlates.has(newPlate)) {
      toast('Există deja un caz deschis cu acest număr.', 'error');
      return;
    }
    const insp = state.activePlates.get(oldPlate);
    if (!insp) return;
    insp.plate = newPlate;
    state.activePlates.delete(oldPlate);
    state.activePlates.set(newPlate, insp);
    await Storage.saveActivePlate(insp).catch(() => {});
    renderActivePlates();
  }

  function finalizeEarly() {
    const insp = currentInspection();
    if (insp.photos.filter(p => !p.uploaded).length === 0) {
      toast('Faceți cel puțin o fotografie înainte de a finaliza.', 'error');
      return;
    }
    Camera.stop();
    cameraRunning = false;
    cameraMode = 'none';
    showConfirm();
  }

  function nextStep() {
    const insp = currentInspection();
    const step = insp.activeSteps[insp.currentStep];
    const hasPhoto = insp.photos.some(p => p.step === step.id);
    if (!hasPhoto) { toast('Faceți o fotografie înainte de a continua.', 'error'); return; }

    const next = insp.currentStep + 1;
    if (next >= insp.activeSteps.length) {
      Camera.stop();
      cameraRunning = false;
      cameraMode = 'none';
      showConfirm();
    } else {
      startStep(next);
    }
  }

  function prevStep() {
    Camera.stop();
    cameraRunning = false;
    cameraMode = 'none';

    const insp = currentInspection();
    // Dacă nu s-a făcut nicio poză reală (nu placeholder), nu lăsa cazul deschis
    if (insp && insp.photos.filter(p => !p.uploaded).length === 0) {
      Storage.deleteActivePlate(insp.id).catch(() => {});
      state.activePlates.delete(state.currentPlate);
    }
    state.currentPlate = null;
    goHome();
  }

  /* ============================================================
     Confirmation screen
     ============================================================ */
  function showConfirm() {
    const insp = currentInspection();
    document.getElementById('confirm-plate').value = insp.plate;
    document.getElementById('confirm-notes').value = insp.notes;

    const btn = document.getElementById('submit-btn');
    btn.disabled = false;
    btn.textContent = 'Trimite la calculator';

    const grid = document.getElementById('photos-grid');
    grid.innerHTML = '';

    const realPhotos = insp.photos.filter(p => !p.uploaded);
    realPhotos.forEach(photo => {
      const stepIdx = insp.activeSteps.findIndex(s => s.id === photo.step);
      const label = stepIdx >= 0 ? `Etapa ${stepIdx + 1}` : photo.step;
      const url = photo.dataUrl || URL.createObjectURL(photo.blob);
      const div = document.createElement('div');
      div.className = 'photo-thumb';
      div.innerHTML = `
        <img src="${url}" alt="${escHtml(label)}">
        <span class="photo-thumb-label">${escHtml(label)}</span>
      `;
      grid.appendChild(div);
    });

    const countEl = document.getElementById('photos-count-label');
    if (countEl) countEl.textContent = `Fotografii (${realPhotos.length})`;

    show('screen-confirm');
  }

  function backToCamera() {
    const insp = currentInspection();
    startStep(insp.activeSteps.length - 1);
  }

  async function submitInspection() {
    const insp = currentInspection();
    const plate = formatPlate(document.getElementById('confirm-plate').value);
    if (!plate) { toast('Introduceți numărul de înmatriculare.', 'error'); return; }

    insp.plate = plate;
    insp.notes = document.getElementById('confirm-notes').value.trim();

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Se trimite…';

    const payload = {
      id:           insp.id,
      plate:        insp.plate,
      inspector_id: state.inspector.id,
      datetime:     new Date().toISOString(),
      notes:        insp.notes,
      device_id:    getDeviceId(),
      photos:       insp.photos.filter(p => !p.uploaded).map(p => ({
        step:      p.step,
        blob:      p.blob,
        dataUrl:   p.dataUrl   || null,
        source:    p.source,
        note:      p.note,
        timestamp: p.timestamp,
      })),
    };

    const plateKey = state.currentPlate;
    const appendId = insp.appendToInspectionId || null;

    // Includem appendToInspectionId în payload — necesar dacă ajunge în pending queue
    if (appendId) payload.appendToInspectionId = appendId;

    function cleanup() {
      Storage.deleteActivePlate(insp.id).catch(() => {});
      state.activePlates.delete(plateKey);
      state.currentPlate = null;
    }

    try {
      let result;
      if (appendId) {
        result = await Sync.uploadAdditionalPhotos(appendId, payload);
      } else {
        result = await Sync.uploadInspection(payload);
      }
      // Salvăm ID-ul serverului pentru a detecta duplicate la aceeași placă azi
      if (result.inspection?.id) {
        const today = new Date().toISOString().slice(0, 10);
        let totalSaved;
        if (appendId) {
          // Total cumulativ: poze anterioare + poze adăugate acum
          let prevSaved = 0;
          try {
            const completed = await Storage.getCompletedPlates();
            const existing = completed.find(c => c.id === appendId);
            prevSaved = existing?.photos_saved || 0;
          } catch {}
          totalSaved = prevSaved + (result.inspection.photos_added || 0);
          Storage.saveCompletedPlate({
            id: appendId, plate: payload.plate, date: today, photos_saved: totalSaved,
          }).catch(() => {});
          result = { ...result, inspection: { ...result.inspection, photos_saved: totalSaved } };
        } else {
          totalSaved = result.inspection.photos_saved ?? 0;
          Storage.saveCompletedPlate({
            id: result.inspection.id, plate: payload.plate, date: today, photos_saved: totalSaved,
          }).catch(() => {});
        }
      }
      cleanup();
      showSuccess(result.inspection, false);
    } catch {
      try {
        await Storage.savePending(payload);
        cleanup();
        showSuccess({ plate: payload.plate, photos_saved: payload.photos.length }, true);
      } catch (saveErr) {
        toast('Eroare la salvarea locală: ' + saveErr.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Trimite la calculator';
      }
    }
  }

  /* ============================================================
     Success screen
     ============================================================ */
  function showSuccess(inspection, isOffline = false) {
    document.getElementById('success-plate').textContent = inspection.plate;
    document.getElementById('success-photos').textContent = (inspection.photos_saved ?? inspection.photos?.length ?? '—') + ' fotografii';

    const svgCheck = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="46" height="46"><polyline points="20 6 9 17 4 12"/></svg>`;
    const svgDown  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="46" height="46"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;

    if (isOffline) {
      document.getElementById('success-icon').innerHTML       = svgDown;
      document.getElementById('success-title').textContent    = 'Salvat local';
      document.getElementById('success-subtitle').textContent = 'Serverul nu e disponibil. Se va sincroniza automat la reconectare.';
      document.getElementById('success-folder').textContent   = '— (va fi creat la sincronizare)';
    } else {
      document.getElementById('success-icon').innerHTML       = svgCheck;
      document.getElementById('success-title').textContent    = 'Salvat!';
      document.getElementById('success-subtitle').textContent = 'Inspecția a fost trimisă la calculator.';
      document.getElementById('success-folder').textContent   = inspection.folder_path || '—';
    }

    // F3: buton "Adaugă poze" — vizibil doar când nu e offline
    const addMoreBtn = document.getElementById('success-add-more');
    if (addMoreBtn) {
      addMoreBtn.dataset.plate        = inspection.plate        || '';
      addMoreBtn.dataset.inspectionId = inspection.id          || '';
      addMoreBtn.dataset.photoCount   = inspection.photos_saved ?? inspection.photos_added ?? 0;
      addMoreBtn.style.display = isOffline ? 'none' : '';
    }

    show('screen-success');
  }

  /* ============================================================
     Photo viewer — vizualizare fotografii inspecție finalizată
     ============================================================ */
  async function viewInspection(id, plate, datetime) {
    const modal = document.getElementById('photo-viewer-modal');
    const grid  = document.getElementById('pv-grid');
    const title = document.getElementById('pv-plate');
    const meta  = document.getElementById('pv-meta');

    title.textContent = plate;
    meta.textContent  = new Date(datetime).toLocaleString('ro-RO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    grid.innerHTML = '<div class="pv-loading">Se încarcă…</div>';
    modal.classList.add('open');

    try {
      const data = await Sync.fetchInspection(id);
      const photos = data.inspection?.photos || [];
      if (photos.length === 0) {
        grid.innerHTML = '<div class="pv-loading">Nicio fotografie.</div>';
        return;
      }
      grid.innerHTML = photos.map((p, i) => `
        <div class="pv-thumb" onclick="App.openLightbox('${escHtml(id)}','${escHtml(p.filename)}')">
          <img src="/api/inspections/${escHtml(id)}/photo/${escHtml(p.filename)}" loading="lazy" alt="Etapa ${i+1}">
          <div class="pv-label">Etapa ${i + 1}</div>
        </div>
      `).join('');
    } catch {
      grid.innerHTML = '<div class="pv-loading">Eroare la încărcare.</div>';
    }
  }

  function closePhotoViewer() {
    document.getElementById('photo-viewer-modal').classList.remove('open');
    closeLightbox();
  }

  function openLightbox(inspId, filename) {
    const lb  = document.getElementById('pv-lightbox');
    const img = document.getElementById('pv-lightbox-img');
    img.src = `/api/inspections/${inspId}/photo/${filename}`;
    lb.classList.add('open');
  }

  function closeLightbox() {
    const lb = document.getElementById('pv-lightbox');
    if (lb) lb.classList.remove('open');
  }

  /* F3: Redeschide o inspecție finalizată pentru a adăuga poze suplimentare */
  function reopenForMorePhotos(plate, inspectionId, photoCount) {
    if (!plate) return;
    const activeSteps = getActiveSteps();
    const prevCount   = Math.min(parseInt(photoCount) || 0, activeSteps.length);
    const startIdx    = Math.min(prevCount, activeSteps.length - 1);

    if (state.activePlates.has(plate)) {
      const insp = state.activePlates.get(plate);
      if (inspectionId) insp.appendToInspectionId = inspectionId;
      resumePlate(plate);
      return;
    }

    // Placeholder-e pentru pozele deja încărcate pe server — le afișăm în strip
    const prevPhotos = activeSteps.slice(0, prevCount).map(step => ({
      step:     step.id,
      uploaded: true,
      dataUrl:  null,
      blob:     null,
    }));

    const insp = {
      id:                   generateId(),
      plate:                plate,
      notes:                '',
      photos:               prevPhotos,
      currentStep:          startIdx,
      activeSteps:          activeSteps,
      appendToInspectionId: inspectionId || null,
    };
    state.activePlates.set(plate, insp);
    state.currentPlate = plate;
    Storage.saveActivePlate(insp).catch(() => {});
    startStep(startIdx);
  }

  /* ============================================================
     Offline sync
     ============================================================ */
  async function syncPending() {
    let pending;
    try { pending = await Storage.getPending(); } catch { return; }
    if (pending.length === 0) return;

    for (const inspection of pending) {
      try {
        let result;
        if (inspection.appendToInspectionId) {
          result = await Sync.uploadAdditionalPhotos(inspection.appendToInspectionId, inspection);
        } else {
          result = await Sync.uploadInspection(inspection);
        }
        await Storage.deletePending(inspection.id);
        // Salvăm în completed_plates și la sync, nu doar la submit direct
        if (result?.inspection?.id) {
          const today = new Date().toISOString().slice(0, 10);
          if (inspection.appendToInspectionId) {
            let prevSaved = 0;
            try {
              const completed = await Storage.getCompletedPlates();
              const existing = completed.find(c => c.id === inspection.appendToInspectionId);
              prevSaved = existing?.photos_saved || 0;
            } catch {}
            Storage.saveCompletedPlate({
              id: inspection.appendToInspectionId, plate: inspection.plate, date: today,
              photos_saved: prevSaved + (result.inspection.photos_added || 0),
            }).catch(() => {});
          } else {
            Storage.saveCompletedPlate({
              id: result.inspection.id, plate: inspection.plate, date: today,
              photos_saved: result.inspection.photos_saved ?? 0,
            }).catch(() => {});
          }
        }
        toast(`${inspection.plate} — sincronizat cu serverul.`, 'success');
      } catch {
        // Still unreachable; will retry next cycle
      }
    }
  }

  function startSyncLoop() {
    window.addEventListener('online', syncPending);
    setInterval(syncPending, 30_000);
  }

  /* ============================================================
     Offline screen
     ============================================================ */
  let retryTimer = null;

  function showOffline() {
    show('screen-error');
    document.getElementById('error-message').textContent =
      'Asigurați-vă că PC-ul cu serverul InspectorCam este pornit și că sunteți conectat la același Wi-Fi.';
    scheduleRetry();
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    let seconds = 5;
    const btn = document.querySelector('#screen-error .btn-primary');
    if (btn) btn.textContent = `Reîncearcă (${seconds}s)`;
    retryTimer = setInterval(() => {
      seconds--;
      if (btn) btn.textContent = `Reîncearcă (${seconds}s)`;
      if (seconds <= 0) {
        clearInterval(retryTimer);
        retryConnection();
      }
    }, 1000);
  }

  /* ============================================================
     Error screen
     ============================================================ */
  function showError(message) {
    clearTimeout(retryTimer);
    document.getElementById('error-message').textContent = message;
    show('screen-error');
  }

  async function retryConnection() {
    clearInterval(retryTimer);
    await init();
  }

  /* ============================================================
     Toast
     ============================================================ */
  let toastTimer = null;
  function toast(message, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast toast-${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  /* ============================================================
     Utilities
     ============================================================ */
  function formatDateTime(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getDeviceId() {
    let id = localStorage.getItem('itp-device-id');
    if (!id) {
      id = 'phone-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('itp-device-id', id);
    }
    return id;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ============================================================
     Public API (called from HTML onclick attributes)
     ============================================================ */
  return {
    init,
    logout,
    goHome,
    startNewInspection,
    confirmPlate,
    resumePlate,
    capturePhoto,
    importFromGallery,
    openNoteModal,
    closeNoteModal,
    saveNote,
    retakePhoto,
    nextStep,
    prevStep,
    backToCamera,
    submitInspection,
    showSuccess,
    retryConnection,
    finalizeEarly,
    cancelCase,
    cancelCurrentCase,
    deleteInspection,
    editPlate,
    startCapture,
    formatPlateInput,
    reopenForMorePhotos,
    viewInspection,
    closePhotoViewer,
    openLightbox,
    closeLightbox,
    openCropEditor,
    closeCropEditor,
    applyCrop,
    removeCrop,
    resetCrop,
  };
})();

window.addEventListener('DOMContentLoaded', () => App.init());
