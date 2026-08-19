// ===== ui-panels.js: toast, context menu, touch keyboard, quick nav =====

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');

  // ยกเลิก timer ของ toast เดิม (ถ้ามี) และล้าง toast เก่าออกทันที
  // เพื่อไม่ให้ toast ใหม่ซ้อนต่อกันเป็นแถวๆ — ให้เห็นทีละอันเท่านั้น
  if (showToast._timeoutId) clearTimeout(showToast._timeoutId);
  if (showToast._removeId) clearTimeout(showToast._removeId);
  container.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'error' ? '✕ ' : type === 'success' ? '✓ ' : '';
  toast.textContent = icon + message;
  container.appendChild(toast);
  
  requestAnimationFrame(() => toast.classList.add('show'));
  
  showToast._timeoutId = setTimeout(() => {
    toast.classList.remove('show');
    showToast._removeId = setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function hideCellMenus() {
  document.getElementById('cellActionMenu')?.classList.add('hidden');
  document.getElementById('cellEditMenu')?.classList.add('hidden');
  document.getElementById('lineActionMenu')?.classList.add('hidden');
  if (state.isMultiLineMode) {
    state.isMultiLineMode = false;
    state.selectedLines = new Set();
    document.getElementById('multiLineActionMenu')?.classList.add('hidden');
  }
}

function positionMenuForCell(menu) {
  if (!menu || state.cursorBeat === -1) return;
  const pasteBtn = document.getElementById('camPaste');
  if (pasteBtn) pasteBtn.disabled = !customClipboard || customClipboard.type === 'line';

  requestAnimationFrame(() => {
      const _cells = _beatCellMap && _beatCellMap.get(state.cursorBeat);
      const cell = _cells && _cells.find(c => c.dataset.hand === state.hand);
      if (!cell) return;
      
      const rect = cell.getBoundingClientRect();
      // วางเมนูนอก "ทั้งบรรทัด" แทนการวางชิดช่องที่กด เพื่อไม่ให้เมนูบังโน้ต
      // หรือห้องอื่นในตารางเดียวกัน โดยเฉพาะเมื่อใช้งานบนจอเล็ก
      const lineRect = cell.closest('.line-wrap')?.getBoundingClientRect() || rect;
      const menuWidth = menu.offsetWidth || 280;
      let menuX = rect.left + rect.width / 2;
      
      if (menuX - menuWidth / 2 < 10) menuX = menuWidth / 2 + 10;
      if (menuX + menuWidth / 2 > window.innerWidth - 10) menuX = window.innerWidth - menuWidth / 2 - 10;

      const menuHeight = menu.offsetHeight || 100;
      let topPx = lineRect.bottom + 10;
      let belowMenu = false;

      const kbEl = document.getElementById('touchKeyboard');
      const kbTop = kbEl ? kbEl.getBoundingClientRect().top : window.innerHeight;
      // ถ้าด้านล่างไม่พอ ให้ย้ายไปไว้เหนือทั้งบรรทัด; ทั้งสองตำแหน่งจะไม่ทับแถวโน้ตที่เลือก
      if (topPx + menuHeight > kbTop - 10) {
          topPx = lineRect.top - 10 - menuHeight;
          belowMenu = true;
      }
      // กรณีพื้นที่แนวตั้งคับมาก: ยึดใน viewport โดยยังเว้นขอบไว้
      if (topPx < 10) {
          topPx = 10;
      }

      menu.classList.toggle('menu-below', belowMenu);
      menu.style.left = menuX + 'px';
      menu.style.top  = topPx + 'px';
      menu.classList.remove('hidden');
  });
}

function positionLineMenu(clientX, clientY) {
  const menu = document.getElementById('lineActionMenu');
  if (!menu) return;
  const pasteBtn = document.getElementById('lamPaste');
  if (pasteBtn) pasteBtn.disabled = !customClipboard || customClipboard.type !== 'line';

  requestAnimationFrame(() => {
      const menuWidth = menu.offsetWidth || 240;
      let menuX = clientX;
      
      if (menuX - menuWidth / 2 < 10) menuX = menuWidth / 2 + 10;
      if (menuX + menuWidth / 2 > window.innerWidth - 10) menuX = window.innerWidth - menuWidth / 2 - 10;

      let topPx = clientY - 10 - menu.offsetHeight;
      let belowMenu = false;

      if (topPx < 60) {
          belowMenu = true;
          topPx = clientY + 14;
      }

      menu.classList.toggle('menu-below', belowMenu);
      menu.style.left = menuX + 'px';
      menu.style.top  = topPx + 'px';
      menu.classList.remove('hidden');
  });
}

function initTouchKeyboard() {
  const kb = document.getElementById('touchKeyboard'); if (!kb) return;
  const modState = { tab: false, shift: false, up: false, down: false };
  const modIds = { tab: 'tkModTab', shift: 'tkModShift', up: 'tkModUp', down: 'tkModDown' };
  const bannerMessages = { none: 'แตะปุ่มด้านบนค้างไว้ แล้วกดโน้ต', tab: 'โหมด คู่ 8 — โน้ตต่ำ → มือซ้าย · โน้ตสูง → มือขวา', shift: 'โหมด คู่ 4 — ลงโน้ตคู่ 4 ทั้งสองมืออัตโนมัติ', up: 'โหมด ↑ มือขวา — โน้ตทุกตัวลงมือขวาเท่านั้น', down: 'โหมด ↓ มือซ้าย — โน้ตทุกตัวลงมือซ้ายเท่านั้น' };

  const tkToggleBtn = document.getElementById('tkToggleBtn');
  let isKbCollapsed = false;

  function updateKbHeight() {
    if (!isKbCollapsed) {
      const h = kb.offsetHeight;
      if (h > 0) document.body.style.setProperty('--kb-height', h + 'px');
    }
  }

  requestAnimationFrame(() => { requestAnimationFrame(updateKbHeight); });
  window.addEventListener('resize', updateKbHeight);

  const tkCollapsedStop = document.getElementById('tkCollapsedStop');
  const kbSpacer = document.getElementById('kbSpacer');
  if (tkToggleBtn) {
      tkToggleBtn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          isKbCollapsed = !isKbCollapsed;
          if (isKbCollapsed) {
              kb.classList.add('collapsed');
              tkToggleBtn.textContent = '▲ แสดง';
              if (tkCollapsedStop) tkCollapsedStop.style.display = 'flex';
              if (kbSpacer) kbSpacer.classList.add('collapsed');
          } else {
              kb.classList.remove('collapsed');
              tkToggleBtn.textContent = '▼ ซ่อน';
              if (tkCollapsedStop) tkCollapsedStop.style.display = 'none';
              if (kbSpacer) kbSpacer.classList.remove('collapsed');
              requestAnimationFrame(() => { requestAnimationFrame(updateKbHeight); });
          }
      });
  }
  if (tkCollapsedStop) {
      tkCollapsedStop.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          stopPlayback(true);
      });
  }

  document.getElementById('tkPlayMain')?.addEventListener('pointerdown', (e) => { e.preventDefault(); startPlayback(); });
  document.getElementById('tkStopMain')?.addEventListener('pointerdown', (e) => { e.preventDefault(); stopPlayback(true); });
  document.getElementById('tkUndoBtn')?.addEventListener('pointerdown', (e) => { e.preventDefault(); performUndo(); });
  document.getElementById('tkRedoBtn')?.addEventListener('pointerdown', (e) => { e.preventDefault(); performRedo(); });

  function getActiveModKey() { if (modState.tab) return 'tab'; if (modState.shift) return 'shift'; if (modState.up) return 'up'; if (modState.down) return 'down'; return 'none'; }
  function updateModUI() {
    const active = getActiveModKey(); const banner = document.getElementById('tkModeBanner');
    if (banner) { banner.textContent = bannerMessages[active]; banner.className = 'tk-mode-banner' + (active !== 'none' ? ` active-${active}` : ''); }
    tabHeld = modState.tab; shiftHeld = modState.shift; arrowUpHeld = modState.up; arrowDownHeld = modState.down;
  }
  function toggleMod(key) {
    const wasOn = modState[key]; Object.keys(modState).forEach(k => { modState[k] = false; }); modState[key] = !wasOn;
    Object.entries(modIds).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.classList.toggle('active', modState[k]); });
    updateModUI();
  }

  Object.entries(modIds).forEach(([key, id]) => { const btn = document.getElementById(id); if (!btn) return; btn.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleMod(key); }); });
  kb.querySelectorAll('.tk-note').forEach(btn => { btn.addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); const idx = parseInt(btn.dataset.idx); typeNote(idx); }); });

  document.getElementById('tkRest').addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); insertRest(); });
  document.getElementById('tkDel').addEventListener('pointerdown', (e) => { e.preventDefault(); deleteAtCursor(); });
  document.getElementById('tkLeft').addEventListener('pointerdown', (e) => { e.preventDefault(); moveCursorBy(-1); });
  document.getElementById('tkRight').addEventListener('pointerdown', (e) => { e.preventDefault(); moveCursorBy(+1); });
  document.getElementById('tkEnter').addEventListener('pointerdown', (e) => { e.preventDefault(); appendNewVak(); });
}

