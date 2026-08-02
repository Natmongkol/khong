// ===== notation-render.js: line drag, patchNotation, renderNotation =====

// ===== Drag บรรทัด: AssistiveTouch-style =====
// แตะสั้น = tap (click เดินหน้าไปที่ play btn), กดค้าง/ขยับแนวตั้ง = drag สลับตำแหน่ง
let _dragState = null;
const _DRAG_LP_MS  = 200;   // long-press threshold (ms)
const _DRAG_PX     = 6;     // move threshold (px) ที่ถือว่าเป็น drag ทันที
const _ASCROLL_EDGE = 68;
const _ASCROLL_SPD  = 18;

// ── helper ──────────────────────────────────────────────────────────────────
function _dragBottomLimit() {
  const kb = document.getElementById('touchKeyboard');
  if (kb) { const r = kb.getBoundingClientRect(); if (r.height > 0 && r.top < window.innerHeight) return r.top; }
  return window.innerHeight;
}

// drop-indicator: เส้นสีฟ้าแสดงว่าจะวางตรงไหน
let _dropIndicator = null;
function _showDropIndicator(refWrap, above) {
  if (!_dropIndicator) {
    _dropIndicator = document.createElement('div');
    _dropIndicator.style.cssText = [
      'position:fixed;left:0;right:0;height:3px;pointer-events:none;z-index:9998',
      'background:var(--accent,#5b9eff)',
      'box-shadow:0 0 8px 2px rgba(91,158,255,0.55)',
      'border-radius:2px','transition:top 0.1s ease'
    ].join(';');
    document.body.appendChild(_dropIndicator);
  }
  const r = refWrap.getBoundingClientRect();
  _dropIndicator.style.top = (above ? r.top - 2 : r.bottom - 1) + 'px';
}
function _hideDropIndicator() {
  if (_dropIndicator) { _dropIndicator.remove(); _dropIndicator = null; }
}

