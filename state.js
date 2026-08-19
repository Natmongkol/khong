// ===== state.js: ค่าคงที่, INSTRUMENTS, state object, undo/redo, save system =====

// --- Instrument Configuration ---
const INSTRUMENTS = {
    kwy: {
        id: 'kwy',
        name: 'ฆ้องวงใหญ่',
        numGongs: 16,
        freqs: [274, 303, 335, 369, 408, 450, 497, 549, 606, 669, 738, 815, 900, 994, 1097, 1211],
        base: ['ม','ฟ','ซ','ล','ท','ด','ร','ม','ฟ','ซ','ล','ท','ด','ร','ม','ฟ'],
        display: ['มฺ','ฟฺ','ซฺ','ลฺ','ทฺ','ด','ร','ม','ฟ','ซ','ล','ท','ดํ','รํ','มํ','ฟํ'],
        getNoteRange: (idx) => {
            if (idx <= 4) return 'low';
            if (idx >= 12) return 'high';
            return 'mid';
        }
    },
    kmwy: {
        id: 'kmwy',
        name: 'ฆ้องมอญวงใหญ่',
        numGongs: 15,
        freqs: [342.0, 377.0, 460.0, 508.0, 561.0, 684.0, 755.0, 834.0, 921.0, 1017.0, 1123.0, 1239.0, 1368.0, 1511.0, 1668.0],
        base: ['ซ','ล','ด','ร','ม','ซ','ล','ท','ด','ร','ม','ฟ','ซ','ล','ท'], 
        display: ['ซฺ','ลฺ','ด','ร','ม','ซ','ล','ท','ดํ','รํ','มํ','ฟํ','ซํ','ลํ','ทํ'], 
        getNoteRange: (idx) => {
            if (idx <= 1) return 'low';
            if (idx >= 8) return 'high';
            return 'mid';
        },
        octaveMapUp: {0:5, 1:6, 2:8, 3:9, 4:10, 5:12, 6:13, 7:14},
        octaveMapDown: {5:0, 6:1, 8:2, 9:3, 10:4, 12:5, 13:6, 14:7}
    },
    ranatek: {
        id: 'ranatek',
        name: 'ระนาดเอก',
        numGongs: 22,
        freqs: [171.1, 188.9, 208.5, 230.3, 254.2, 280.7, 309.9, 342.2, 377.8, 417.2, 460.6, 508.5, 561.5, 619.9, 684.4, 755.7, 834.4, 921.2, 1017.1, 1123.0, 1239.9, 1368.9],
        base: ['ซ','ล','ท','ด','ร','ม','ฟ','ซ','ล','ท','ด','ร','ม','ฟ','ซ','ล','ท','ด','ร','ม','ฟ','ซ'],
        display: ['ซฺฺ','ลฺฺ','ทฺฺ','ดฺ','รฺ','มฺ','ฟฺ','ซฺ','ลฺ','ทฺ','ด','ร','ม','ฟ','ซ','ล','ท','ดํ','รํ','มํ','ฟํ','ซํ'],
        // ผังปุ่มลัดคีย์บอร์ด เฉพาะระนาดเอก (ไม่ใช้ CODE_MAP_MASTER ทั่วไปแบบฆ้อง เพราะเรียงคีย์ต่างกัน)
        keyLabels: ['Z','X','C','V','B','N','M',',','.','/','A','S','D','F','G','H','J','Q','W','E','R','T'],
        keyCodes: ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash','KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyQ','KeyW','KeyE','KeyR','KeyT'],
        getNoteRange: (idx) => {
            if (idx <= 9) return 'low';
            if (idx <= 16) return 'mid';
            return 'high';
        }
    },
    khluy: {
        id: 'khluy',
        name: 'ขลุ่ยเพียงออ',
        numGongs: 8,
        freqs: [450, 497, 549, 606, 669, 738, 815, 900],
        base: ['ด','ร','ม','ฟ','ซ','ล','ท','ด'],
        display: ['ด','ร','ม','ฟ','ซ','ล','ท','ดํ'],
        // ขลุ่ยเพียงออ: บันทึกได้แค่มือเดียว และไม่มีรูปเครื่องดนตรีให้แสดง (ดู applyInstrumentUIConstraints)
        oneHandOnly: true,
        noImage: true,
        getNoteRange: (idx) => (idx === 7 ? 'high' : 'mid')
    }
};

