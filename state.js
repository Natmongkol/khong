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
        freqs: [335.0, 369.9, 408.4, 450.9, 497.8, 549.6, 606.8, 670.0, 739.7, 816.7, 901.8, 995.6, 1099.2, 1213.7, 1340.0, 1479.5, 1633.5, 1803.5, 1991.2, 2198.5, 2427.3, 2680.0],
        base: ['ซ','ล','ท','ด','ร','ม','ฟ','ซ','ล','ท','ด','ร','ม','ฟ','ซ','ล','ท','ด','ร','ม','ฟ','ซ'],
        display: ['ซฺฺ','ลฺฺ','ทฺฺ','ดฺ','รฺ','มฺ','ฟฺ','ซฺ','ลฺ','ทฺ','ด','ร','ม','ฟ','ซ','ล','ท','ดํ','รํ','มํ','ฟํ','ซํ'],
        // ผังปุ่มลัดคีย์บอร์ด เฉพาะระนาดเอก (ไม่ใช้ CODE_MAP_MASTER ทั่วไปแบบฆ้อง เพราะเรียงคีย์ต่างกัน)
        keyLabels: ['Q','W','E','R','T','Y','U','I/F','G','H','J','K','L',';',"'/C",'V','B','N','M',',','.','/'],
        keyCodes: ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU',['KeyI','KeyF'],'KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon',['Quote','KeyC'],'KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'],
        getNoteRange: (idx) => {
            if (idx <= 9) return 'low';
            if (idx <= 16) return 'mid';
            return 'high';
        }
    }
};

let currentInstrument = 'kwy';

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
    
    // ปุ่มทัชคีย์บอร์ด สลับตามเครื่องที่เลือก
    document.getElementById('kb-kwy').style.display = (instId === 'kwy') ? 'block' : 'none';
    document.getElementById('kb-kmwy').style.display = (instId === 'kmwy') ? 'block' : 'none';
    document.getElementById('kb-ranatek').style.display = (instId === 'ranatek') ? 'block' : 'none';
    
    updatePageTitle();
    renderNotation();
    renderImeInfographic();
    renderGongs(); // วาดลูกฆ้องใหม่เสมอ ไม่ว่าจะเลือกวงใด
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

function updatePageTitle() {
  document.title = state.songName && state.songName.trim() !== '' 
    ? `${state.songName} — ${getActiveInst().name}` 
    : `โน้ตดนตรีไทย ทำนองหลัก`;
}



const BEATS_PER_BAR = 4;
const BARS_PER_VAK = 8;       
const MAX_VAKS = 500;

const state = {
  songName: '', hand: 'right', bpm: 200, numBars: 8, cursorBeat: -1,
  isRecording: true, isPlaying: false, playStart: 0, currentBeat: -1,
  notes: { right: [], left: [] }, clipboardVak: null, repeats: {}, sections: {}, lineLengths: {},
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
function _snapMeta() {
  return {
    instrument: currentInstrument,
    cursorBeat: state.cursorBeat, hand: state.hand, numBars: state.numBars,
    repeats: {...state.repeats}, sections: {...state.sections}, lineLengths: {...state.lineLengths}
  };
}
function _makeFullSnapshot() {
  return { delta: false, right: [...state.notes.right], left: [...state.notes.left], ..._snapMeta() };
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
      
      renderImeInfographic();
      renderGongs();
  }
  state.numBars = snap.numBars;
  document.getElementById('numVak').value = snap.numBars / BARS_PER_VAK;
  ensureCapacity(); // ต้องเรียกก่อน apply ค่าโน้ต กัน idx เกินขอบเขตกรณี numBars เปลี่ยน

  if (snap.delta) {
    for (const c of snap.cells) state.notes[c.hand][c.idx] = c.val;
  } else {
    state.notes.right = snap.right; state.notes.left = snap.left;
  }

  state.cursorBeat = snap.cursorBeat; state.hand = snap.hand;
  state.repeats = snap.repeats || {}; state.sections = snap.sections || {};
  state.lineLengths = snap.lineLengths || {};
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

const LS_KEY = 'kwyi_autosave';
let currentFileHandle = null;

function buildSaveData() {
  if (chordTimer) { clearTimeout(chordTimer); commitChord(); }
  return {
    type: 'khong-wong-yai-notation', 
    version: 5, 
    instrument: currentInstrument,
    songName: state.songName, 
    tempo: state.bpm, 
    vak: state.numBars / BARS_PER_VAK,
    repeats: state.repeats || {}, sections: state.sections || {}, lineLengths: state.lineLengths || {}, 
    notes: { right: [...state.notes.right], left: [...state.notes.left] }, 
    savedAt: new Date().toISOString()
  };
}

function updateSaveTime(mode) {
  const status = document.getElementById('autosaveStatus');
  const now = new Date(); const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const label = mode === 'file' ? '💾 บันทึกลงไฟล์เมื่อ' : '☁ บันทึกลงเบราว์เซอร์เมื่อ';
  if (status) status.textContent = `${label} ${timeStr}`;
}

function saveToLocalStorage() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(buildSaveData())); updateSaveTime('localStorage'); } 
  catch(e) { showToast('บันทึกล้มเหลว: ' + e.message, 'error'); }
}

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveToLocalStorage, 750);
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY); if (!raw) return false;
    const data = JSON.parse(raw); applyImport(data, true);
    const timeStr = data.savedAt ? new Date(data.savedAt).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    showToast(`โหลดงานล่าสุด: ${data.songName || 'ไม่มีชื่อ'} (${timeStr})`, 'success');
    updateSaveUI(); return true;
  } catch(e) { return false; }
}