// ── initLineDrag (ผูก events กับ vak-label แต่ละบรรทัด) ──────────────────────
function initLineDrag(handle, lineWrap, lineIndex) {
  let _lpTimer    = null;   // long-press setTimeout id
  let _pointerId  = null;
  let _startY     = 0;
  let _startX     = 0;
  let _lastY      = 0;
  let _moved      = false;  // ขยับเกิน threshold แล้ว
  let _active     = false;  // drag กำลังทำงาน

  // visual: pulse ring ขณะรอ long-press
  function _ring(on) { handle.classList.toggle('vak-pressing', on); }

  // ── เริ่ม drag ──────────────────────────────────────────────────
  function _beginDrag(clientY) {
    if (_dragState) return;
    _ring(false);
    if (chordTimer !== null) { clearTimeout(chordTimer); commitChord(); }

    const root = document.getElementById('notation');
    const rect = lineWrap.getBoundingClientRect();

    // ghost: set style โดยตรง (ไม่ += cssText เพราะจะ corrupt inherited style)
    const ghost = lineWrap.cloneNode(true);
    ghost.classList.add('drag-ghost');
    // วัด vak-label-col จริงก่อน append ghost
    // เพื่อให้ ghost กว้างพอดีกับ vak-label-col — ไม่ตัดเนื้อหาด้วย overflow:hidden
    const lc = lineWrap.querySelector('.vak-label-col');
    const lcRect = lc ? lc.getBoundingClientRect() : null;
    // ghost width = ระยะจากขอบซ้าย lineWrap ถึงขอบขวา vak-label-col + padding เล็กน้อย
    // ใช้ lcRect.right - rect.left แทนการบวก magic number
    const gw = lcRect ? (lcRect.right - rect.left + 8) : 68;
    // ตั้ง position:fixed ทีละ property เพื่อไม่ให้ถูก cascade ทับ
    ghost.style.position = 'fixed';
    ghost.style.left     = rect.left + 'px';
    ghost.style.top      = rect.top  + 'px';
    ghost.style.width    = gw + 'px';
    ghost.style.height   = rect.height + 'px';
    ghost.style.margin   = '0';
    ghost.style.zIndex   = '9999';
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);

    lineWrap.classList.add('dragging');
    document.body.style.userSelect = 'none';
    _active = true;
    if (navigator.vibrate) navigator.vibrate(20);

    _dragState = {
      root, lineWrap, ghost,
      startY: clientY, origTop: rect.top,
      placeholderH: rect.height,
      lastY: clientY,
      fromIdx: lineIndex,
      curIdx: lineIndex,
      rafId: null,
    };
    // แสดงเลขบน ghost ทันทีที่เริ่ม drag
    _liveNums(_dragState);
    _startAutoScroll();
  }

  // ── cleanup — ทำงานเสมอไม่ว่าจะ cancel หรือ pointerup ──────────
  function _end(cancelled) {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    _ring(false);
    // detach global listeners — ใช้ตัวแปร ref เพราะ _detachGlobal อยู่ใน closure ด้านล่าง
    _detachGlobal();
    _pointerId = null;

    if (!_active) return;
    _active = false;

    // ล้าง ghost ที่ค้างอยู่ทั้งหมดในกรณี race condition
    document.querySelectorAll('.drag-ghost').forEach(g => g.remove());
    document.querySelectorAll('.line-wrap.dragging')
      .forEach(w => w.classList.remove('dragging'));
    document.querySelectorAll('.drop-target-above,.drop-target-below')
      .forEach(w => w.classList.remove('drop-target-above','drop-target-below'));

    _stopAutoScroll();
    _hideDropIndicator();
    document.body.style.userSelect = '';

    if (!_dragState) { renderNotation(); return; }

    const ds = _dragState;
    _dragState = null;

    if (cancelled) { renderNotation(); return; }

    // ── คำนวณ from / to จาก dataset.lineNum (state space) ทั้งคู่ ──────────────
    // DOM index ที่ _reorder เปลี่ยนระหว่าง drag ≠ state index เมื่อมี insert/delete
    // วิธีที่ถูกต้อง: อ่าน state index จาก dataset.lineNum ของ element เอง
    // และใช้ dataset.lineNum ของ DOM neighbors เพื่อ derive ตำแหน่งปลายทาง
    const root = ds.root;
    const wraps = Array.from(root.querySelectorAll('.line-wrap:not(.drag-ghost)'));

    // from: state index ของบรรทัดที่ถูกลาก (dataset.lineNum ไม่เปลี่ยนระหว่าง drag)
    const from = parseInt(ds.lineWrap.dataset.lineNum, 10) - 1; // 0-based

    // to: derive จาก dataset.lineNum ของ DOM neighbors หลัง drop
    // ใช้ neighbor แทน DOM index เพราะ DOM index ≠ state index เมื่อมี insert/delete
    const myDOMIdx = wraps.indexOf(ds.lineWrap);
    const totalLines = Math.round(state.numBars / BARS_PER_VAK);
    let to;
    if (myDOMIdx <= 0) {
      // หัวสุดของ DOM → ย้ายไป state index 0
      to = 0;
    } else if (myDOMIdx >= wraps.length - 1) {
      // ท้ายสุดของ DOM → ย้ายไป state index สุดท้าย
      to = totalLines - 1;
    } else {
      // อยู่กลาง: อ่าน state index จาก neighbor ที่ dataset.lineNum ยังถูกต้อง
      const prevStateIdx = parseInt(wraps[myDOMIdx - 1].dataset.lineNum, 10) - 1;
      const nextStateIdx = parseInt(wraps[myDOMIdx + 1].dataset.lineNum, 10) - 1;
      if (from < myDOMIdx) {
        // เลื่อนลง (from อยู่ก่อน myDOMIdx ใน DOM เดิม) → วางหลัง prev neighbor
        to = prevStateIdx;
      } else {
        // เลื่อนขึ้น (from อยู่หลัง myDOMIdx ใน DOM เดิม) → วางก่อน next neighbor
        to = nextStateIdx;
      }
    }

    to = Math.max(0, Math.min(totalLines - 1, to));

    if (from !== to) {
      moveLineToPosition(from, to);
      showToast(`ย้ายบรรทัดที่ ${from + 1} → ตำแหน่งที่ ${to + 1}`, 'success');
    } else {
      renderNotation();
    }
  }

  // ── pointer events ─────────────────────────────────────────────
  // ออกแบบแบบ "global capture" — move/up/cancel ผูกกับ window
  // เพื่อให้ ghost ตามนิ้วแม้ขยับออกนอก element

  handle.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    if (_active || _dragState) return;
    // ถ้า tap ลงบน .line-play-btn (อยู่ใน handle) → ปล่อยให้ click ทำงาน ไม่ติด ring
    if (e.target.closest('.line-play-btn')) return;

    _pointerId = e.pointerId;
    _startY = _lastY = e.clientY;
    _startX = e.clientX;
    _moved  = false;

    _ring(true);

    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      if (!_moved) _beginDrag(_lastY);
    }, _DRAG_LP_MS);

    // ผูก move/up/cancel บน window ทันที (global capture)
    window.addEventListener('pointermove',   _onMove, { passive: false });
    window.addEventListener('pointerup',     _onUp);
    window.addEventListener('pointercancel', _onCancel);

    e.stopPropagation();
    // ไม่ preventDefault บน pointerdown → ให้ click .line-play-btn ทำงาน
  }, { passive: true });

  function _onMove(e) {
    if (e.pointerId !== _pointerId) return;
    _lastY = e.clientY;

    const ady = Math.abs(e.clientY - _startY);
    const dx  = Math.abs(e.clientX - _startX);

    if (!_active) {
      if (ady > _DRAG_PX && ady > dx) {
        _moved = true;
        if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
        _beginDrag(e.clientY);
      } else if (dx > _DRAG_PX * 2 && dx > ady) {
        if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
        _ring(false);
      }
      return;
    }

    if (!_dragState) return;
    const ds = _dragState;
    ds.lastY = e.clientY;

    // ขยับ ghost ตามนิ้ว
    const newTop = Math.max(0, Math.min(
      _dragBottomLimit() - ds.placeholderH,
      ds.origTop + (e.clientY - ds.startY)
    ));
    ds.ghost.style.top = newTop + 'px';

    _reorder(ds);
    e.preventDefault();
  }

  function _onUp(e) {
    if (e.pointerId !== _pointerId) return;
    _end(false);
  }

  function _onCancel(e) {
    if (e.pointerId !== _pointerId) return;
    _end(true);
  }

  function _detachGlobal() {
    window.removeEventListener('pointermove',   _onMove);
    window.removeEventListener('pointerup',     _onUp);
    window.removeEventListener('pointercancel', _onCancel);
  }
}