let currentInstrument = 'kwy';

// ── ข้อจำกัด UI เฉพาะเครื่อง (เช่น ขลุ่ยเพียงออ: ไม่มีรูปเครื่องดนตรี + บันทึกได้แค่มือเดียว) ──
// ใช้ร่วมกันทั้งตอนสลับเครื่องปกติ (switchInstrument) และตอนโหลด/นำเข้าไฟล์ (restoreProjectData ใน io.js)
function applyInstrumentUIConstraints(instId) {
  const inst = INSTRUMENTS[instId];
  const noImage = !!(inst && inst.noImage);

  const instPanel = document.getElementById('instrumentPanel');
  if (instPanel) instPanel.style.display = noImage ? 'none' : '';

  const recordModeRow = document.getElementById('recordModeRow');
  if (recordModeRow) recordModeRow.style.display = (inst && inst.oneHandOnly) ? 'none' : '';

  if (inst && inst.oneHandOnly && state.recordMode !== 'one') {
    setRecordMode('one');
  }
}

function getActiveInst() { return INSTRUMENTS[currentInstrument]; }
function noteRange(idx) { return getActiveInst().getNoteRange(idx); }
function noteText(idx) { return getActiveInst().display[idx]; }
function noteBaseText(idx) { return getActiveInst().base[idx]; }
function noteHTML(idx) { return `<span class="nn nn-${noteRange(idx)}">${noteBaseText(idx)}</span>`; }

function switchInstrument(instId) {
    if (instId === currentInstrument) return;
    
    currentInstrument = instId;
    
    // UI Update Dropdown
    const sel = document.getElementById('instSelect');
    if (sel && sel.value !== instId) sel.value = instId;
    
    document.getElementById('instPanelTitle').textContent = `${getActiveInst().name} · ${getActiveInst().numGongs} ลูก`;
    document.getElementById('notationSubtitle').textContent = `ทาง${getActiveInst().name}`;
    const qnavTip = document.getElementById('qnavTooltip');
    if (qnavTip) qnavTip.textContent = `ไปดู${getActiveInst().name}`;
    
    // ปุ่มทัชคีย์บอร์ด สลับตามเครื่องที่เลือก
    document.getElementById('kb-kwy').style.display = (instId === 'kwy') ? 'block' : 'none';
    document.getElementById('kb-kmwy').style.display = (instId === 'kmwy') ? 'block' : 'none';
    document.getElementById('kb-ranatek').style.display = (instId === 'ranatek') ? 'block' : 'none';
    document.getElementById('kb-khluy').style.display = (instId === 'khluy') ? 'block' : 'none';

    applyInstrumentUIConstraints(instId);

    // เริ่มโหลดเสียงขลุ่ยจริงล่วงหน้า เพื่อให้พร้อมทันทีที่กดเล่นโน้ตแรก
    if (instId === 'khluy' && typeof ensureKhluySamples === 'function') {
      ensureKhluySamples().catch((error) => {
        console.error('โหลดเสียงขลุ่ยไม่สำเร็จ:', error);
        showToast('โหลดเสียงขลุ่ยไม่สำเร็จ โปรดตรวจสอบไฟล์เสียง', 'error');
      });
    }

    updatePageTitle();
    renderNotation();
    renderImeInfographic();
    renderGongs(); // วาดลูกฆ้องใหม่เสมอ ไม่ว่าจะเลือกวงใด
    scheduleAutosave();
}

let pendingInstrument = null;

