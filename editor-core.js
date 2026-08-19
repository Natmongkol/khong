// ===== editor-core.js: gong render, note input, clipboard, line management =====

function renderGongs() {
  const stage = document.getElementById('gong-stage');
  stage.innerHTML = ''; 
  
  const inst = getActiveInst();

  // ระนาดเอก: ใช้ผังลูกระนาดเรียงแนวนอน (bars) แทนวงฆ้องวงกลม
  if (currentInstrument === 'ranatek') {
    renderBars(stage, inst);
    _rebuildGongCache();
    return;
  }

  // ขลุ่ยเพียงออ: ไม่มีรูปเครื่องดนตรีให้แสดง (เล่น/บันทึกผ่านคีย์บอร์ด/แป้นสัมผัสเท่านั้น)
  if (inst.noImage) {
    _rebuildGongCache();
    return;
  }

  const numGongs = inst.numGongs;
  
  for (let i = 0; i < numGongs; i++) {
    const gong = document.createElement('div');
    gong.className = 'gong'; gong.dataset.idx = i; gong.title = inst.display[i];
    const noteLabel = document.createElement('div');
    noteLabel.className = 'note-label'; 
    const range = inst.getNoteRange(i);
    noteLabel.innerHTML = `<span class="nn nn-${range}">${inst.base[i]}</span>`;
    gong.appendChild(noteLabel);
    const interact = (e) => { e.preventDefault(); unlockAudio(); triggerGong(i); };
    gong.addEventListener('pointerdown', interact);
    stage.appendChild(gong);
  }
  layoutGongs();
  _rebuildGongCache();
}

function renderBars(stage, inst) {
  const wrap = document.createElement('div');
  wrap.className = 'bars ranat-ek';

  for (let i = 0; i < inst.numGongs; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar'; bar.dataset.idx = i; bar.title = inst.display[i];

    const main = document.createElement('span');
    main.className = 'note-main';
    main.textContent = inst.display[i];

    bar.appendChild(main);

    const interact = (e) => { e.preventDefault(); unlockAudio(); triggerGong(i); };
    bar.addEventListener('pointerdown', interact);
    wrap.appendChild(bar);
  }

  stage.appendChild(wrap);
}