// ── auto-scroll ────────────────────────────────────────────────────
const _REORDER_THROTTLE_MS = 80; // reorder DOM ไม่เกินทุก 80ms แม้ scroll เร็ว
function _startAutoScroll() {
  if (!_dragState || _dragState.rafId) return;
  let _lastReorderAt = 0;
  const tick = (now) => {
    if (!_dragState) return;
    const y  = _dragState.lastY;
    const vh = _dragBottomLimit();
    let spd  = 0;
    if (y < _ASCROLL_EDGE)        spd = -Math.ceil(((_ASCROLL_EDGE - y) / _ASCROLL_EDGE) * _ASCROLL_SPD);
    else if (y > vh-_ASCROLL_EDGE) spd =  Math.ceil(((y-(vh-_ASCROLL_EDGE))/_ASCROLL_EDGE) * _ASCROLL_SPD);
    if (spd !== 0) {
      const before = window.scrollY;
      window.scrollBy(0, spd);
      // throttle _reorder: scroll ทุก frame แต่ reorder DOM ไม่เกินทุก 80ms
      if (window.scrollY !== before && _dragState && (now - _lastReorderAt >= _REORDER_THROTTLE_MS)) {
        _lastReorderAt = now;
        _reorder(_dragState);
      }
    }
    _dragState.rafId = requestAnimationFrame(tick);
  };
  _dragState.rafId = requestAnimationFrame(tick);
}
function _stopAutoScroll() {
  if (_dragState && _dragState.rafId) { cancelAnimationFrame(_dragState.rafId); _dragState.rafId = null; }
}