function renderImeInfographic() {
  const target = document.getElementById('imeInfographic');
  if (!target) return;

  // ระนาดเอก: ผังคีย์ของตัวเอง ไม่ตรงกับ CODE_MAP_MASTER ทั่วไปของฆ้อง
  if (currentInstrument === 'ranatek') {
    const inst = getActiveInst();
    const rowDefs = [
        { label: 'สูง',    idxs: [17,18,19,20,21] },
        { label: 'กลาง',   idxs: [10,11,12,13,14,15,16] },
        { label: 'ต่ำ',    idxs: [3,4,5,6,7,8,9] },
        { label: 'ต่ำสุด', idxs: [0,1,2] }
    ];
    let html = '<div style="font-size:12px; margin-bottom:12px; color:var(--accent); font-weight:600;">ผังปุ่มกดบนคีย์บอร์ดคอมพิวเตอร์ (ระนาดเอก)</div>';
    rowDefs.forEach(({label, idxs}) => {
        html += `<div class="ime-row">`;
        idxs.forEach(idx => {
            const rangeClass = inst.getNoteRange(idx);
            const key = inst.keyLabels[idx];
            html += `<div class="ime-key ${rangeClass}">
                        <span class="ime-char">${key}</span>
                        <span class="ime-note">${inst.display[idx]}</span>
                     </div>`;
        });
        html += '</div>';
    });
    target.innerHTML = html;
    return;
  }

  const CODE_MAP_MASTER = {
    'Q':'ดํ', 'W':'รํ', 'E':'มํ', 'R':'ฟํ', 'T':'ซํ', 'Y':'ลํ', 'U':'ทํ',
    'A':'ด', 'S':'ร', 'D':'ม', 'F':'ฟ', 'G':'ซ', 'H':'ล', 'J':'ท',
    'Z':'ดฺ', 'X':'รฺ', 'C':'มฺ', 'V':'ฟฺ', 'B':'ซฺ', 'N':'ลฺ', 'M':'ทฺ'
  };

  const rows = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
  ];

  const inst = getActiveInst();
  
  let html = '<div style="font-size:12px; margin-bottom:12px; color:var(--accent); font-weight:600;">ผังปุ่มกดบนคีย์บอร์ดคอมพิวเตอร์<br><span style="color:var(--muted); font-weight:400; font-size:11px;">(ตัวโน้ตที่ไม่มีในเครื่องดนตรีที่กำลังเลือก จะถูกปิดการใช้งาน)</span></div>';
  
  rows.forEach((row, ri) => {
      let offset = ri === 1 ? '12px' : ri === 2 ? '24px' : '0px';
      html += `<div class="ime-row" style="padding-left: ${offset};">`;
      row.forEach(k => {
          const noteStr = CODE_MAP_MASTER[k];
          const idx = inst.display.indexOf(noteStr);
          const isActive = idx !== -1;
          const rangeClass = isActive ? inst.getNoteRange(idx) : 'disabled';
          
          html += `<div class="ime-key ${rangeClass}">
                      <span class="ime-char">${k}</span>
                      <span class="ime-note">${noteStr}</span>
                   </div>`;
      });
      html += '</div>';
  });
  target.innerHTML = html;
}