// Attach Event Listeners to Instrument Dropdown
document.getElementById('instSelect').addEventListener('change', (e) => {
    const targetInst = e.target.value;
    if (targetInst === currentInstrument) return;
    
    const hasNotes = state.notes.right.some(n => n !== null) || state.notes.left.some(n => n !== null);
    if (hasNotes) {
        pendingInstrument = targetInst;
        document.getElementById('switchInstModal').classList.add('show');
        e.target.value = currentInstrument; // Revert visually until confirmed
    } else {
        switchInstrument(targetInst);
    }
});

// ── โหมดบันทึกโน้ต: "มือเดียว" (one) ตัดแถว/ข้อมูลมือซ้ายออกจริง vs "สองมือ" (two) พฤติกรรมเดิม ──
let pendingRecordMode = null;

function applyRecordModeUI(mode) {
  const sel = document.getElementById('recordModeSelect');
  if (sel && sel.value !== mode) sel.value = mode;
  // ซ่อนปุ่มลัด Tab/Shift/↑/↓ (เดิมใช้จับคู่โน้ต 2 มือ) เพราะไม่มีความหมายในโหมดมือเดียว
  const modRow = document.getElementById('tkModifierRow');
  if (modRow) modRow.style.display = (mode === 'one') ? 'none' : '';
}

// ใช้ผลของการเปลี่ยนโหมดจริง (ไม่มีการถาม confirm ที่นี่ — เรียกหลังยืนยันแล้ว หรือตอนโหลด/undo/import)
function setRecordMode(mode) {
  state.recordMode = mode;
  if (mode === 'one') {
    // ตัดระบบมือซ้ายออกจริง ไม่ใช่แค่ซ่อนด้วย CSS: เคลียร์ข้อมูลโน้ตมือซ้ายทั้งหมด
    state.notes.left.fill(null);
    state.hand = 'right';
    // ยกเลิกปุ่มลัดจับคู่มือที่อาจค้างอยู่ (Tab/Shift/↑/↓)
    if (typeof tabHeld !== 'undefined') { tabHeld = shiftHeld = arrowUpHeld = arrowDownHeld = false; }
  }
  applyRecordModeUI(mode);
  renderNotation();
}

function switchRecordMode(mode) {
  if (mode === state.recordMode) return;
  const hasLeftNotes = state.notes.left.some(n => n !== null);
  if (mode === 'one' && hasLeftNotes) {
    pendingRecordMode = mode;
    document.getElementById('switchRecordModeModal').classList.add('show');
    const sel = document.getElementById('recordModeSelect');
    if (sel) sel.value = state.recordMode; // revert ตัวเลือกจนกว่าจะยืนยัน
  } else {
    pushUndo();
    setRecordMode(mode);
  }
}

document.getElementById('recordModeSelect').addEventListener('change', (e) => {
  switchRecordMode(e.target.value);
});

function updatePageTitle() {
  document.title = state.songName && state.songName.trim() !== '' 
    ? `${state.songName} — ${getActiveInst().name}` 
    : `โน้ตดนตรีไทย ทำนองหลัก`;
}



const BEATS_PER_BAR = 4;
const BARS_PER_VAK = 8;       
// ไม่มีเพดานจำนวนวรรคจากตัวแอปเอง; ขีดจำกัดจริงขึ้นกับหน่วยความจำของเบราว์เซอร์และเครื่องผู้ใช้
const MAX_VAKS = Number.MAX_SAFE_INTEGER;

const SECTION_TEMPO_RATES = {
  'sam-chan': 'สามชั้น',
  'song-chan': 'สองชั้น',
  'chan-diao': 'ชั้นเดียว'
};
const DEFAULT_SECTION_TEMPO_RATE = 'sam-chan';

function sectionTempoRateLabel(rate) {
  return SECTION_TEMPO_RATES[rate] || SECTION_TEMPO_RATES[DEFAULT_SECTION_TEMPO_RATE];
}