// ── reorder: ย้าย DOM placeholder + update live line numbers ──────
function _reorder(ds) {
  const ghostCY  = parseFloat(ds.ghost.style.top) + ds.placeholderH / 2;
  const root     = ds.root;
  // query ทุกครั้ง เพราะ DOM อาจเปลี่ยนแล้ว
  const wraps    = Array.from(root.querySelectorAll('.line-wrap:not(.drag-ghost)'));
  const myDOMIdx = wraps.indexOf(ds.lineWrap);

  // หา targetDOMIdx: บรรทัดที่ ghostCenter ควรอยู่ก่อนหน้า
  let targetDOMIdx = myDOMIdx;
  for (let i = 0; i < wraps.length; i++) {
    if (wraps[i] === ds.lineWrap) continue;
    const r   = wraps[i].getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (i < myDOMIdx && ghostCY < mid) { targetDOMIdx = i; break; }
    if (i > myDOMIdx && ghostCY > mid) { targetDOMIdx = i; }
  }

  // clear indicators ก่อน
  wraps.forEach(w => w.classList.remove('drop-target-above','drop-target-below'));
  _hideDropIndicator();

  if (targetDOMIdx !== myDOMIdx) {
    // แสดง drop indicator
    if (targetDOMIdx < myDOMIdx) {
      _showDropIndicator(wraps[targetDOMIdx], true);
    } else {
      _showDropIndicator(wraps[targetDOMIdx], false);
    }

    // ย้าย placeholder พร้อม transition บรรทัดอื่น
    wraps.forEach(w => { if (w !== ds.lineWrap) w.classList.add('drag-anim'); });
    const ref = wraps[targetDOMIdx];
    if (targetDOMIdx > myDOMIdx) {
      root.insertBefore(ds.lineWrap, ref.nextSibling || null);
    } else {
      root.insertBefore(ds.lineWrap, ref);
    }
    ds.curIdx = targetDOMIdx;

    requestAnimationFrame(() =>
      root.querySelectorAll('.line-wrap.drag-anim').forEach(w => w.classList.remove('drag-anim'))
    );
  }

  // อัพเดตเลขหลัง insertBefore เพื่อให้สะท้อน DOM order ที่เปลี่ยนแล้ว
  _liveNums(ds);
}

function _liveNums(ds) {
  const wraps = Array.from(ds.root.querySelectorAll('.line-wrap:not(.drag-ghost)'));
  let secStartIdx = 0;
  let myDisplayNum = 1;

  wraps.forEach((w, i) => {
    const origLn = parseInt(w.dataset.lineNum, 10);
    if (state.sections && state.sections[origLn] !== undefined) secStartIdx = i;
    const displayNum = i - secStartIdx + 1;

    // อัพเดตเลขทุกบรรทัด (รวม placeholder ที่กำลังลาก)
    const numEl = w.querySelector('.line-num');
    if (numEl) numEl.textContent = displayNum;

    const repInp = w.querySelector('.repeat-target-input');
    if (repInp) {
      repInp.max = displayNum;
      if (parseInt(repInp.value, 10) > displayNum) repInp.value = displayNum;
    }

    if (w === ds.lineWrap) myDisplayNum = displayNum;
  });

  // ghost แสดงเลขเดียวกับ placeholder (ตำแหน่งที่จะถูกวาง)
  const ghostNumEl = ds.ghost.querySelector('.line-num');
  if (ghostNumEl) ghostNumEl.textContent = myDisplayNum;
}

// ===== patchNotation: อัพเดตเฉพาะ beat-cells ที่เปลี่ยนแปลง + cursor =====
// เรียกแทน renderNotation() ในกรณีที่โครงสร้าง DOM ไม่เปลี่ยน (กดโน้ต/เลื่อน cursor)
// หาก DOM ยังไม่มีหรือจำนวนบรรทัด/ห้องเปลี่ยน → fallback ไป renderNotation() ปกติ
let _patchPrevNotes = null; // snapshot ก่อนหน้า { right: [...], left: [...] }
let _patchPrevCursor = -2;  // cursorBeat ก่อนหน้า
let _patchPrevHand = null;  // hand ก่อนหน้า
let _patchPrevEditMode = null;
let _cursorScrollFrame = null;
let _pendingCursorElement = null;