// ===== AssistiveTouch-style Quick Nav =====
function initQuickNav() {
  const nav            = document.getElementById('quickNav');
  const navBtn         = document.getElementById('qnavToggle');
  const icon           = document.getElementById('qnavIcon');
  const tooltip        = document.getElementById('qnavTooltip');
  const overlay        = document.getElementById('gongPopupOverlay');
  const popupStage     = document.getElementById('gongPopupStage');
  const closeBtn       = document.getElementById('gongPopupClose');
  const stageContainer = document.getElementById('gongStageContainer');

  let isOpen = false;

  // ── ตำแหน่ง ──────────────────────────────────────────────────────
  const POS_KEY  = 'qnavPos2'; // key ใหม่ (format เปลี่ยน)
  const BTN_SIZE = 52;         // ต้องตรงกับ CSS width/height
  const EDGE_GAP = 10;         // ระยะห่างจากขอบจอหลัง snap

  // อ่าน/บันทึกตำแหน่งแบบ normalized (0–1) เพื่อรองรับหลาย resolution
  function loadPos() {
    try {
      const s = JSON.parse(localStorage.getItem(POS_KEY));
      if (s && typeof s.rx === 'number') return s;
    } catch(e) {}
    return null;
  }
  function savePos() {
    try {
      const cx = parseFloat(nav.style.left) + BTN_SIZE / 2;
      const cy = parseFloat(nav.style.top)  + BTN_SIZE / 2;
      localStorage.setItem(POS_KEY, JSON.stringify({
        rx: cx / window.innerWidth,
        ry: cy / window.innerHeight
      }));
    } catch(e) {}
  }

  // set ตำแหน่ง top-left ของ nav element พร้อม clamp
  function applyPos(x, y) {
    const maxX = window.innerWidth  - BTN_SIZE - EDGE_GAP;
    const maxY = window.innerHeight - BTN_SIZE - EDGE_GAP;
    x = Math.max(EDGE_GAP, Math.min(maxX, x));
    y = Math.max(EDGE_GAP, Math.min(maxY, y));
    nav.style.right     = 'auto';
    nav.style.transform = 'none';
    nav.style.left      = x + 'px';
    nav.style.top       = y + 'px';
    updateTooltipSide(x);
  }

  // snap ปุ่มเข้าขอบซ้ายหรือขวาที่ใกล้ที่สุด (เหมือน AssistiveTouch)
  function snapToEdge() {
    const x = parseFloat(nav.style.left) || 0;
    const cx = x + BTN_SIZE / 2;
    const snapX = cx < window.innerWidth / 2
      ? EDGE_GAP
      : window.innerWidth - BTN_SIZE - EDGE_GAP;
    // เปิด transition ก่อน snap แล้วปิดทีหลัง
    nav.classList.remove('at-dragging');
    applyPos(snapX, parseFloat(nav.style.top) || 0);
    savePos();
  }

  // tooltip อยู่ซ้ายหรือขวาของปุ่ม ขึ้นอยู่กับตำแหน่งปุ่ม
  function updateTooltipSide(x) {
    const cx = x + BTN_SIZE / 2;
    if (cx < window.innerWidth / 2) {
      tooltip.classList.add('tip-right');
    } else {
      tooltip.classList.remove('tip-right');
    }
  }

  // ตั้งตำแหน่งเริ่มต้น
  function initPos() {
    const saved = loadPos();
    if (saved) {
      const x = saved.rx * window.innerWidth  - BTN_SIZE / 2;
      const y = saved.ry * window.innerHeight - BTN_SIZE / 2;
      nav.classList.add('at-dragging'); // ปิด transition ชั่วคราว
      applyPos(x, y);
      requestAnimationFrame(() => nav.classList.remove('at-dragging'));
    } else {
      // default: ขวากลาง
      nav.classList.add('at-dragging');
      applyPos(
        window.innerWidth  - BTN_SIZE - EDGE_GAP,
        window.innerHeight / 2 - BTN_SIZE / 2
      );
      requestAnimationFrame(() => nav.classList.remove('at-dragging'));
    }
  }

  // ── Idle Fade (จางหลัง 4 วินาที ไม่มีกิจกรรม) ─────────────────────
  let _idleTimer = null;
  function resetIdle() {
    nav.classList.remove('at-idle');
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
      if (!isOpen) nav.classList.add('at-idle');
    }, 4000);
  }
  resetIdle();
  // ทุกครั้งที่มีปฏิสัมพันธ์กับหน้าเว็บ → reset idle
  ['pointerdown','keydown','scroll'].forEach(ev =>
    document.addEventListener(ev, resetIdle, { passive: true })
  );

  // ── Drag ──────────────────────────────────────────────────────────
  let _dragging  = false;
  let _startPX   = 0, _startPY   = 0;   // pointer start
  let _origLeft  = 0, _origTop   = 0;   // nav start
  let _dragMoved = false;
  let _pointerId = null;

  navBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    navBtn.setPointerCapture(e.pointerId);
    _pointerId = e.pointerId;
    _startPX   = e.clientX;
    _startPY   = e.clientY;
    _origLeft  = parseFloat(nav.style.left)  || 0;
    _origTop   = parseFloat(nav.style.top)   || 0;
    _dragging  = true;
    _dragMoved = false;
    nav.classList.add('at-dragging');
    nav.classList.remove('at-idle');
    clearTimeout(_idleTimer);
  });

  navBtn.addEventListener('pointermove', (e) => {
    if (!_dragging) return;
    const dx = e.clientX - _startPX;
    const dy = e.clientY - _startPY;
    if (!_dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) _dragMoved = true;
    if (_dragMoved) applyPos(_origLeft + dx, _origTop + dy);
  });

  navBtn.addEventListener('pointerup', (e) => {
    if (!_dragging) return;
    _dragging = false;
    if (_dragMoved) {
      // snap ไปขอบ แล้วบันทึก
      snapToEdge();
    } else {
      // เป็นการ tap → toggle popup
      nav.classList.remove('at-dragging');
      isOpen ? closePopup() : openPopup();
    }
    resetIdle();
  });

  navBtn.addEventListener('pointercancel', () => {
    if (!_dragging) return;
    _dragging = false;
    if (_dragMoved) snapToEdge();
    else nav.classList.remove('at-dragging');
    resetIdle();
  });

  // reposition + re-snap เมื่อ resize จริง (หมุนจอ/เปลี่ยน resolution) เท่านั้น
  // ไม่ทำเมื่อแค่ innerHeight เปลี่ยนจาก URL bar ของเบราว์เซอร์หด/ขยายตอน scroll บนมือถือ
  // (เพราะ innerWidth จะไม่เปลี่ยนในกรณีนั้น ต่างจากการหมุนจอที่ innerWidth เปลี่ยนเสมอ)
  let _lastInnerWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === _lastInnerWidth) return; // แค่ innerHeight เปลี่ยน → ไม่ต้อง reposition
    _lastInnerWidth = window.innerWidth;

    if (!nav.style.left || nav.style.left === 'auto') return;
    // snap ใหม่ตาม ratio เดิม
    const saved = loadPos();
    if (saved) {
      nav.classList.add('at-dragging');
      applyPos(
        saved.rx * window.innerWidth  - BTN_SIZE / 2,
        saved.ry * window.innerHeight - BTN_SIZE / 2
      );
      requestAnimationFrame(() => nav.classList.remove('at-dragging'));
    } else {
      snapToEdge();
    }
  });

  // ── Popup ─────────────────────────────────────────────────────────
  function openPopup() {
    if (isOpen) return;
    isOpen = true;

    const stage = document.getElementById('gong-stage');
    if (stage) popupStage.appendChild(stage);

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => { layoutGongs(); _rebuildGongCache(); }, 320);

    icon.textContent    = '✏️';
    tooltip.textContent = 'กลับบรรทัดที่บันทึก';
    navBtn.classList.add('return-mode');
    nav.classList.remove('at-idle');

    const popupLabel = document.getElementById('gongPopupLabel');
    if (popupLabel) popupLabel.textContent = `👁️ ดู${getActiveInst().name} — แตะลูก${getActiveInst().name}เพื่อเล่น`;
  }

  function closePopup() {
    if (!isOpen) return;
    isOpen = false;

    const stage = popupStage.querySelector('#gong-stage');
    if (stage && stageContainer) stageContainer.appendChild(stage);

    overlay.classList.remove('active');
    document.body.style.overflow = '';

    setTimeout(() => { layoutGongs(); _rebuildGongCache(); }, 50);

    icon.textContent    = '👁️';
    tooltip.textContent = `ไปดู${getActiveInst().name}`;
    navBtn.classList.remove('return-mode');

    const _cc = _beatCellMap && _beatCellMap.get(state.cursorBeat);
    const cursorCell = _cc && _cc.find(c => c.dataset.hand === state.hand);
    if (cursorCell) {
      cursorCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cursorCell.style.outline = '3px solid var(--gold)';
      setTimeout(() => { cursorCell.style.outline = ''; }, 800);
    }
    resetIdle();
  }

  closeBtn.addEventListener('click', closePopup);

  // ── Init ──────────────────────────────────────────────────────────
  requestAnimationFrame(initPos);
}