// หาอัตราจังหวะที่มีผล ณ บรรทัดนั้น: ใช้ค่าที่กำหนดล่าสุดก่อนหน้า
// หากยังไม่เคยกำหนดเลย ใช้สามชั้นเป็นค่าเริ่มต้นภายใน (โดยไม่แสดงป้ายกำกับ)
function effectiveSectionTempoRate(lineNum) {
  let rate = DEFAULT_SECTION_TEMPO_RATE;
  const changes = state.sectionTempoRates || {};
  Object.keys(changes).map(Number).sort((a, b) => a - b).forEach((line) => {
    if (line <= lineNum && SECTION_TEMPO_RATES[changes[line]]) rate = changes[line];
  });
  return rate;
}

const state = {
  songName: '', hand: 'right', bpm: 120, numBars: 8, cursorBeat: -1,
  isRecording: true, isPlaying: false, playStart: 0, currentBeat: -1,
  notes: { right: [], left: [] }, clipboardVak: null, repeats: {}, sections: {}, sectionTempoRates: {}, lineLengths: {},
  recordMode: 'two', // 'two' = สองมือ (default, พฤติกรรมเดิม) | 'one' = มือเดียว (ใช้เฉพาะแถว right)
  playMode: 'all', selectionHands: ['right', 'left'], _editingSection: null,
  isEditMode: false, isMultiSelectMode: false, selectedRooms: new Set(), currentPlayingLine: null,
  selectedLine: null,
  isMultiLineMode: false, selectedLines: new Set()
};

let lastTap = { time: 0, beat: -1, hand: '' };
let customClipboard = null;
let sectionLineMap = [];

const undoStack = [];
let redoStack = [];
const MAX_UNDO = 40;

// ── Undo/Redo: full-snapshot vs delta-snapshot ─────────────────────────────
// เดิม pushUndo() copy state.notes.right/left ทั้งอาเรย์ทุกครั้งที่กดโน้ต 1 ตัว แม้เพลงจะยาวมาก
// เก็บสูงสุด 40 ชุด (+อีก 40 ใน redoStack) → เพลงยาวหลายร้อยห้องจะกิน RAM มากเกินจำเป็นสำหรับการแก้ทีละช่อง
// วิธีแก้: แยกเป็น 2 แบบ
//  - "delta" snapshot: ใช้กับการแก้ทีละ 1-2 ช่อง (พิมพ์โน้ต/ลบ/หยุด — คือ action ที่เกิดถี่ที่สุดมาก)
//    เก็บแค่ {hand, idx, val เดิม} ของช่องที่กำลังจะเปลี่ยน แทนการ copy ทั้งอาเรย์
//  - "full" snapshot: ใช้กับ action ที่กระทบหลายช่อง/โครงสร้าง (แทรก/ลบ/ย้ายบรรทัด, เปลี่ยนเครื่องดนตรี,
//    นำเข้าไฟล์, วางหลายห้อง ฯลฯ) ซึ่งเกิดไม่บ่อยเท่า จึง copy ทั้งอาเรย์แบบเดิมไว้เพื่อความถูกต้อง/ปลอดภัยสูงสุด
function _snapMeta(includeDocument = false) {
  const meta = {
    instrument: currentInstrument, recordMode: state.recordMode,
    cursorBeat: state.cursorBeat, hand: state.hand, numBars: state.numBars,
    repeats: {...state.repeats}, sections: {...state.sections}, sectionTempoRates: {...state.sectionTempoRates}, lineLengths: {...state.lineLengths}
  };
  if (includeDocument) { meta.songName = state.songName; meta.bpm = state.bpm; }
  return meta;
}
function _makeFullSnapshot() {
  return { delta: false, right: [...state.notes.right], left: [...state.notes.left], ..._snapMeta(true) };
}
function _makeDeltaSnapshot(cellRefs) {
  // cellRefs: [{hand, idx}, ...] — จับค่า "ปัจจุบัน" ของช่องเหล่านี้ไว้ (ใช้ตอน apply กลับ)
  const cells = cellRefs.map(({ hand, idx }) => ({ hand, idx, val: state.notes[hand][idx] }));
  return { delta: true, cells, ..._snapMeta() };
}