function layoutGongs() {
  const stage = document.getElementById('gong-stage');
  const w = stage.clientWidth; const h = stage.clientHeight;
  if (w < 120 || h < 120) {
    // stage ซ่อนอยู่ (อยู่ใน overlay ที่ยังไม่ active หรือ display:none)
    // ตั้ง flag ไว้ — caller ที่รู้ว่า stage กำลังจะ show จะเรียก layoutGongs() อีกครั้งอยู่แล้ว
    layoutGongs._pendingLayout = true;
    return;
  }
  layoutGongs._pendingLayout = false;

  // ระนาดเอก: ลูกระนาดเรียงด้วย CSS flex ปกติ ไม่ต้องคำนวณตำแหน่งวงกลม
  if (currentInstrument === 'ranatek') return;
  // ขลุ่ยเพียงออ: ไม่มีรูปเครื่องดนตรีให้จัดวาง
  if (getActiveInst().noImage) return;

  const inst = getActiveInst();
  const numGongs = inst.numGongs;

  const labelGap = 0; const labelHalfBox = 0; const margin = 14;
  const padRadial = labelGap + labelHalfBox;

  // --- คำนวณ gongSize จาก bounding box จริงของวง ---
  // ฆ้องวงใหญ่: วงโค้ง 270° (225° ถึง -45°) → bounding box ≈ 2R กว้าง, (R + reachL) สูง
  // ฆ้องมอญวงใหญ่: วงโค้ง 252° (216° ถึง -36°) → คล้ายกัน
  // reach = R + labelCenterDist = R + gongSize/2 + labelGap + labelHalfBox
  //       = gongSize*(3.51 + 0.5) + padRadial = 4.01*gongSize + padRadial
  // bounding:
  //   kwy:  width  = 2*(4.01*gs + padRadial),  height = (4.01*gs + padRadial) * (1 + sin45°) ≈ 1.707*(4.01gs+pad)
  //   kmwy: width  = 2*(4.01*gs + padRadial),  height = (4.01*gs + padRadial) * (1 + sin36°) ≈ 1.588*(4.01gs+pad)
  const reach_k  = currentInstrument === 'kwy' ? (1 + Math.sin(45 * Math.PI/180)) : (1 + Math.sin(36 * Math.PI/180));
  const avW = w - 2 * margin;
  const avH = h - 2 * margin;
  // solve: 2*(4.01*gs + pad) = avW  →  gs = (avW/2 - pad) / 4.01
  const gsFromW = (avW / 2 - padRadial) / 4.01;
  // solve: reach_k*(4.01*gs + pad) = avH  →  gs = (avH/reach_k - pad) / 4.01
  const gsFromH = (avH / reach_k - padRadial) / 4.01;

  let gongSize = Math.max(20, Math.min(80, Math.min(gsFromW, gsFromH)));
  const R = 3.51 * gongSize;
  const labelCenterDist = gongSize / 2 + labelGap + labelHalfBox;
  const reachL = R + labelCenterDist; // reach จากจุดศูนย์กลางวงถึงขอบฉลาก

  stage.style.setProperty('--gong-size', gongSize + 'px');

  // --- คำนวณตำแหน่ง gong ทั้งหมด โดย cx=0, cy=0 ก่อน แล้วค่อย offset ---
  const positions = [];
  for (let i = 0; i < numGongs; i++) {
    let angleRad, x, y, lx, ly;
    if (currentInstrument === 'kwy') {
      angleRad = (225 - i * (270 / (numGongs - 1))) * Math.PI / 180;
      const cosA = Math.cos(angleRad); const sinA = Math.sin(angleRad);
      x  = R * cosA;
      y  = -R * sinA;
      lx = labelCenterDist * cosA;
      ly = -labelCenterDist * sinA;
    } else {
      angleRad = (216 - i * (252 / (numGongs - 1))) * Math.PI / 180;
      const cosA = Math.cos(angleRad); const sinA = Math.sin(angleRad);
      x  = R * cosA;
      y  = R * sinA;
      lx = labelCenterDist * cosA;
      ly = labelCenterDist * sinA;
    }
    positions.push({ x, y, lx, ly });
  }

  // --- หา bounding box จริงของลูกฆ้อง + ฉลาก ---
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of positions) {
    const reach = reachL + gongSize / 2;
    minX = Math.min(minX, p.x - reach);
    maxX = Math.max(maxX, p.x + reach);
    minY = Math.min(minY, p.y - reach);
    maxY = Math.max(maxY, p.y + reach);
  }

  // --- offset เพื่อให้วงอยู่กึ่งกลาง stage ---
  const offsetX = w / 2 - (minX + maxX) / 2;
  const offsetY = h / 2 - (minY + maxY) / 2;

  // --- apply ตำแหน่ง ---
  for (let i = 0; i < numGongs; i++) {
    const { x, y, lx, ly } = positions[i];
    const gong = stage.querySelector(`.gong[data-idx="${i}"]`);
    if (!gong) continue;

    gong.style.left = (x + offsetX) + 'px';
    gong.style.top  = (y + offsetY) + 'px';
    gong.style.transform = 'translate(-50%, -50%)';

    const label = gong.querySelector('.note-label');
    if (label) {
      label.style.left = '';
      label.style.top  = '';
      label.style.transform = '';
    }
  }
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    layoutGongs();
    // ถ้า stage ซ่อนอยู่ตอน resize (เช่น อยู่ใน overlay ที่ยังไม่ active)
    // layoutGongs() จะตั้ง _pendingLayout แล้ว return — ลอง rAF อีกครั้งเมื่อ paint ถัดไป
    if (layoutGongs._pendingLayout) {
      requestAnimationFrame(() => { if (layoutGongs._pendingLayout) layoutGongs(); });
    }
  }, 120);
});

// debounced wrapper — ใช้กรณีไม่ต้องการ render ทันที (เช่น resize, scroll)
let _renderTimer = null;
function renderNotationDeferred() {
  if (_renderTimer) cancelAnimationFrame(_renderTimer);
  _renderTimer = requestAnimationFrame(() => { 
    _renderTimer = null; 
    renderNotation(); 
  });
}

// --- cache สำหรับ flashGong ---
const _gongEls = new Map();   // idx -> gong DOM element
const _kbEls   = new Map();   // idx -> array of kb-note elements
function _rebuildGongCache() {
  _gongEls.clear(); _kbEls.clear();
  document.querySelectorAll('.gong-stage .gong, .gong-stage .bar').forEach(el => {
    _gongEls.set(parseInt(el.dataset.idx), el);
  });
  document.querySelectorAll(`.touch-keyboard #kb-${currentInstrument} .tk-note`).forEach(el => {
    const i = parseInt(el.dataset.idx);
    if (!_kbEls.has(i)) _kbEls.set(i, []);
    _kbEls.get(i).push(el);
  });
}