function requestCursorScroll(element) {
  _pendingCursorElement = element;
  if (_cursorScrollFrame) return;
  _cursorScrollFrame = requestAnimationFrame(() => {
    _cursorScrollFrame = null;
    const target = _pendingCursorElement;
    _pendingCursorElement = null;
    if (!target || !target.isConnected) return;

    const rect = target.getBoundingClientRect();
    const padding = Math.min(120, Math.max(56, window.innerHeight * 0.16));
    let delta = 0;
    if (rect.top < padding) delta = rect.top - padding;
    else if (rect.bottom > window.innerHeight - padding) delta = rect.bottom - (window.innerHeight - padding);
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'smooth' });
  });
}

function patchNotation(changedBeats = null) {
  const root = document.getElementById('notation');
  // หากไม่มี DOM หรือจำนวนบรรทัดเปลี่ยน → rebuild เต็ม
  const expectedLines = Math.ceil(state.numBars / 8);
  if (!root || root.querySelectorAll('.line-wrap').length !== expectedLines) {
    renderNotation(); return;
  }
  if (!_beatCellMap || _beatCellMap.size === 0) { renderNotation(); return; }

  const cursorBeat = state.cursorBeat;
  const hand = state.hand;
  const editMode = state.isEditMode;
  const prev = _patchPrevNotes;

  // หา beats ที่เปลี่ยนค่า
  const dirtyBeats = new Set(changedBeats || []);

  // การแก้ไขปกติส่งตำแหน่งที่เปลี่ยนเข้ามาโดยตรง เพื่อไม่ต้องไล่ตรวจทุกโน้ต
  // ของเพลงยาวทุกครั้งที่พิมพ์หนึ่งตัว. เก็บการสแกนทั้งเพลงไว้เฉพาะ caller เก่า
  // ที่ไม่ได้ระบุตำแหน่ง เพื่อความเข้ากันได้.
  if (changedBeats === null && prev) {
    const total = state.notes.right.length;
    for (let i = 0; i < total; i++) {
      if (state.notes.right[i] !== prev.right[i] || state.notes.left[i] !== prev.left[i]) {
        dirtyBeats.add(i);
      }
    }
  }

  // เพิ่ม beats ที่ cursor เปลี่ยน (ต้อง repaint class edit-box)
  if (_patchPrevCursor !== cursorBeat) {
    if (_patchPrevCursor >= 0) dirtyBeats.add(_patchPrevCursor);
    if (cursorBeat >= 0) dirtyBeats.add(cursorBeat);
  }
  if (_patchPrevHand !== hand || _patchPrevEditMode !== editMode) {
    if (_patchPrevCursor >= 0) dirtyBeats.add(_patchPrevCursor);
    if (cursorBeat >= 0) dirtyBeats.add(cursorBeat);
  }

  // อัพเดต bar-cell active-room-box / edit-room-box class สำหรับ ห้องที่ cursor อยู่
  const prevBar = _patchPrevCursor >= 0 ? Math.floor(_patchPrevCursor / 4) : -1;
  const curBar  = cursorBeat >= 0 ? Math.floor(cursorBeat / 4) : -1;
  if (prevBar !== curBar) {
    // ลบ class จาก bar เก่า — ใช้ _beatCellMap แทน querySelectorAll ทั้งหน้า
    if (prevBar >= 0) {
      const prevRef = _beatCellMap.get(prevBar * 4);
      if (prevRef) {
        prevRef.forEach(c => {
          const bc = c.parentElement;
          if (bc && bc.classList.contains('bar-cell'))
            bc.classList.remove('active-room-box', 'edit-room-box');
        });
      }
    }
    // ใส่ class ให้ bar ใหม่ — ทำผ่าน querySelectorAll ครั้งเดียว
    if (curBar >= 0) {
      // หา bar-cell ที่ตรงกับ curBar: beat-cell แรกใน bar คือ curBar*4
      const refCell = _beatCellMap.get(curBar * 4);
      if (refCell) {
        refCell.forEach(c => {
          const bc = c.parentElement;
          if (bc && bc.classList.contains('bar-cell')) {
            bc.classList.remove('active-room-box', 'edit-room-box');
            if (state.isMultiSelectMode) { /* ไม่ใส่ */ }
            else if (editMode) bc.classList.add('edit-room-box');
            else bc.classList.add('active-room-box');
          }
        });
      }
    }
  } else if (prevBar === curBar && curBar >= 0 && _patchPrevEditMode !== editMode) {
    const refCell = _beatCellMap.get(curBar * 4);
    if (refCell) {
      refCell.forEach(c => {
        const bc = c.parentElement;
        if (bc && bc.classList.contains('bar-cell')) {
          bc.classList.remove('active-room-box', 'edit-room-box');
          if (!state.isMultiSelectMode) {
            if (editMode) bc.classList.add('edit-room-box');
            else bc.classList.add('active-room-box');
          }
        }
      });
    }
  }

  // repaint dirty beat-cells
  dirtyBeats.forEach(globalBeat => {
    const cells = _beatCellMap.get(globalBeat);
    if (!cells) return;
    cells.forEach(cell => {
      const h = cell.dataset.hand;
      const gongIdx = state.notes[h][globalBeat];
      // content
      if (gongIdx != null) {
        cell.innerHTML = noteHTML(gongIdx);
        cell.className = 'beat-cell ' + noteRange(gongIdx);
      } else {
        cell.textContent = '−';
        cell.className = 'beat-cell empty';
      }
      // cursor class
      if (h === hand && globalBeat === cursorBeat && editMode) {
        cell.classList.add('edit-box');
      }
    });
  });

  // อัปเดต snapshot เฉพาะช่องที่ caller แจ้ง แทนการ clone array ทั้งเพลงทุกคีย์.
  if (changedBeats !== null && _patchPrevNotes) {
    dirtyBeats.forEach(beat => {
      _patchPrevNotes.right[beat] = state.notes.right[beat];
      _patchPrevNotes.left[beat] = state.notes.left[beat];
    });
  } else if (changedBeats === null && dirtyBeats.size > 0) {
    _patchPrevNotes = { right: state.notes.right.slice(), left: state.notes.left.slice() };
  }
  _patchPrevCursor = cursorBeat;
  _patchPrevHand = hand;
  _patchPrevEditMode = editMode;

  // scroll cursor ให้ตามเสมอ — อ่านจาก _beatCellMap แทน querySelector ทั้ง DOM
  if (cursorBeat >= 0) {
    requestAnimationFrame(() => {
      const cells = _beatCellMap && _beatCellMap.get(cursorBeat);
      const cursorEl = cells && cells.find(c => c.dataset.hand === hand && (c.classList.contains('edit-box') || c.parentElement?.classList.contains('active-room-box')));
      if (cursorEl) cursorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  }
}

// เรียก patchNotation แทน renderNotation ใน hot-path (commitChord, insertRest, deleteAtCursor, moveCursorBy)
// renderNotation ยังคงถูกเรียกสำหรับการเปลี่ยนโครงสร้าง (insertLine, deleteLine, undo/redo ฯลฯ)

function renderNotation() {
  // invalidate patch snapshot เสมอเมื่อ rebuild เต็ม
  _patchPrevNotes = null; _patchPrevCursor = -2; _patchPrevHand = null; _patchPrevEditMode = null;
  _beatCellMap = null; // ป้องกัน patchNotation ใช้ map เก่าระหว่าง rebuild DOM
  _secStatsFP = null; // force updateSectionStats ให้ rebuild DOM ท่อนใหม่

  updateSectionStats(); // ต้องเรียกก่อน render เพื่อ build sectionLineMap และ stats UI
  const root = document.getElementById('notation');
  const frag = document.createDocumentFragment();
  const lines = Math.ceil(state.numBars / 8);
  if (!state.sections) state.sections = {};
  if (!state.lineLengths) state.lineLengths = {};
  
  let currentSectionStartLine = 1;

  for (let line = 0; line < lines; line++) {
    const startBar = line * 8; 
    const lineNum = line + 1;
    const barsInThisLine = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : 8;
    
    const lineWrap = document.createElement('div'); 
    lineWrap.className = 'line-wrap';
    lineWrap.dataset.lineNum = lineNum;

    if (state.sections[lineNum] !== undefined) {
         currentSectionStartLine = lineNum;
    }
    
    const thisSecStart = currentSectionStartLine; 
    const displayLineNum = lineNum - thisSecStart + 1;

    const secHeader = document.createElement('div'); secHeader.className = 'section-header';
    
    if (state.sections[lineNum] !== undefined) {
       const secName = state.sections[lineNum];
       if (state._editingSection === lineNum) {
           secHeader.innerHTML = `
              <input type="text" class="sec-input" id="secInp-${lineNum}" value="${_escHTML(secName)}" placeholder="ระบุชื่อท่อน...">
              <button class="btn-sec save-sec">บันทึก</button>
              <button class="btn-sec cancel-sec">ยกเลิก</button>
           `;
           setTimeout(() => { const inp = document.getElementById(`secInp-${lineNum}`); if (inp) { inp.focus(); inp.select(); } }, 10);
       } else {
           secHeader.innerHTML = `
              <div class="sec-title">${_escHTML(secName)}</div>
              <button class="btn-sec edit-sec">แก้ไขชื่อ</button>
              <button class="btn-sec del-sec">ลบ</button>
              <button class="btn-sec play-sec">เล่นท่อนนี้</button>
              <button class="btn-sec play-range-sec">เล่นเป็นช่วง</button>
           `;
       }
    } else {
       secHeader.innerHTML = `<button class="btn-sec add-sec">+ แทรกท่อน</button>`;
    }

    lineWrap.appendChild(secHeader);

    const pair = document.createElement('div'); pair.className = 'bar-pair'; 
    const vakLabelCol = document.createElement('div');
    vakLabelCol.className = 'vak-label-col';
    
    const vakLabel = document.createElement('div'); 
    vakLabel.className = 'vak-label';
    
    const isPlayingThisLine = state.isPlaying && state.playMode === 'line' && state.currentPlayingLine === lineNum;
    const btnIcon = isPlayingThisLine ? '■' : '▶';
    const btnClass = isPlayingThisLine ? 'line-play-btn stop-active' : 'line-play-btn';
    
    vakLabel.innerHTML = `
      <div class="${btnClass}">${btnIcon}</div>
      <div class="line-num">${displayLineNum}</div>
    `;
    
    const dragHandle = document.createElement('div');
    dragHandle.className = 'line-drag-handle';
    dragHandle.title = 'ลากเพื่อสลับตำแหน่งบรรทัด';
    dragHandle.innerHTML = '⠿';

    const lineActionBar = document.createElement('div');
    lineActionBar.className = 'line-action-bar';

    const insBtn = document.createElement('button');
    insBtn.className = 'btn-line';
    insBtn.title = 'แทรกบรรทัดใหม่ด้านล่าง';
    insBtn.textContent = '➕';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-line del';
    delBtn.title = 'ลบบรรทัดนี้';
    delBtn.textContent = '🗑';

    lineActionBar.appendChild(insBtn);
    lineActionBar.appendChild(delBtn);

    initLineDrag(vakLabel, lineWrap, line);

    vakLabelCol.appendChild(vakLabel);
    // dragHandle ซ่อนผ่าน CSS แล้ว — ไม่ append
    pair.appendChild(vakLabelCol);
    
    const rowsContainer = document.createElement('div'); 
    rowsContainer.className = 'bar-rows-container';
    
    if (state.selectedLine === lineNum) {
        rowsContainer.classList.add('selected-line');
    }
    if (state.isMultiLineMode && state.selectedLines.has(lineNum)) {
        rowsContainer.classList.add('multi-line-selected');
    }
    
    const activeHands = state.recordMode === 'one' ? ['right'] : ['right', 'left'];
    const showHandLabel = state.recordMode !== 'one'; // โหมดมือเดียวเหลือแถวเดียว ไม่ต้องระบุว่าเป็นมือไหน

    activeHands.forEach(hand => {
      const row = document.createElement('div'); row.className = 'bar-row ' + hand;
      const labelWidth = window.innerWidth <= 400 ? '24px' : '72px';
      const actionWidth = window.innerWidth <= 400 ? '24px' : '28px';
      // ทั้งสองแถวใช้ gridTemplateColumns เดียวกัน เพื่อให้กว้างเท่ากัน (ยกเว้นโหมดมือเดียวที่ไม่มีคอลัมน์ label)
      row.style.gridTemplateColumns = showHandLabel
        ? `${labelWidth} repeat(8, 1fr) ${actionWidth}`
        : `repeat(8, 1fr) ${actionWidth}`;

      if (showHandLabel) {
        const label = document.createElement('div');
        label.className = 'hand-label' + (hand === 'right' ? ' clickable' : '');
        label.textContent = hand === 'right' ? 'มือขวา' : 'มือซ้าย';

        if (hand === 'right') {
            label.title = 'แตะที่นี่เพื่อคัดลอก/วางบรรทัด';
        }

        row.appendChild(label);
      }

      for (let b = startBar; b < startBar + barsInThisLine; b++) {
        const barInLine = b - startBar + 1; 
        const barCell = document.createElement('div'); barCell.className = 'bar-cell'; barCell.title = `ห้อง ${barInLine}`;
        
        const roomKey = `${hand}:${b}`;
        const isActiveRoom = (state.cursorBeat !== -1 && Math.floor(state.cursorBeat / 4) === b);
        
        if (state.isMultiSelectMode && state.selectedRooms && state.selectedRooms.has(`${hand}:${b}`)) {
          barCell.classList.add('multi-selected-room-box');
        } else if (isActiveRoom && !state.isMultiSelectMode) {
          if (state.isEditMode) barCell.classList.add('edit-room-box');
          else barCell.classList.add('active-room-box');
        }

        for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
          const globalBeat = b * BEATS_PER_BAR + beat; const cell = document.createElement('div'); cell.className = 'beat-cell';
          const gongIdx = state.notes[hand][globalBeat];
          
          if (gongIdx != null) { cell.innerHTML = noteHTML(gongIdx); cell.classList.add(noteRange(gongIdx)); } 
          else { cell.textContent = '−'; cell.classList.add('empty'); }

          if (hand === state.hand && globalBeat === state.cursorBeat && state.isEditMode) {
            cell.classList.add('edit-box');
          }
          
          cell.dataset.beat = globalBeat; cell.dataset.hand = hand;
          barCell.appendChild(cell);
        }
        row.appendChild(barCell);
      }

      // ปุ่มแนวตั้ง ➕/🗑 ต่อจากห้องสุดท้าย เฉพาะแถวมือขวา / มือซ้ายใส่ spacer ให้กว้างเท่ากัน
      if (hand === 'right') {
        row.appendChild(lineActionBar);
      } else {
        const spacer = document.createElement('div');
        row.appendChild(spacer);
      }

      rowsContainer.appendChild(row);
    });
    
    const repeatCtrl = document.createElement('div'); repeatCtrl.className = 'line-repeat-controls';
    repeatCtrl.dataset.line = lineNum;
    repeatCtrl.dataset.secStart = thisSecStart;
    repeatCtrl.dataset.displayLine = displayLineNum;
    const isRepActive = state.repeats && state.repeats[lineNum] !== undefined; 
    let absRepTarget = isRepActive ? state.repeats[lineNum] : thisSecStart;
    let relRepTarget = absRepTarget - thisSecStart + 1;
    if (relRepTarget < 1) relRepTarget = 1;
    if (relRepTarget > displayLineNum) relRepTarget = 1;

    repeatCtrl.innerHTML = `
      <label><input type="checkbox" class="repeat-checkbox" ${isRepActive ? 'checked' : ''}>
        <span style="color:var(--text);">กลับต้นไปบรรทัดที่</span></label>
      <input type="number" class="repeat-target-input" min="1" max="${displayLineNum}" value="${relRepTarget}" ${!isRepActive ? 'disabled' : ''}>
    `;

    rowsContainer.appendChild(repeatCtrl);
    pair.appendChild(rowsContainer); 
    lineWrap.appendChild(pair);
    frag.appendChild(lineWrap);
  }

  // flush ทีเดียว — ลด reflow
  root.innerHTML = '';
  root.appendChild(frag);

  const tkRest = document.getElementById('tkRest');
  if (tkRest) {
    tkRest.textContent = '− หยุด'; tkRest.classList.add('rest'); tkRest.classList.remove('enter');
  }
  
  // rebuild lookup caches
  _buildBeatCellMap();
  _currentBeatCells = [];

  // อัพเดต patch snapshot หลัง rebuild เต็ม
  _patchPrevNotes = { right: state.notes.right.slice(), left: state.notes.left.slice() };
  _patchPrevCursor = state.cursorBeat;
  _patchPrevHand = state.hand;
  _patchPrevEditMode = state.isEditMode;
}