function pushUndo(cellRefs = null) {
  const snap = (cellRefs && cellRefs.length) ? _makeDeltaSnapshot(cellRefs) : _makeFullSnapshot();
  undoStack.push(snap);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = []; 
  updateUndoUI();
  scheduleAutosave();
}

function performUndo() {
  if (undoStack.length === 0) return;
  if (chordTimer !== null) { clearTimeout(chordTimer); chordTimer = null; chordBuffer = { left: null, right: null }; }

  const snap = undoStack.pop();
  // สร้าง redo snapshot ให้ตรงชนิดกับ undo snapshot ที่กำลังจะ apply (เก็บค่าปัจจุบัน ก่อนโดน undo ทับ)
  const redoSnap = snap.delta ? _makeDeltaSnapshot(snap.cells) : _makeFullSnapshot();
  redoStack.push(redoSnap);
  if (redoStack.length > MAX_UNDO) redoStack.shift();

  restoreSnapshot(snap);
  updateUndoUI();
  showToast('ย้อนกลับ สำเร็จ');
}

function performRedo() {
  if (redoStack.length === 0) return;
  if (chordTimer !== null) { clearTimeout(chordTimer); chordTimer = null; chordBuffer = { left: null, right: null }; }

  const snap = redoStack.pop();
  const undoSnap = snap.delta ? _makeDeltaSnapshot(snap.cells) : _makeFullSnapshot();
  undoStack.push(undoSnap);
  if (undoStack.length > MAX_UNDO) undoStack.shift();

  restoreSnapshot(snap);
  updateUndoUI();
  showToast('ถัดไป สำเร็จ');
}

function restoreSnapshot(snap) {
  if (chordTimer !== null) { clearTimeout(chordTimer); chordTimer = null; chordBuffer = { left: null, right: null }; }
  if (snap.instrument && snap.instrument !== currentInstrument) {
      currentInstrument = snap.instrument;
      
      const sel = document.getElementById('instSelect');
      if (sel && sel.value !== snap.instrument) sel.value = snap.instrument;

      document.getElementById('instPanelTitle').textContent = `${getActiveInst().name} · ${getActiveInst().numGongs} ลูก`;
      document.getElementById('notationSubtitle').textContent = `ทาง${getActiveInst().name}`;
      
      document.getElementById('kb-kwy').style.display = (snap.instrument === 'kwy') ? 'block' : 'none';
      document.getElementById('kb-kmwy').style.display = (snap.instrument === 'kmwy') ? 'block' : 'none';
      document.getElementById('kb-ranatek').style.display = (snap.instrument === 'ranatek') ? 'block' : 'none';
      document.getElementById('kb-khluy').style.display = (snap.instrument === 'khluy') ? 'block' : 'none';
      applyInstrumentUIConstraints(snap.instrument);
      if (snap.instrument === 'khluy' && typeof ensureKhluySamples === 'function') {
        ensureKhluySamples().catch((error) => console.error('โหลดเสียงขลุ่ยไม่สำเร็จ:', error));
      }
      
      renderImeInfographic();
      renderGongs();
  }
  state.numBars = snap.numBars;
  document.getElementById('numVak').value = snap.numBars / BARS_PER_VAK;
  state.songName = typeof snap.songName === 'string' ? snap.songName : state.songName;
  state.bpm = Number.isFinite(snap.bpm) ? snap.bpm : state.bpm;
  document.getElementById('songName').value = state.songName;
  document.getElementById('bpm').value = state.bpm;
  updatePageTitle();
  ensureCapacity(); // ต้องเรียกก่อน apply ค่าโน้ต กัน idx เกินขอบเขตกรณี numBars เปลี่ยน

  if (snap.delta) {
    for (const c of snap.cells) state.notes[c.hand][c.idx] = c.val;
  } else {
    state.notes.right = snap.right; state.notes.left = snap.left;
  }

  state.cursorBeat = snap.cursorBeat; state.hand = snap.hand;
  state.repeats = snap.repeats || {}; state.sections = snap.sections || {};
  state.sectionTempoRates = snap.sectionTempoRates || {};
  state.lineLengths = snap.lineLengths || {};
  state.recordMode = snap.recordMode || 'two';
  applyRecordModeUI(state.recordMode);
  state._editingSection = null;
  state.selectedLine = null;
  state.isMultiSelectMode = false;
  if(state.selectedRooms) state.selectedRooms.clear();
  state.isMultiLineMode = false;
  state.selectedLines = new Set();
  document.getElementById('multiSelectActionMenu')?.classList.add('hidden');
  document.getElementById('multiLineActionMenu')?.classList.add('hidden');
  hideCellMenus();
  
  ensureCapacity(); renderNotation();
}