function flashGong(idx) {
  const el = _gongEls.get(idx) || document.querySelector(`.gong-stage .gong[data-idx="${idx}"], .gong-stage .bar[data-idx="${idx}"]`);
  if (el) {
    // restart animation โดยไม่ force reflow: ยกเลิก animation เก่าแล้วใส่ class ใหม่
    // หมายเหตุ: layoutGongs() set gong.style.transform เป็น inline style ซึ่ง override CSS animation
    // keyframes ได้ → ต้อง clear inline transform ก่อน add class แล้วคืนค่าหลัง animation จบ
    el.classList.remove('playing');
    const savedTransform = el.style.transform;
    requestAnimationFrame(() => {
      el.style.transform = '';   // ให้ CSS animation keyframes ควบคุม transform ได้
      el.classList.add('playing');
      setTimeout(() => {
        el.classList.remove('playing');
        el.style.transform = savedTransform; // คืน inline transform หลัง animation จบ
      }, 300);
    });
  }
  const btns = _kbEls.get(idx);
  if (btns) {
    btns.forEach(btn => {
      btn.style.transform = 'scale(0.92)';
      btn.style.background = 'var(--panel)';
      setTimeout(() => { btn.style.transform = ''; btn.style.background = ''; }, 150);
    });
  }
}

function totalBeats() { return state.numBars * BEATS_PER_BAR; }

function ensureCapacity() {
  const t = totalBeats();
  for (const h of ['right','left']) {
    const arr = state.notes[h];
    while (arr.length < t) arr.push(null);
    if (arr.length > t) arr.length = t;
  }
  if (state.cursorBeat >= t) state.cursorBeat = t - 1;
}