async function saveToFileHandle(handle) {
  try {
    const writable = await handle.createWritable(); await writable.write(JSON.stringify(buildSaveData(), null, 2)); await writable.close();
    currentFileHandle = handle; updateSaveTime('file'); updateSaveUI(); return true;
  } catch(e) {
    if (e.name !== 'AbortError') showToast('บันทึกไฟล์ไม่สำเร็จ: ' + e.message, 'error'); return false;
  }
}

async function saveFileAs() {
  if (!hasFSAPI) { exportNotation(); return; }
  try {
    const safeName = getSafeFilename(state.songName);
    const handle = await window.showSaveFilePicker({ suggestedName: safeName + '.json', types: [{ description: 'Notation JSON', accept: { 'application/json': ['.json'] } }] });
    await saveToFileHandle(handle); showToast('บันทึกไฟล์สำเร็จ', 'success');
  } catch(e) { if (e.name !== 'AbortError') showToast('ยกเลิกหรือเกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function saveToCurrentFile() {
  if (!currentFileHandle) { await saveFileAs(); return; }
  const ok = await saveToFileHandle(currentFileHandle); if (ok) showToast('💾 Save ทับไฟล์สำเร็จ', 'success');
}

function updateSaveUI() {
  const badge = document.getElementById('saveBadge'); const fname = document.getElementById('saveFileName'); const saveFileBtn = document.getElementById('saveFileBtn');
  if (hasFSAPI) {
    if (saveFileBtn) saveFileBtn.style.display = '';
    if (badge) { badge.textContent = currentFileHandle ? 'File System API' : 'localStorage + File'; badge.className = 'save-badge fs'; }
    if (fname) fname.textContent = currentFileHandle ? (currentFileHandle.name || '—') : 'ยังไม่ได้เลือกไฟล์ · กด ⬇ นำเข้า เพื่อเปิดไฟล์ที่มีอยู่';
  } else {
    if (saveFileBtn) saveFileBtn.style.display = 'none';
    if (badge) { badge.textContent = 'localStorage'; badge.className = 'save-badge ls'; }
    if (fname) fname.textContent = 'บันทึกด้วยตนเองใน browser · กดส่งออก JSON เพื่อดาวน์โหลด';
  }
}

function initSaveSystem() {
  updateSaveUI(); loadFromLocalStorage();
  document.getElementById('saveNowBtn').addEventListener('click', () => { saveToLocalStorage(); showToast('บันทึกใน browser แล้ว', 'success'); });
  const saveFileBtn = document.getElementById('saveFileBtn'); if (saveFileBtn) saveFileBtn.addEventListener('click', saveToCurrentFile);
  window.addEventListener('pagehide', () => {
    clearTimeout(autosaveTimer);
    saveToLocalStorage();
  });
}