function updateUndoUI() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  const tkUndo = document.getElementById('tkUndoBtn');
  const tkRedo = document.getElementById('tkRedoBtn');
  if (tkUndo) tkUndo.classList.toggle('disabled', undoStack.length === 0);
  if (tkRedo) tkRedo.classList.toggle('disabled', redoStack.length === 0);
}

let audioCtx = null; let audioUnlocked = false; let iosWarned = false;


function appendNewVak() {
  if (chordTimer !== null) { clearTimeout(chordTimer); commitChord(); }
  if (state.numBars / BARS_PER_VAK >= MAX_VAKS) {
    showToast(`เพิ่มได้สูงสุด ${MAX_VAKS} วรรค`, 'error');
    return;
  }
  pushUndo();
  const currentVak = state.numBars / BARS_PER_VAK;
  state.numBars += BARS_PER_VAK; document.getElementById('numVak').value = currentVak + 1;
  ensureCapacity(); state.cursorBeat = currentVak * BARS_PER_VAK * BEATS_PER_BAR;
  renderNotation(); showToast('เพิ่มวรรคใหม่แล้ว', 'success');
  requestAnimationFrame(() => {
    // ใช้ _beatCellMap แทน querySelector scan ทั้ง DOM — สอดคล้องกับ patchNotation
    const cells = _beatCellMap && _beatCellMap.get(state.cursorBeat);
    const cursorEl = cells && cells.find(c => c.dataset.hand === state.hand);
    if (cursorEl) cursorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
}

let currentProjectHandle = null;
let currentProjectName = '';
let isDocumentDirty = false;
let isDownloadConfirmationPending = false;
const hasFileSystemAccess = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;

function buildSaveData() {
  if (chordTimer) { clearTimeout(chordTimer); commitChord(); }
  return {
    type: 'khong-wong-yai-notation', 
    version: 5, 
    instrument: currentInstrument,
    recordMode: state.recordMode,
    songName: state.songName, 
    tempo: state.bpm, 
    vak: state.numBars / BARS_PER_VAK,
    repeats: state.repeats || {}, sections: state.sections || {}, sectionTempoRates: state.sectionTempoRates || {}, lineLengths: state.lineLengths || {}, 
    notes: state.recordMode === 'one'
      ? { right: [...state.notes.right] }
      : { right: [...state.notes.right], left: [...state.notes.left] }, 
    savedAt: new Date().toISOString()
  };
}

function updateSaveUI() {
  const badge = document.getElementById('saveBadge');
  const fname = document.getElementById('saveFileName');
  const status = document.getElementById('autosaveStatus');
  const confirmDownloadBtn = document.getElementById('confirmDownloadBtn');
  const hasProjectFile = Boolean(currentProjectName);
  if (confirmDownloadBtn) confirmDownloadBtn.hidden = !isDownloadConfirmationPending;
  if (badge) {
    badge.textContent = isDownloadConfirmationPending ? 'รอตรวจไฟล์' : (!hasProjectFile || isDocumentDirty ? 'ยังไม่ได้บันทึก' : 'บันทึกแล้ว');
    badge.className = `save-badge ${isDownloadConfirmationPending || !hasProjectFile || isDocumentDirty ? 'ls' : 'fs'}`;
  }
  if (fname) fname.textContent = currentProjectName || 'ยังไม่ได้เลือกไฟล์งาน';
  if (status) {
    if (isDownloadConfirmationPending) {
      status.textContent = '⚠ เบราว์เซอร์เริ่มดาวน์โหลดไฟล์แล้ว — ตรวจสอบว่าไฟล์อยู่ในโฟลเดอร์ดาวน์โหลดก่อนปิดหน้านี้';
    } else if (!hasProjectFile) {
      status.textContent = '⚠ งานนี้ยังอยู่ในหน้านี้ — กด “บันทึกลงเครื่อง” ก่อนปิดหรือรีเฟรช';
    } else if (isDocumentDirty) {
      status.textContent = '⚠ มีการแก้ไขที่ยังไม่ได้บันทึกลงเครื่อง';
    } else {
      status.textContent = '✓ งานถูกบันทึกลงเครื่องแล้ว';
    }
  }
}

function markDocumentDirty() {
  isDocumentDirty = true;
  isDownloadConfirmationPending = false;
  updateSaveUI();
}

function markDocumentSaved(name = currentProjectName) {
  currentProjectName = name || currentProjectName;
  isDocumentDirty = false;
  isDownloadConfirmationPending = false;
  updateSaveUI();
}

function markDocumentDownloadCreated(name) {
  currentProjectName = name || currentProjectName;
  // เบราว์เซอร์ที่ใช้การดาวน์โหลดธรรมดาไม่แจ้งว่าผู้ใช้ยกเลิก/บล็อกไฟล์หรือไม่
  // จึงคงคำเตือนก่อนปิดไว้จนกว่าผู้ใช้จะกดยืนยันหลังตรวจสอบไฟล์ด้วยตนเอง.
  isDocumentDirty = true;
  isDownloadConfirmationPending = true;
  updateSaveUI();
}

function confirmDownloadedFile() {
  if (!isDownloadConfirmationPending) return;
  markDocumentSaved(currentProjectName);
  showToast('ยืนยันการบันทึกไฟล์แล้ว', 'success');
}

function updateSaveTime() {
  const status = document.getElementById('autosaveStatus');
  const now = new Date(); const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (status) status.textContent = `✓ บันทึกลงเครื่องเมื่อ ${timeStr}`;
}

function reportSaveFailure(target, error) {
  const name = error?.name || '';
  const detail = String(error?.message || 'ไม่ทราบสาเหตุ').toLowerCase();
  let cause = 'เบราว์เซอร์ไม่สามารถดำเนินการได้';
  let action = 'ลองใหม่อีกครั้ง หรือปิดแท็บอื่นแล้วเปิดแอปใหม่';

  if (name === 'QuotaExceededError' || /quota|storage.*full|exceeded/.test(detail)) {
    cause = 'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม';
    action = 'อย่าล้างข้อมูลของเว็บไซต์นี้ก่อน ให้ลบข้อมูลเว็บไซต์อื่นหรือเพิ่มพื้นที่ว่าง แล้วกดบันทึกอีกครั้ง';
  } else if (name === 'SecurityError' || /security|not allowed|permission|blocked/.test(detail)) {
    cause = 'เบราว์เซอร์บล็อกสิทธิ์การบันทึกหรือดาวน์โหลด';
    action = 'อนุญาตการดาวน์โหลด/พื้นที่จัดเก็บสำหรับเว็บไซต์นี้ แล้วลองใหม่';
  } else if (/memory|allocation|arraybuffer|out of memory|too large/.test(detail)) {
    cause = 'หน่วยความจำเครื่องไม่พอสำหรับไฟล์ขนาดนี้';
    action = 'ปิดแอปหรือแท็บอื่น แล้วส่งออกเป็นช่วงสั้นลง';
  } else if (/offlineaudiocontext|not supported|unsupported/.test(detail)) {
    cause = 'เบราว์เซอร์นี้ไม่รองรับการสร้างไฟล์เสียง';
    action = 'ลองใช้ Chrome, Edge หรือ Safari เวอร์ชันล่าสุด';
  } else if (/network|fetch|load.*script|cdn/.test(detail)) {
    cause = 'โหลดส่วนประกอบที่จำเป็นจากอินเทอร์เน็ตไม่สำเร็จ';
    action = 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  }

  console.error(`Save failed (${target}):`, error);
  showToast(`ไม่สามารถ${target}: ${cause} วิธีแก้: ${action}`, 'error');
}

async function writeProjectFile(handle, name) {
  try {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(buildSaveData(), null, 2));
    await writable.close();
    currentProjectHandle = handle;
    markDocumentSaved(name || handle.name);
    updateSaveTime();
    return true;
  } catch(e) {
    reportSaveFailure('บันทึกไฟล์งาน', e);
    return false;
  }
}

async function saveProjectAs() {
  try {
    if (hasFileSystemAccess) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${getSafeFilename(state.songName)}.json`,
        types: [{ description: 'ไฟล์งานโน้ต', accept: { 'application/json': ['.json'] } }]
      });
      return await writeProjectFile(handle, handle.name);
    }
    const blob = new Blob([JSON.stringify(buildSaveData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${getSafeFilename(state.songName)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    markDocumentDownloadCreated(a.download);
    return 'download-created';
  } catch(e) {
    if (e.name !== 'AbortError') reportSaveFailure('บันทึกไฟล์งาน', e);
    return false;
  }
}

async function openProjectFile() {
  if (isDocumentDirty && !window.confirm('มีการแก้ไขที่ยังไม่ได้บันทึกลงเครื่อง ต้องการเปิดไฟล์อื่นและทิ้งการแก้ไขนี้หรือไม่?')) return;
  try {
    let file, handle = null;
    if (hasFileSystemAccess) {
      [handle] = await window.showOpenFilePicker({ types: [{ description: 'ไฟล์งานโน้ต', accept: { 'application/json': ['.json'] } }], multiple: false });
      file = await handle.getFile();
    } else {
      file = await new Promise((resolve) => {
        const picker = document.createElement('input');
        picker.type = 'file'; picker.accept = '.json,application/json';
        picker.addEventListener('change', () => resolve(picker.files[0] || null), { once: true });
        picker.click();
      });
      if (!file) return;
    }
    const data = JSON.parse(await file.text());
    restoreProjectData(data);
    currentProjectHandle = handle;
    markDocumentSaved(file.name);
    showToast(`เปิดงานแล้ว: ${file.name}`, 'success');
  } catch(e) {
    if (e.name !== 'AbortError') reportSaveFailure('เปิดไฟล์งาน', e);
  }
}

function scheduleAutosave() { markDocumentDirty(); }

async function saveCurrentProject() {
  const ok = currentProjectHandle
    ? await writeProjectFile(currentProjectHandle, currentProjectName)
    : await saveProjectAs();
  if (ok === true) showToast('บันทึกไฟล์งานลงเครื่องแล้ว', 'success');
  if (ok === 'download-created') showToast('เบราว์เซอร์เริ่มดาวน์โหลดไฟล์แล้ว — ตรวจสอบโฟลเดอร์ดาวน์โหลดก่อนปิดหน้า', 'info');
  return ok;
}

function initSaveSystem() {
  updateSaveUI();
  document.getElementById('saveNowBtn').addEventListener('click', saveCurrentProject);
  document.getElementById('openProjectBtn').addEventListener('click', openProjectFile);
  document.getElementById('confirmDownloadBtn').addEventListener('click', confirmDownloadedFile);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrentProject();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (!isDocumentDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