function advanceCursor() {
  const t = totalBeats();
  if (state.cursorBeat + 1 >= t) {
    const currentVak = state.numBars / BARS_PER_VAK;
    state.numBars += BARS_PER_VAK;
    document.getElementById('numVak').value = currentVak + 1;
    ensureCapacity(); state.cursorBeat = t;
  } else { state.cursorBeat++; }
  requestAnimationFrame(() => {
    const _cells = _beatCellMap && _beatCellMap.get(state.cursorBeat);
    const cursorEl = _cells && _cells.find(c => c.dataset.hand === state.hand);
    if (cursorEl) cursorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
}

let chordBuffer = { left: null, right: null }; let chordTimer = null;
let tabHeld = false, shiftHeld = false, arrowUpHeld = false, arrowDownHeld = false;

function triggerGong(idx) {
  // โหมดรับชม: ห้ามโต้ตอบกับลูกฆ้องทุกกรณี
  if (document.getElementById('focusOverlay')?.classList.contains('active')) return;

  playGong(idx);
  flashGong(idx);

  if (!state.isRecording || !state.isEditMode) return;
  chordBuffer[state.hand] = idx; // บันทึกแค่โน้ตหลัก (เสมือนมือขวา)
  if (chordTimer === null) chordTimer = setTimeout(commitChord, 55);
}

function typeNote(baseIdx) {
  if (!state.isEditMode) {
      if (state.cursorBeat !== -1) showToast('แตะ 2 ครั้งที่ช่องโน้ตเพื่อเข้าโหมดแก้ไข', 'error');
      return;
  }
  if (baseIdx === -1) return;
  let leftNote = null, rightNote = null;
  const inst = getActiveInst();

  if (state.recordMode === 'one') {
      // โหมดมือเดียว: ไม่มีแถวมือซ้าย ปุ่มลัด Tab/Shift/↑/↓ (จับคู่ 2 มือ) จึงไม่มีผลใดๆ
      // กดโน้ตตัวไหนก็ดังตัวนั้นตัวเดียว เหมือนโน้ตสองมือปกติ — การเล่นคู่แปดทำเฉพาะตอน playback/export เท่านั้น
      rightNote = baseIdx;
  } else if (tabHeld) {
      if (currentInstrument === 'kwy' || currentInstrument === 'ranatek') {
          let lo = baseIdx, hi = baseIdx + 7;
          if (hi >= inst.numGongs) { hi = baseIdx; lo = baseIdx - 7; }
          leftNote = (lo >= 0) ? lo : null; rightNote = (hi < inst.numGongs) ? hi : null;
      } else {
          // KMWY
          let hi = inst.octaveMapUp[baseIdx];
          let lo = inst.octaveMapDown[baseIdx];
          if (hi !== undefined) { leftNote = baseIdx; rightNote = hi; }
          else if (lo !== undefined) { leftNote = lo; rightNote = baseIdx; }
          else { leftNote = baseIdx; rightNote = baseIdx; } // no exact octave mapping
      }
      if (leftNote === null && rightNote !== null) leftNote = rightNote;
      if (rightNote === null && leftNote !== null) rightNote = leftNote;
  } else if (shiftHeld) {
      let hi = baseIdx, lo = baseIdx - 3;
      if (lo < 0) { lo = baseIdx; hi = baseIdx + 3; }
      leftNote = (lo >= 0) ? lo : null; rightNote = (hi < inst.numGongs) ? hi : null;
      if (leftNote === null && rightNote !== null) leftNote = rightNote;
      if (rightNote === null && leftNote !== null) rightNote = leftNote;
  } else {
      if (arrowUpHeld) rightNote = baseIdx;
      else if (arrowDownHeld) leftNote = baseIdx;
      else {
          if (state.hand === 'left') leftNote = baseIdx; else rightNote = baseIdx;
      }
  }

  if (leftNote !== null) { playGong(leftNote); flashGong(leftNote); }
  if (rightNote !== null && rightNote !== leftNote) { playGong(rightNote); flashGong(rightNote); }
  if (!state.isRecording) return;

  const collides = (leftNote !== null && chordBuffer.left !== null) || (rightNote !== null && chordBuffer.right !== null);
  if (collides) { if (chordTimer) { clearTimeout(chordTimer); chordTimer = null; } commitChord(); }

  if (leftNote !== null) chordBuffer.left = leftNote;
  if (rightNote !== null) chordBuffer.right = rightNote;
  if (chordTimer === null) chordTimer = setTimeout(commitChord, 55);
}

function commitChord() {
  chordTimer = null; const { left, right } = chordBuffer;
  chordBuffer = { left: null, right: null };
  if (!state.isRecording) return;
  if (left === null && right === null) return;
  
  const cursor = state.cursorBeat;
  const cellRefs = [];
  if (left  !== null) cellRefs.push({ hand: 'left',  idx: cursor });
  if (right !== null) cellRefs.push({ hand: 'right', idx: cursor });
  pushUndo(cellRefs);
  if (left !== null) state.notes.left[cursor] = left;
  if (right !== null) state.notes.right[cursor] = right;
  
  advanceCursor(); patchNotation([cursor]);
}

function insertRest() {
  if (!state.isRecording || !state.isEditMode) return;
  // ยกเลิก chord ที่ค้างอยู่โดยไม่ commit (ไม่เลื่อน cursor) เพื่อป้องกัน cursor เลื่อนซ้ำ
  if (chordTimer !== null) { clearTimeout(chordTimer); chordTimer = null; chordBuffer = { left: null, right: null }; }
  const cursor = state.cursorBeat;
  pushUndo([{ hand: 'left', idx: cursor }, { hand: 'right', idx: cursor }]);
  state.notes.left[cursor] = null; state.notes.right[cursor] = null;
  advanceCursor(); patchNotation([cursor]);
}

function deleteAtCursor() {
  if (!state.isRecording || !state.isEditMode) return;
  if (chordTimer !== null) { clearTimeout(chordTimer); commitChord(); }
  const beat = state.cursorBeat;
  const hasContent = state.notes.left[beat] !== null || state.notes.right[beat] !== null;
  const targetBeat = hasContent ? beat : (beat > 0 ? beat - 1 : null);
  if (targetBeat === null) { patchNotation([]); return; } // ไม่มีอะไรให้ลบจริงๆ — ไม่ต้องสร้าง undo entry เปล่าๆ

  pushUndo([{ hand: 'left', idx: targetBeat }, { hand: 'right', idx: targetBeat }]);
  if (hasContent) {
    state.notes.left[beat] = null; state.notes.right[beat] = null;
  } else {
    state.cursorBeat = targetBeat;
    state.notes.left[targetBeat] = null; state.notes.right[targetBeat] = null;
  }
  patchNotation([targetBeat]);
}

function moveCursorBy(delta) {
  if (delta === 1) { advanceCursor(); } else {
    state.cursorBeat = Math.max(0, state.cursorBeat + delta);
  }
  patchNotation([]);
}

function getSafeFilename(name) {
  if (!name || name.trim() === '') return getActiveInst().id;
  return name.trim().replace(/[\/\\?%*:|"<>]/g, '-');
}

function copyRoom() {
    if (state.cursorBeat === -1) return;
    const bar = Math.floor(state.cursorBeat / 4);
    const startB = bar * 4;
    const data = { right: [], left: [] };
    data.right = state.notes.right.slice(startB, startB + 4);
    data.left  = state.notes.left.slice(startB, startB + 4);
    customClipboard = { type: 'room', data, length: 4, originalHand: 'right' };
    showToast('คัดลอกโน้ต 1 ห้อง (ทั้ง 2 มือ) เรียบร้อย', 'success');
    hideCellMenus();
}

function pasteRoom() {
    if (!customClipboard || state.cursorBeat === -1 || customClipboard.type === 'line') return;
    pushUndo();
    const bar = Math.floor(state.cursorBeat / 4);
    const startB = bar * 4;
    const len = customClipboard.length;
    
    while (totalBeats() < startB + len) {
        state.numBars += BARS_PER_VAK;
        ensureCapacity();
        document.getElementById('numVak').value = state.numBars / BARS_PER_VAK;
    }
    
    for (let i = 0; i < len; i++) {
        state.notes.right[startB + i] = customClipboard.data.right != null ? customClipboard.data.right[i] : null;
        if (state.recordMode !== 'one') {
          state.notes.left[startB + i]  = customClipboard.data.left  != null ? customClipboard.data.left[i]  : null;
        }
    }
    renderNotation(); hideCellMenus();
    showToast('วางโน้ต (ทั้ง 2 มือ) เรียบร้อย', 'success');
}

// ── รวม selectedRooms (เช่น "right:3","left:3","right:4") ให้เป็น Map<บาร์, {right,left}> ──
// เพื่อรู้ว่าแต่ละห้องที่เลือกไว้ ครอบคลุมมือไหนบ้าง (จะได้ไม่ไปยุ่งกับมืออีกข้างที่ไม่ได้เลือก)
function _groupSelectedRoomsByBar() {
    const map = new Map();
    state.selectedRooms.forEach(key => {
        const [hand, barStr] = key.split(':');
        const bar = parseInt(barStr, 10);
        if (!map.has(bar)) map.set(bar, { right: false, left: false });
        map.get(bar)[hand] = true;
    });
    return map;
}

function copyMultiRooms() {
    if (!state.selectedRooms || state.selectedRooms.size === 0) return;
    const roomMap = _groupSelectedRoomsByBar();
    const bars = Array.from(roomMap.keys()).sort((a, b) => a - b);
    const minBar = bars[0];
    const maxBar = bars[bars.length - 1];
    const copiedLength = (maxBar - minBar + 1) * 4;
    const data = { right: new Array(copiedLength).fill(null), left: new Array(copiedLength).fill(null) };
    // activeRight/activeLeft: จำไว้ต่อจังหวะว่าตอนคัดลอก มือนั้นถูกเลือกจริงไหม
    // (ใช้ตอนวาง เพื่อไม่ให้ไปเขียนทับ/ล้างมือที่ไม่ได้เลือกตอนคัดลอก)
    const activeRight = new Array(copiedLength).fill(false);
    const activeLeft  = new Array(copiedLength).fill(false);

    bars.forEach(bar => {
        const hands = roomMap.get(bar);
        const startIdx = (bar - minBar) * 4;
        const globalBeat = bar * 4;
        for (let i = 0; i < 4; i++) {
            if (hands.right) { data.right[startIdx + i] = state.notes.right[globalBeat + i]; activeRight[startIdx + i] = true; }
            if (hands.left)  { data.left[startIdx + i]  = state.notes.left[globalBeat + i];  activeLeft[startIdx + i]  = true; }
        }
    });

    customClipboard = { type: 'room', data, length: copiedLength, activeRight, activeLeft, originalHand: 'right' };
    showToast(`คัดลอก ${bars.length} ห้องเรียบร้อย`, 'success');

    state.isMultiSelectMode = false;
    state.selectedRooms.clear();
    document.getElementById('multiSelectActionMenu').classList.add('hidden');
    renderNotation();
}

function pasteMultiRooms() {
    if (!customClipboard || !state.selectedRooms || state.selectedRooms.size === 0 || customClipboard.type === 'line') return;
    pushUndo();
    const len = customClipboard.length;

    // วางเป็นก้อนเดียว ต่อเนื่องยาวเท่ากับที่คัดลอกมาจริง โดยยึดห้องที่มีเลขบาร์น้อยที่สุด
    // ในกลุ่มที่เลือกไว้เป็นจุดเริ่มวาง (เดิม: วนวางคลิปทั้งก้อนซ้ำที่ห้องทุกห้องที่เลือก
    // ทำให้เนื้อหาห้องแรกถูกเขียนทับซ้ำ กลายเป็นห้องเกินมาไม่ตรงกับที่คัดลอก — แก้แล้ว)
    const bars = Array.from(state.selectedRooms).map(k => parseInt(k.split(':')[1], 10));
    const minBar = Math.min(...bars);
    const startB = minBar * 4;

    while (totalBeats() < startB + len) {
        state.numBars += BARS_PER_VAK;
        ensureCapacity();
        document.getElementById('numVak').value = state.numBars / BARS_PER_VAK;
    }

    // activeRight/activeLeft ไม่มีในคลิปบอร์ดรุ่นเก่า (จาก copyRoom เดี่ยว) — ถือว่าเป็นทั้ง 2 มือเสมอ ตามพฤติกรรมเดิม
    const activeRight = customClipboard.activeRight;
    const activeLeft  = customClipboard.activeLeft;

    for (let i = 0; i < len; i++) {
        const idx = startB + i;
        if (customClipboard.data.right != null && (!activeRight || activeRight[i])) {
            state.notes.right[idx] = customClipboard.data.right[i];
        }
        if (state.recordMode !== 'one' && customClipboard.data.left != null && (!activeLeft || activeLeft[i])) {
            state.notes.left[idx] = customClipboard.data.left[i];
        }
    }

    state.isMultiSelectMode = false;
    state.selectedRooms.clear();
    document.getElementById('multiSelectActionMenu').classList.add('hidden');
    renderNotation();
    showToast('วางโน้ตเรียบร้อย', 'success');
}

// ── (Desktop) ลบโน้ตของทุกห้องที่เลือกไว้ (state.selectedRooms) พร้อมกัน ──────────────
// แยกจาก deleteAtCursor() เดิม (ลบทีละช่อง ตาม cursor เดี่ยว) โดยเจตนา
// เพื่อไม่ให้ Delete/Backspace ตอนอยู่ในโหมดเลือกหลายห้องไปชนกับพฤติกรรมลบโน้ตปกติ
// ลบเฉพาะแถวมือที่ถูกเลือกไว้จริงต่อห้องเท่านั้น (ไม่ไปแตะมืออีกข้างที่ไม่ได้เลือก)
function deleteSelectedRooms() {
    if (!state.selectedRooms || state.selectedRooms.size === 0) return;
    pushUndo();
    const roomMap = _groupSelectedRoomsByBar();
    roomMap.forEach((hands, bar) => {
        const startB = bar * 4;
        for (let i = 0; i < 4; i++) {
            if (hands.right) state.notes.right[startB + i] = null;
            if (hands.left)  state.notes.left[startB + i]  = null;
        }
    });
    state.isMultiSelectMode = false;
    state.selectedRooms.clear();
    document.getElementById('multiSelectActionMenu')?.classList.add('hidden');
    renderNotation();
    showToast(`ลบโน้ต ${roomMap.size} ห้องเรียบร้อย`, 'success');
}

function deleteLine(lineIndex) {
    if (state.numBars <= BARS_PER_VAK) { showToast('ต้องมีอย่างน้อย 1 บรรทัด', 'error'); return; }
    pushUndo();
    const startIdx = lineIndex * 32;
    state.notes.right.splice(startIdx, 32);
    state.notes.left.splice(startIdx, 32);
    state.numBars -= BARS_PER_VAK;
    document.getElementById('numVak').value = state.numBars / BARS_PER_VAK;

    const newSec = {}; const newRep = {}; const newTempoRates = {}; const newLen = {};
    // numBars ถูกลดไปแล้ว ต้องบวก BARS_PER_VAK คืนเพื่อให้ได้จำนวนบรรทัดก่อนลบ
    const totalLinesOld = (state.numBars + BARS_PER_VAK) / BARS_PER_VAK;
    for (let i = 1; i <= totalLinesOld; i++) {
        if (i < lineIndex + 1) {
            if (state.sections[i]) newSec[i] = state.sections[i];
            if (state.sectionTempoRates[i]) newTempoRates[i] = state.sectionTempoRates[i];
            if (state.repeats[i]) newRep[i] = state.repeats[i];
            if (state.lineLengths[i]) newLen[i] = state.lineLengths[i];
        } else if (i > lineIndex + 1) {
            if (state.sections[i]) newSec[i - 1] = state.sections[i];
            if (state.sectionTempoRates[i]) newTempoRates[i - 1] = state.sectionTempoRates[i];
            if (state.lineLengths[i]) newLen[i - 1] = state.lineLengths[i];
            if (state.repeats[i]) {
                let target = state.repeats[i];
                if (target > lineIndex + 1) target--;
                newRep[i - 1] = target;
            }
        }
    }
    state.sections = newSec; state.sectionTempoRates = newTempoRates; state.repeats = newRep; state.lineLengths = newLen;
    if (state.cursorBeat >= state.notes.right.length) state.cursorBeat = -1;
    renderNotation();
    showToast('ลบบรรทัดเรียบร้อย', 'success');
}

function insertLine(lineIndex) {
    pushUndo();
    const insertAt = (lineIndex + 1) * 32;
    const nulls = new Array(32).fill(null);
    state.notes.right.splice(insertAt, 0, ...nulls);
    state.notes.left.splice(insertAt, 0, ...nulls);
    state.numBars += BARS_PER_VAK;
    document.getElementById('numVak').value = state.numBars / BARS_PER_VAK;

    const newSec = {}; const newRep = {}; const newTempoRates = {}; const newLen = {};
    const totalLinesNew = state.numBars / 8;
    for (let i = totalLinesNew; i >= 1; i--) {
        if (i <= lineIndex + 1) {
            if (state.sections[i]) newSec[i] = state.sections[i];
            if (state.sectionTempoRates[i]) newTempoRates[i] = state.sectionTempoRates[i];
            if (state.repeats[i]) newRep[i] = state.repeats[i];
            if (state.lineLengths[i]) newLen[i] = state.lineLengths[i];
        } else {
            if (state.sections[i - 1]) newSec[i] = state.sections[i - 1];
            if (state.sectionTempoRates[i - 1]) newTempoRates[i] = state.sectionTempoRates[i - 1];
            if (state.lineLengths[i - 1]) newLen[i] = state.lineLengths[i - 1];
            if (state.repeats[i - 1]) {
                let target = state.repeats[i - 1];
                if (target > lineIndex + 1) target++;
                newRep[i] = target;
            }
        }
    }
    state.sections = newSec; state.sectionTempoRates = newTempoRates; state.repeats = newRep; state.lineLengths = newLen;
    if (state.cursorBeat >= insertAt) state.cursorBeat += 32;
    renderNotation();
    showToast('แทรกบรรทัดใหม่แล้ว', 'success');
}

function moveLineUp(lineIndex) {
    if (lineIndex <= 0) return;
    pushUndo();
    // ตัดบรรทัด lineIndex (บรรทัดที่ต้องการขึ้น) แล้วแทรกไว้ก่อนบรรทัด lineIndex-1
    const startCurrent = lineIndex * 32;
    const startAbove   = (lineIndex - 1) * 32;

    const chunkR = state.notes.right.splice(startCurrent, 32);
    const chunkL = state.notes.left.splice(startCurrent, 32);

    state.notes.right.splice(startAbove, 0, ...chunkR);
    state.notes.left.splice(startAbove, 0, ...chunkL);

    // Swap metadata: บรรทัด lineIndex+1 (1-based) ↔ lineIndex (1-based)
    const L1 = lineIndex;       // บรรทัดที่อยู่เหนือกว่าใน 1-based (ก่อนย้าย = lineIndex-1+1)
    const L2 = lineIndex + 1;   // บรรทัดที่อยู่ใต้กว่าใน 1-based (ก่อนย้าย = lineIndex+1)

    const tempSec = state.sections[L2];
    if (state.sections[L1]) state.sections[L2] = state.sections[L1]; else delete state.sections[L2];
    if (tempSec) state.sections[L1] = tempSec; else delete state.sections[L1];

    const tempTempoRate = state.sectionTempoRates[L2];
    if (state.sectionTempoRates[L1]) state.sectionTempoRates[L2] = state.sectionTempoRates[L1]; else delete state.sectionTempoRates[L2];
    if (tempTempoRate) state.sectionTempoRates[L1] = tempTempoRate; else delete state.sectionTempoRates[L1];

    const tempRep = state.repeats[L2];
    if (state.repeats[L1]) state.repeats[L2] = state.repeats[L1]; else delete state.repeats[L2];
    if (tempRep) state.repeats[L1] = tempRep; else delete state.repeats[L1];

    const tempLen = state.lineLengths[L2];
    if (state.lineLengths[L1] !== undefined) state.lineLengths[L2] = state.lineLengths[L1]; else delete state.lineLengths[L2];
    if (tempLen !== undefined) state.lineLengths[L1] = tempLen; else delete state.lineLengths[L1];

    // อัพเดต cursor
    if (state.cursorBeat >= startAbove && state.cursorBeat < startAbove + 32) state.cursorBeat += 32;
    else if (state.cursorBeat >= startAbove + 32 && state.cursorBeat < startAbove + 64) state.cursorBeat -= 32;

    renderNotation();
}

function moveLineDown(lineIndex) {
    const totalLines = state.numBars / BARS_PER_VAK;
    if (lineIndex >= totalLines - 1) return;
    moveLineUp(lineIndex + 1);
}

// ย้ายบรรทัด (0-based) จาก fromIndex ไปยัง toIndex โดยทำทีละขั้น (ใช้ moveLineUp ซ้ำๆ)
// ใช้สำหรับลากสลับบรรทัดด้วย Drag Handle — ครอบ pushUndo ครั้งเดียวสำหรับการลากทั้งหมด
function moveLineToPosition(fromIndex, toIndex, recordUndo = true) {
    const totalLines = state.numBars / BARS_PER_VAK;
    fromIndex = Math.max(0, Math.min(totalLines - 1, fromIndex));
    toIndex   = Math.max(0, Math.min(totalLines - 1, toIndex));
    if (fromIndex === toIndex) return;

    if (recordUndo) pushUndo();

    let idx = fromIndex;
    if (toIndex < fromIndex) {
        while (idx > toIndex) { moveLineUpNoUndo(idx); idx--; }
    } else {
        while (idx < toIndex) { moveLineDownNoUndo(idx); idx++; }
    }
    renderNotation();
}

// เวอร์ชันไม่บันทึก undo (ใช้ภายใน moveLineToPosition เพื่อรวมเป็น undo step เดียว)
function moveLineUpNoUndo(lineIndex) {
    if (lineIndex <= 0) return;
    const startCurrent = lineIndex * 32;
    const startAbove   = (lineIndex - 1) * 32;

    const chunkR = state.notes.right.splice(startCurrent, 32);
    const chunkL = state.notes.left.splice(startCurrent, 32);

    state.notes.right.splice(startAbove, 0, ...chunkR);
    state.notes.left.splice(startAbove, 0, ...chunkL);

    const L1 = lineIndex;
    const L2 = lineIndex + 1;

    const tempSec = state.sections[L2];
    if (state.sections[L1]) state.sections[L2] = state.sections[L1]; else delete state.sections[L2];
    if (tempSec) state.sections[L1] = tempSec; else delete state.sections[L1];

    const tempTempoRate = state.sectionTempoRates[L2];
    if (state.sectionTempoRates[L1]) state.sectionTempoRates[L2] = state.sectionTempoRates[L1]; else delete state.sectionTempoRates[L2];
    if (tempTempoRate) state.sectionTempoRates[L1] = tempTempoRate; else delete state.sectionTempoRates[L1];

    const tempRep = state.repeats[L2];
    if (state.repeats[L1]) state.repeats[L2] = state.repeats[L1]; else delete state.repeats[L2];
    if (tempRep) state.repeats[L1] = tempRep; else delete state.repeats[L1];

    const tempLen = state.lineLengths[L2];
    if (state.lineLengths[L1] !== undefined) state.lineLengths[L2] = state.lineLengths[L1]; else delete state.lineLengths[L2];
    if (tempLen !== undefined) state.lineLengths[L1] = tempLen; else delete state.lineLengths[L1];

    if (state.cursorBeat >= startAbove && state.cursorBeat < startAbove + 32) state.cursorBeat += 32;
    else if (state.cursorBeat >= startAbove + 32 && state.cursorBeat < startAbove + 64) state.cursorBeat -= 32;
}

function moveLineDownNoUndo(lineIndex) {
    const totalLines = state.numBars / BARS_PER_VAK;
    if (lineIndex >= totalLines - 1) return;
    moveLineUpNoUndo(lineIndex + 1);
}

// fingerprint ล่าสุดที่ updateSectionStats ใช้ build DOM — ป้องกัน rebuild ซ้ำ
let _secStatsFP = null;

// escape HTML สำหรับ inject เข้า innerHTML โดยตรง
function _escHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateSectionStats() {
  const totalLines = Math.ceil(state.numBars / BARS_PER_VAK);
  const sectionKeys = Object.keys(state.sections || {}).map(Number).sort((a,b)=>a-b);
  
  if (!sectionKeys.includes(1)) sectionKeys.unshift(1);
  
  sectionLineMap = sectionKeys;
  
  const el = document.getElementById('sectionCount');
  if (el) el.textContent = `${sectionKeys.length} ท่อน`;

  // fingerprint: totalLines + section keys + section names — ถ้าเหมือนกัน ข้ามการ rebuild DOM
  const fp = totalLines + '|' + sectionKeys.map(k => k + ':' + ((state.sections && state.sections[k]) || '')).join(',');
  if (fp === _secStatsFP) return;
  _secStatsFP = fp;

  document.querySelectorAll('.dynamic-sec-stat').forEach(e => e.remove());
  const statsContainer = document.getElementById('statsContainer');
  if (!statsContainer) return;

  for (let i = 0; i < sectionKeys.length; i++) {
      let secStart = sectionKeys[i];
      let nextSecStart = (i + 1 < sectionKeys.length) ? sectionKeys[i+1] : totalLines + 1;
      let numLines = nextSecStart - secStart;
      
      let secName = (state.sections && state.sections[secStart]) ? state.sections[secStart] : `ท่อนที่ ${i + 1}`;
      
      const statDiv = document.createElement('div');
      statDiv.className = 'stat dynamic-sec-stat';
      statDiv.innerHTML = `<span class="label" title="${_escHTML(secName)}" style="max-width:140px; overflow:hidden; text-overflow:ellipsis;">${_escHTML(secName)}</span><span class="value">${numLines} บรรทัด</span>`;
      statsContainer.appendChild(statDiv);
  }
}
