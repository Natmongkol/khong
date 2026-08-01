// ===== init.js: DOM event bindings / app bootstrap =====
// เดิม init() ยาว ~1,100 บรรทัดในฟังก์ชันเดียว แยกเป็นฟังก์ชันย่อยตามหน้าที่ เพื่อให้อ่าน/แก้ง่ายขึ้น
// (เนื้อโค้ดเดิมทั้งหมดคงไว้เหมือนเดิม แค่ห่อเป็นฟังก์ชันแยกแล้วเรียกจาก init())

function init() {
  ensureCapacity();
  try { renderGongs(); } catch(e) { console.error('renderGongs() failed:', e); showToast('โหลดหน้าตาฆ้องไม่สำเร็จ: ' + e.message, 'error'); }
  try { renderNotation(); } catch(e) { console.error('renderNotation() failed:', e); showToast('โหลดโน้ตไม่สำเร็จ: ' + e.message, 'error'); }
  try { initTouchKeyboard(); } catch(e) { console.error('initTouchKeyboard() failed:', e); showToast('โหลดคีย์บอร์ดไม่สำเร็จ: ' + e.message, 'error'); }
  initSaveSystem();
  updatePageTitle(); 
  updateUndoUI(); 
  renderImeInfographic();

  initTopControls();
  initExportImportMenus();
  initFocusMode();
  initCellAndLineMenus();
  initNotationDelegation();
  initGlobalPointerAndKeyboard();
}

// ── ชื่อเพลง, bpm, จำนวนวรรค, record toggle, play/stop/undo/redo, modal สลับเครื่อง/ล้าง/เล่นช่วง ──
function initTopControls() {
  document.getElementById('songName').addEventListener('input', (e) => { 
    state.songName = e.target.value; 
    updatePageTitle();
    scheduleAutosave();
  });
  
  document.getElementById('bpm').addEventListener('input', (e) => { 
    state.bpm = Math.max(30, Math.min(300, +e.target.value || 200)); 
    scheduleAutosave();
  });
  // เมื่อพิมพ์เสร็จ (blur) ให้ปรับตัวเลขในช่องให้ตรงกับค่าที่ clamp แล้วจริงๆ กันช่องโชว์ค่าที่เกินขอบเขต (เช่น 500) ทั้งที่เพลงเล่นที่ 300
  document.getElementById('bpm').addEventListener('blur', (e) => {
    if (+e.target.value !== state.bpm) e.target.value = state.bpm;
  });
  
  document.getElementById('numVak').addEventListener('change', (e) => {
    const vaks = Math.max(1, Math.min(MAX_VAKS, Math.round(+e.target.value || 1)));
    e.target.value = vaks;
    pushUndo(); state.numBars = vaks * BARS_PER_VAK; ensureCapacity(); renderNotation();
  });

  const recTog = document.getElementById('recordToggle');
  recTog.addEventListener('click', () => { state.isRecording = !state.isRecording; recTog.classList.toggle('on', state.isRecording); recTog.setAttribute('aria-checked', state.isRecording); renderNotation(); });

  document.getElementById('playBtn').addEventListener('click', startPlayback);
  document.getElementById('stopBtn').addEventListener('click', () => stopPlayback(true));
  
  document.getElementById('undoBtn').addEventListener('click', performUndo);
  document.getElementById('redoBtn').addEventListener('click', performRedo);
  
  document.getElementById('cancelSwitchBtn').addEventListener('click', () => {
    document.getElementById('switchInstModal').classList.remove('show');
    pendingInstrument = null;
  });

  document.getElementById('confirmSwitchBtn').addEventListener('click', () => {
    document.getElementById('switchInstModal').classList.remove('show');
    if (pendingInstrument) {
        pushUndo();
        state.numBars = BARS_PER_VAK;
        document.getElementById('numVak').value = 1;
        state.notes.right = new Array(32).fill(null);
        state.notes.left = new Array(32).fill(null);
        state.lineLengths = {};
        state.sections = {};
        state.repeats = {};
        state.cursorBeat = 0;
        state.currentBeat = -1;
        state.selectedLine = null;
        ensureCapacity();
        
        switchInstrument(pendingInstrument);
        pendingInstrument = null;
    }
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    document.getElementById('clearConfirmModal').classList.add('show');
  });
  document.getElementById('cancelClearBtn').addEventListener('click', () => {
    document.getElementById('clearConfirmModal').classList.remove('show');
  });
  document.getElementById('confirmClearBtn').addEventListener('click', () => {
    document.getElementById('clearConfirmModal').classList.remove('show');
    pushUndo();
    state.numBars = BARS_PER_VAK;
    document.getElementById('numVak').value = 1;
    state.notes.right = new Array(32).fill(null);
    state.notes.left = new Array(32).fill(null);
    state.lineLengths = {};
    state.sections = {};
    state.repeats = {};
    state.cursorBeat = 0;
    state.currentBeat = -1;
    state.selectedLine = null;
    ensureCapacity();
    renderNotation();
    showToast('ล้างตารางเรียบร้อย');
  });

  document.getElementById('cancelPlayRangeBtn').addEventListener('click', () => {
    document.getElementById('playRangeModal').classList.remove('show');
  });
  document.getElementById('confirmPlayRangeBtn').addEventListener('click', () => {
    document.getElementById('playRangeModal').classList.remove('show');
    
    let sIdx = parseInt(document.getElementById('prStartSel').value) || 1;
    let eIdx = parseInt(document.getElementById('prEndSel').value) || sectionLineMap.length;
    
    if (sIdx < 1) sIdx = 1;
    if (sIdx > sectionLineMap.length) sIdx = sectionLineMap.length;
    if (eIdx < sIdx) eIdx = sIdx;
    if (eIdx > sectionLineMap.length) eIdx = sectionLineMap.length;

    if (sectionLineMap.length > 0) {
        playSectionRange(sectionLineMap[sIdx - 1], sectionLineMap[eIdx - 1]);
    }
  });
}

// ── เมนู Export/Import (JSON/TXT/PDF/MP3) และปุ่มคู่มือ ──
function initExportImportMenus() {
  const exportMainBtn = document.getElementById('exportMainBtn');
  const exportMenu = document.getElementById('exportMenu');

  exportMainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('show');
  });

  const importMainBtn = document.getElementById('importMainBtn');
  const importMenu = document.getElementById('importMenu');

  if(importMainBtn) {
    importMainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      importMenu.classList.toggle('show');
    });
  }

  document.addEventListener('click', (e) => {
    if (exportMenu && !exportMenu.contains(e.target) && e.target !== exportMainBtn) {
      exportMenu.classList.remove('show');
    }
    if (importMenu && !importMenu.contains(e.target) && e.target !== importMainBtn) {
      importMenu.classList.remove('show');
    }
  });

  // Export MP3 Modal Logic
  document.getElementById('exportMenuMp3').addEventListener('click', () => { 
      exportMenu.classList.remove('show'); 
      sectionLineMap = Object.keys(state.sections || {}).map(Number).sort((a,b)=>a-b);
      if (!sectionLineMap.includes(1)) sectionLineMap.unshift(1); 
      
      const startSelect = document.getElementById('exMp3StartSel');
      const endSelect = document.getElementById('exMp3EndSel');
      startSelect.innerHTML = '';
      endSelect.innerHTML = '';
      
      if (sectionLineMap.length === 0) {
          const opt1 = new Option('ท่อนที่ 1', '1');
          const opt2 = new Option('ท่อนที่ 1', '1');
          startSelect.add(opt1); endSelect.add(opt2);
      } else {
          sectionLineMap.forEach((lineNum, idx) => {
              const secName = (state.sections && state.sections[lineNum]) ? state.sections[lineNum] : `ท่อนที่ ${idx+1}`;
              startSelect.add(new Option(secName, idx + 1));
              endSelect.add(new Option(secName, idx + 1));
          });
      }
      
      endSelect.value = sectionLineMap.length > 0 ? sectionLineMap.length : 1;
      
      document.getElementById('exportMp3Modal').classList.add('show');
  });

  document.getElementById('confirmExportMp3Btn').addEventListener('click', () => {
      let sIdx = parseInt(document.getElementById('exMp3StartSel').value) || 1;
      let eIdx = parseInt(document.getElementById('exMp3EndSel').value) || sectionLineMap.length;
      if (sIdx < 1) sIdx = 1;
      if (sIdx > sectionLineMap.length) sIdx = sectionLineMap.length;
      if (eIdx < sIdx) eIdx = sIdx;
      if (eIdx > sectionLineMap.length) eIdx = sectionLineMap.length;
      
      if (sectionLineMap.length > 0) {
          const startLine = sectionLineMap[sIdx - 1];
          const endLine   = sectionLineMap[eIdx - 1];
          const exportSeq = buildSequenceForRange(startLine, endLine);
          
          let sName = (state.sections && state.sections[startLine]) ? state.sections[startLine] : `Part${sIdx}`;
          let eName = (state.sections && state.sections[endLine])   ? state.sections[endLine]   : `Part${eIdx}`;
          sName = sName.replace(/[\/\\?%*:|"<> ]/g, ''); 
          eName = eName.replace(/[\/\\?%*:|"<> ]/g, '');
          
          let suffix = '';
          if (sIdx === eIdx) {
              suffix = `_(${sName})`;
          } else {
              suffix = `_(${sName}_ถึง_${eName})`;
          }
          
          exportMP3(exportSeq, suffix);
      } else {
          exportMP3(); 
      }
  });

  document.getElementById('cancelExportMp3Btn').addEventListener('click', () => {
      if (!isExporting) document.getElementById('exportMp3Modal').classList.remove('show');
  });

  document.getElementById('exportMp3FullBtn').addEventListener('click', () => {
      exportMP3();
  });

  document.getElementById('exportMenuJson').addEventListener('click', () => { exportMenu.classList.remove('show'); exportNotation(); });
  document.getElementById('exportMenuTxt').addEventListener('click', () => { exportMenu.classList.remove('show'); exportText(); });
  document.getElementById('exportMenuPdf').addEventListener('click', () => { exportMenu.classList.remove('show'); exportPDF(); });

  document.getElementById('importJsonBtn').addEventListener('click', () => {
     if(importMenu) importMenu.classList.remove('show');
     executeImport('json');
  });
  document.getElementById('importTxtBtn').addEventListener('click', () => {
     if(importMenu) importMenu.classList.remove('show');
     executeImport('txt');
  });
  
  const toggleWrap = document.getElementById('toggleManualWrap');
  if(toggleWrap) {
      toggleWrap.addEventListener('click', () => {
          const content = document.getElementById('manualContent');
          const btn = document.getElementById('toggleManualBtn');
          if(content.style.display === 'none') {
             content.style.display = 'block';
             btn.textContent = '📖 คู่มือ ▲';
          } else {
             content.style.display = 'none';
             btn.textContent = '📖 คู่มือ ▼';
          }
      });
  }
}

// ── โหมดรับชม (Focus Mode): auto-hide UI, ปุ่มควบคุม, seek bar ──
function initFocusMode() {
  // ===== Auto-hide UI (header + controls) ในโหมดรับชม =====
  (function() {
    const overlay      = document.getElementById('focusOverlay');
    const focusHeader  = overlay.querySelector('.focus-header');
    const focusCtrl    = overlay.querySelector('.focus-controls');
    let hideTimer      = null;

    function showUI() {
      overlay.classList.add('ui-visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        overlay.classList.remove('ui-visible');
      }, 3000);
    }

    function cancelHide() {
      overlay.classList.add('ui-visible');
      clearTimeout(hideTimer);
    }

    // mouse move / touch แสดง UI แล้วซ่อนหลัง 3 วิ
    overlay.addEventListener('mousemove',  showUI, { passive: true });
    overlay.addEventListener('touchstart', showUI, { passive: true });

    // ถ้า hover ค้างที่ header, controls หรือ seekbar ไม่ให้ซ่อน
    [focusHeader, focusCtrl, overlay.querySelector('.focus-seekbar-wrap')].forEach(el => {
      if (!el) return;
      el.addEventListener('mouseenter', cancelHide);
      el.addEventListener('mouseleave', showUI);
    });

    // เปิด focus mode → แสดง UI ทันที
    document.getElementById('focusModeBtn').addEventListener('click', () => {
      showUI();
    }, true); // capture phase เพื่อให้ทำงานก่อน listener อื่น
  })();

  // Focus Mode Controls
  document.getElementById('focusModeBtn').addEventListener('click', () => {
      const overlay = document.getElementById('focusOverlay');
      const focusBody = document.getElementById('focusBody');
      const gongStage = document.getElementById('gong-stage');
      
      focusBody.appendChild(gongStage);
      document.getElementById('focusInstName').textContent = getActiveInst().name;
      const songNameEl = document.getElementById('focusSongName');
      if (songNameEl) songNameEl.textContent = (state.songName && state.songName.trim()) ? state.songName.trim() : 'ไม่มีชื่อเพลง';
      
      overlay.classList.add('active');
      // รอ CSS transition เสร็จก่อน แล้วค่อย layout ใหม่
      setTimeout(() => {
        layoutGongs();
        // rebuild cache หลัง move เสมอ — หาก renderGongs() ถูกเรียกขณะ stage
        // อยู่ที่อื่น _gongEls จะ stale; เรียก rebuild ที่นี่การันตีว่า cache fresh
        _rebuildGongCache();
        if (typeof window._focusSeekRebuild === 'function') window._focusSeekRebuild();
      }, 320);
  });

  document.getElementById('focusBackBtn').addEventListener('click', () => {
      const overlay = document.getElementById('focusOverlay');
      const originalContainer = document.getElementById('gongStageContainer');
      const gongStage = document.getElementById('gong-stage');
      
      originalContainer.appendChild(gongStage);
      overlay.classList.remove('active');
      
      setTimeout(() => { layoutGongs(); _rebuildGongCache(); }, 50);
  });

  document.getElementById('fcPlayPause').addEventListener('click', () => {
    if (state.isPlaying) {
      // โหมดรับชม: หยุดแบบ pause — คง currentStep ไว้เพื่อเล่นต่อ
      if (schedulerTimer) clearTimeout(schedulerTimer);
      if (playbackEndTimer) clearTimeout(playbackEndTimer);
      stopVisualSync();
      playbackVisualTimers = [];
      _currentBeatCells.forEach(c => c.classList.remove('current-beat'));
      _currentBeatCells = [];
      _autoScrollLastLine = null;
      if (audioCtx) {
        const now = audioCtx.currentTime;
        for (const master of playbackActiveMasters) {
          if (!master || !master.gain) continue;
          try { master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value || 0, now); master.gain.linearRampToValueAtTime(0, now + 0.05); } catch (_) {}
        }
      }
      playbackActiveMasters = [];
      state.isPlaying = false; state.currentBeat = -1;
      if (typeof window._syncFocusPlayBtn === 'function') window._syncFocusPlayBtn();
    } else {
      // โหมดรับชม: resume จาก currentStep ที่ค้างไว้ หรือเริ่มใหม่ถ้ายังไม่มี seq
      if (!playbackSeq || playbackSeq.length === 0) {
        startPlayback();
      } else {
        unlockAudio(); const ctx = ac(); if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        state.isPlaying = true; state.playMode = 'all';
        nextNoteTime = ctx.currentTime + 0.08;
        playbackActiveMasters = []; playbackVisualTimers = [];
        _autoScrollLastLine = null;
        if (typeof window._syncFocusPlayBtn === 'function') window._syncFocusPlayBtn();
        scheduler();
        startVisualSync();
      }
    }
  });

  // ซิงค์ icon ปุ่ม Play/Pause กับสถานะ isPlaying
  window._syncFocusPlayBtn = function() {
    const btn = document.getElementById('fcPlayPause');
    if (!btn) return;
    if (state.isPlaying) {
      btn.textContent = '■';
      btn.classList.add('is-playing');
      btn.title = 'หยุด';
    } else {
      btn.textContent = '▶';
      btn.classList.remove('is-playing');
      btn.title = 'เล่น';
    }
  };

  document.getElementById('fcRewind').addEventListener('click', () => {
      stopPlayback(true);
      setTimeout(startPlayback, 50);
  });

  // ย้อน / เดินหน้า 10 วินาที
  function skipSeconds(deltaSec) {
    if (!playbackSeq || playbackSeq.length === 0) return;
    const beatDur = state.bpm > 0 ? 60 / state.bpm : 0.3;
    const deltaSteps = Math.round(Math.abs(deltaSec) / beatDur);
    const newStep = Math.max(0, Math.min(playbackSeq.length - 1, currentStep + (deltaSec > 0 ? deltaSteps : -deltaSteps)));
    if (typeof window._focusSeekTo === 'function') window._focusSeekTo(newStep);
  }

  document.getElementById('fcSkipBack').addEventListener('click', () => skipSeconds(-10));
  document.getElementById('fcSkipFwd').addEventListener('click',  () => skipSeconds(10));

  // ===== Focus Seek Bar =====
  (function() {
    const seekbar    = document.getElementById('focusSeekbar');
    const fill       = document.getElementById('focusSeekFill');
    const thumb      = document.getElementById('focusSeekThumb');
    const tooltip    = document.getElementById('focusSeekTooltip');
    const posLabel   = document.getElementById('focusSeekPos');
    const timeLabel  = document.getElementById('focusSeekTime');
    const sectionsEl = document.getElementById('focusSeekSections');
    const trackEl    = seekbar.querySelector('.focus-seek-track');

    let isDragging = false;
    let seekPct = 0;  // 0–1

    // รวบรวม snap points จาก section markers (สร้างหลัง _focusSeekRebuild)
    // แต่ละ entry: { pct: 0-1, step: number }
    let snapPoints = [];

    function rebuildSnapPoints() {
      snapPoints = [];
      if (!playbackSeq || playbackSeq.length === 0) return;
      const totalSteps = playbackSeq.length;
      const secKeys = Object.keys(state.sections || {}).map(Number).sort((a,b)=>a-b);
      if (!secKeys.includes(1)) secKeys.unshift(1);
      secKeys.forEach((secLine, si) => {
        const startBeat = (secLine - 1) * 32;
        const stepIdx = si === 0 ? 0 : playbackSeq.indexOf(startBeat);
        if (stepIdx === -1 && si > 0) return;
        const pct = totalSteps <= 1 ? 0 : stepIdx / (totalSteps - 1);
        snapPoints.push({ pct, step: stepIdx });
      });
    }

    // คืน pct ที่ถูก snap แล้ว (ถ้าใกล้กว่า threshold) พร้อม step ที่ตรงกัน
    const SNAP_THRESHOLD = 0.02; // ~2% ของความกว้าง track
    function applySnap(rawPct) {
      let best = null, bestDist = Infinity;
      for (const sp of snapPoints) {
        const d = Math.abs(rawPct - sp.pct);
        if (d < SNAP_THRESHOLD && d < bestDist) { bestDist = d; best = sp; }
      }
      if (best) return { pct: best.pct, step: best.step, snapped: true };
      return { pct: rawPct, step: stepFromPct(rawPct), snapped: false };
    }

    function fmtTime(sec) {
      const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      return `${m}:${String(s).padStart(2,'0')}`;
    }

    // แปลง beat index ใน playbackSeq → ข้อมูลตำแหน่ง
    function beatInfo(beat) {
      const lineNum  = Math.floor(beat / 32) + 1;
      const totalLines = Math.ceil(state.numBars / BARS_PER_VAK);

      // หาชื่อท่อน
      let secName = '';
      const secKeys = Object.keys(state.sections || {}).map(Number).sort((a,b)=>a-b);
      let secStart = 1;
      for (const k of secKeys) { if (k <= lineNum) secStart = k; }
      secName = (state.sections && state.sections[secStart]) ? state.sections[secStart] : '';

      // บรรทัดที่ในท่อน
      const lineInSec = lineNum - secStart + 1;

      // นับบรรทัดทั้งหมดในท่อนนี้
      let secEnd = totalLines;
      for (const k of secKeys) { if (k > secStart) { secEnd = k - 1; break; } }
      const linesInSec = secEnd - secStart + 1;

      return { lineNum, totalLines, secName, lineInSec, linesInSec };
    }

    function labelFromStep(step) {
      if (!playbackSeq || playbackSeq.length === 0) return '—';
      const s = Math.max(0, Math.min(step, playbackSeq.length - 1));
      const beat = playbackSeq[s];
      const info = beatInfo(beat);
      const secPart = info.secName ? `${info.secName} · ` : '';
      return `${secPart}บรรทัด ${info.lineInSec}/${info.linesInSec}`;
    }

    function pctFromStep(step) {
      if (!playbackSeq || playbackSeq.length <= 1) return 0;
      return step / (playbackSeq.length - 1);
    }

    function stepFromPct(pct) {
      if (!playbackSeq || playbackSeq.length === 0) return 0;
      return Math.round(pct * (playbackSeq.length - 1));
    }

    // update ตำแหน่ง UI
    function setSeekUI(pct, step) {
      const p = Math.max(0, Math.min(1, pct)) * 100;
      fill.style.width  = p + '%';
      thumb.style.left  = p + '%';
      tooltip.style.left = p + '%';
      tooltip.textContent = labelFromStep(step);

      posLabel.textContent = labelFromStep(step);

      // เวลา
      const beatDur = state.bpm > 0 ? 60 / state.bpm : 0.3;
      const elapsedSec = (step || 0) * beatDur;
      timeLabel.textContent = fmtTime(elapsedSec);
    }

    // เรียกจาก scheduleBeat ทุกครั้งที่ step เปลี่ยน
    window._focusSeekUpdate = function(step) {
      if (isDragging) return;
      const pct = pctFromStep(step);
      setSeekUI(pct, step);
    };

    // seek ไปยัง step ใน playbackSeq — ทำงานได้ทั้งขณะเล่นและหยุด
    function seekToStep(step) {
      if (!playbackSeq || playbackSeq.length === 0) return;
      step = Math.max(0, Math.min(step, playbackSeq.length - 1));

      // เก็บ step ไว้เสมอ — ใช้เมื่อกด Play ใน focus mode (resume จากจุดที่ seek)
      currentStep = step;

      if (!state.isPlaying) {
        // ขณะ paused: อัพเดต UI เท่านั้น
        setSeekUI(pctFromStep(step), step);
        return;
      }

      // ขณะเล่นอยู่: หยุด scheduler เก่าแล้วเริ่มใหม่จาก step นี้
      if (schedulerTimer) clearTimeout(schedulerTimer);
      if (playbackEndTimer) clearTimeout(playbackEndTimer);
      playbackVisualTimers = []; // ทิ้งคิว event ของ timeline เก่า (คนละ step กับที่ seek ไป)
      playbackActiveMasters = [];

      const ctx = ac(); if (!ctx) return;
      nextNoteTime = ctx.currentTime + 0.08;
      scheduler(); // visual sync loop ยังทำงานอยู่ต่อเนื่อง (isPlaying ไม่เคยเป็น false ระหว่าง seek)
    }

    function pctFromEvent(e) {
      const rect = trackEl.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function onDragMove(e) {
      const rawPct = pctFromEvent(e);
      const { pct, step, snapped } = applySnap(rawPct);
      setSeekUI(pct, step);
      // แสดง visual feedback ว่า snap อยู่
      seekbar.classList.toggle('snapped', snapped);
    }

    function onDragEnd(e) {
      isDragging = false;
      seekbar.classList.remove('dragging');
      seekbar.classList.remove('snapped');
      const rawPct = pctFromEvent(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e);
      const { pct, step } = applySnap(rawPct);
      setSeekUI(pct, step);
      seekToStep(step);
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      window.removeEventListener('touchmove', onDragMove);
      window.removeEventListener('touchend', onDragEnd);
      window.removeEventListener('touchcancel', onDragEnd);
    }

    seekbar.addEventListener('mousedown', (e) => {
      isDragging = true;
      seekbar.classList.add('dragging');
      onDragMove(e);
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    });
    seekbar.addEventListener('touchstart', (e) => {
      isDragging = true;
      seekbar.classList.add('dragging');
      onDragMove(e);
      window.addEventListener('touchmove', onDragMove, { passive: true });
      window.addEventListener('touchend', onDragEnd);
      // touchcancel: iOS ยิงแทน touchend เมื่อ system gesture interrupt (เช่น swipe Control Center)
      // ถ้าไม่จับ — listener ค้างบน window และ isDragging ไม่ถูก reset
      window.addEventListener('touchcancel', onDragEnd);
    }, { passive: true });

    // แสดง section markers + labels เมื่อเปิด focus mode
    window._focusSeekRebuild = function() {
      // ล้าง markers เก่า
      trackEl.querySelectorAll('.seek-section-marker').forEach(e => e.remove());
      sectionsEl.innerHTML = '';

      if (!playbackSeq || playbackSeq.length === 0) return;

      const totalSteps = playbackSeq.length;
      const secKeys = Object.keys(state.sections || {}).map(Number).sort((a,b)=>a-b);
      if (!secKeys.includes(1)) secKeys.unshift(1);

      // หา step แรกของแต่ละ section
      secKeys.forEach((secLine, si) => {
        const startBeat = (secLine - 1) * 32;
        const stepIdx = playbackSeq.indexOf(startBeat);
        if (stepIdx === -1 && si > 0) return; // ไม่เจอใน seq ข้ามไป

        const pct = si === 0 ? 0 : (stepIdx / (totalSteps - 1)) * 100;

        // marker บนแถบ
        if (si > 0) {
          const mk = document.createElement('div');
          mk.className = 'seek-section-marker';
          mk.style.left = pct + '%';
          trackEl.appendChild(mk);
        }

        // label ด้านล่าง
        const lbl = document.createElement('div');
        lbl.className = 'seek-sec-label';
        lbl.style.left = pct + '%';
        const name = (state.sections && state.sections[secLine]) ? state.sections[secLine] : `ท่อน ${si+1}`;
        lbl.textContent = name;
        lbl.title = name;
        sectionsEl.appendChild(lbl);
      });

      setSeekUI(0, 0);
      rebuildSnapPoints();
    };
    window._focusSeekTo = seekToStep;
  })();
}

// ── เมนูแอ็กชันของห้อง/บรรทัด/หลายบรรทัด (cell / line / multi-line action menu) ──
function initCellAndLineMenus() {
  // Cell Action Menu
  document.getElementById('camPlay')?.addEventListener('click', (e) => { e.preventDefault(); playCurrentRoom(); });
  document.getElementById('camCopy')?.addEventListener('click', (e) => { e.preventDefault(); copyRoom(); });
  document.getElementById('camPaste')?.addEventListener('click', (e) => { e.preventDefault(); pasteRoom(); });
  
  document.getElementById('camIncBar')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.cursorBeat !== -1) {
          const bar = Math.floor(state.cursorBeat / 4);
          const lineNum = Math.floor(bar / 8) + 1;
          const currentLen = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : 8;
          if (currentLen < 8) { 
              pushUndo(); 
              state.lineLengths[lineNum] = currentLen + 1; 
              renderNotation(); 
          }
          hideCellMenus();
      }
  });
  
  document.getElementById('camDecBar')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.cursorBeat !== -1) {
          const bar = Math.floor(state.cursorBeat / 4);
          const lineNum = Math.floor(bar / 8) + 1;
          const currentLen = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : 8;
          if (currentLen > 1) { 
              pushUndo(); 
              state.lineLengths[lineNum] = currentLen - 1; 
              renderNotation(); 
          }
          hideCellMenus();
      }
  });
  
  // Line Action Menu (New)
  document.getElementById('lamCopy')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.selectedLine !== null) {
          const lineIndex = state.selectedLine - 1;
          const startB = lineIndex * 32; 
          const copiedLength = 32;
          const data = { right: state.notes.right.slice(startB, startB + copiedLength), left: state.notes.left.slice(startB, startB + copiedLength) };
          customClipboard = { type: 'line', data, length: copiedLength, originalHand: 'both' };
          showToast(`คัดลอกบรรทัดที่ ${state.selectedLine} เรียบร้อย`, 'success');
          state.selectedLine = null;
          renderNotation();
          hideCellMenus();
      }
  });
  
  document.getElementById('lamPaste')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.selectedLine !== null && customClipboard && customClipboard.type === 'line') {
          pushUndo(); 
          const lineIndex = state.selectedLine - 1;
          const startB = lineIndex * 32;
          for (let i = 0; i < customClipboard.length; i++) {
              state.notes.right[startB + i] = customClipboard.data.right[i];
              state.notes.left[startB + i] = customClipboard.data.left[i];
          }
          showToast(`วางลงในบรรทัดที่ ${state.selectedLine} เรียบร้อย`, 'success');
          state.selectedLine = null;
          renderNotation();
          hideCellMenus();
      }
  });
  
  document.getElementById('lamMultiLine')?.addEventListener('click', (e) => {
      e.preventDefault();
      hideCellMenus();
      state.isMultiLineMode = true;
      state.selectedLines = new Set();
      if (state.selectedLine !== null) {
          state.selectedLines.add(state.selectedLine);
          state.selectedLine = null;
      }
      renderNotation();
      document.getElementById('multiLineActionMenu').classList.remove('hidden');
  });

  document.getElementById('lamCancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      state.selectedLine = null;
      renderNotation();
      hideCellMenus();
  });

  // Multi-Line Action Menu handlers
  function exitMultiLineMode() {
      state.isMultiLineMode = false;
      state.selectedLines = new Set();
      document.getElementById('multiLineActionMenu').classList.add('hidden');
      renderNotation();
  }

  document.getElementById('mlmCancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      exitMultiLineMode();
  });

  document.getElementById('mlmCopy')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sorted = [...state.selectedLines].sort((a, b) => a - b);
      if (sorted.length === 0) { showToast('ยังไม่ได้เลือกบรรทัด', 'error'); return; }
      const BEATS = BARS_PER_VAK * BEATS_PER_BAR;
      const allRight = [], allLeft = [];
      sorted.forEach(lineNum => {
          const startB = (lineNum - 1) * BEATS;
          allRight.push(...state.notes.right.slice(startB, startB + BEATS));
          allLeft.push(...state.notes.left.slice(startB, startB + BEATS));
      });
      customClipboard = { type: 'multiLine', data: { right: allRight, left: allLeft }, length: allRight.length, lineCount: sorted.length, originalHand: 'both' };
      // Also copy as text to system clipboard if supported
      const displayNotes = getActiveInst ? getActiveInst().display : null;
      if (navigator.clipboard && displayNotes) {
          const toStr = arr => arr.map(n => n === null || !displayNotes[n] ? '-' : displayNotes[n]).join(' ');
          const lines = sorted.map((lineNum, i) => {
              const startB = (lineNum - 1) * BEATS;
              const r = state.notes.right.slice(startB, startB + BEATS);
              const l = state.notes.left.slice(startB, startB + BEATS);
              return `บรรทัด ${lineNum}\nR: ${toStr(r)}\nL: ${toStr(l)}`;
          });
          navigator.clipboard.writeText(lines.join('\n\n')).catch(() => {});
      }
      showToast(`คัดลอก ${sorted.length} บรรทัด (บรรทัดที่ ${sorted.join(', ')}) เรียบร้อย`, 'success');
      exitMultiLineMode();
  });

  document.getElementById('mlmClear')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sorted = [...state.selectedLines].sort((a, b) => a - b);
      if (sorted.length === 0) { showToast('ยังไม่ได้เลือกบรรทัด', 'error'); return; }
      pushUndo();
      const BEATS = BARS_PER_VAK * BEATS_PER_BAR;
      sorted.forEach(lineNum => {
          const startB = (lineNum - 1) * BEATS;
          for (let i = 0; i < BEATS; i++) {
              state.notes.right[startB + i] = null;
              state.notes.left[startB + i] = null;
          }
      });
      showToast(`ล้าง ${sorted.length} บรรทัดเรียบร้อย`, 'success');
      exitMultiLineMode();
  });

  document.getElementById('mlmPlay')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sorted = [...state.selectedLines].sort((a, b) => a - b);
      if (sorted.length === 0) { showToast('ยังไม่ได้เลือกบรรทัด', 'error'); return; }
      exitMultiLineMode();
      // เล่นตั้งแต่บรรทัดแรกที่เลือกถึงบรรทัดสุดท้ายที่เลือก
      const firstLine = sorted[0];
      const lastLine = sorted[sorted.length - 1];
      playLineRange(firstLine, lastLine);
  });
  
  document.getElementById('camEdit')?.addEventListener('click', (e) => { 
      e.preventDefault(); 
      if (state.cursorBeat !== -1) {
          const activeBar = Math.floor(state.cursorBeat / 4);
          state.cursorBeat = activeBar * 4; 
          state.isEditMode = true; 
          renderNotation(); 
          hideCellMenus();
          positionMenuForCell(document.getElementById('cellEditMenu'));
      }
  });
  document.getElementById('camMulti')?.addEventListener('click', (e) => {
      e.preventDefault();
      hideCellMenus();
      state.isMultiSelectMode = true;
      if(!state.selectedRooms) state.selectedRooms = new Set();
      state.selectedRooms.clear();
      const activeBar = Math.floor(state.cursorBeat / 4);
      state.selectedRooms.add(`right:${activeBar}`);
      state.selectedRooms.add(`left:${activeBar}`);
      renderNotation();
      document.getElementById('multiSelectActionMenu').classList.remove('hidden');
      document.getElementById('msmPaste').disabled = !customClipboard || customClipboard.type === 'line';
  });
  
  document.getElementById('msmCopy')?.addEventListener('click', (e) => { e.preventDefault(); copyMultiRooms(); });
  document.getElementById('msmPaste')?.addEventListener('click', (e) => { e.preventDefault(); pasteMultiRooms(); });
  document.getElementById('msmCancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      state.isMultiSelectMode = false;
      state.selectedRooms.clear();
      document.getElementById('multiSelectActionMenu').classList.add('hidden');
      renderNotation();
  });
  document.getElementById('msmPlay')?.addEventListener('click', (e) => {
      e.preventDefault();
      playSelectedRooms();
  });
  
  document.getElementById('camDel')?.addEventListener('click', (e) => { 
      e.preventDefault(); 
      if (state.cursorBeat !== -1) {
          pushUndo();
          const activeBar = Math.floor(state.cursorBeat / 4);
          const startB = activeBar * 4;
          for(let i=0; i<4; i++) {
              state.notes.right[startB + i] = null;
              state.notes.left[startB + i]  = null;
          }
          renderNotation();
          hideCellMenus();
          showToast('ลบโน้ตทั้งห้อง (ทั้ง 2 มือ) เรียบร้อย');
      }
  });
  document.getElementById('cemOk')?.addEventListener('click', (e) => { 
      e.preventDefault(); 
      state.isEditMode = false; 
      renderNotation(); 
      hideCellMenus();
  });
}

// ── Event delegation บน #notation: section header, play/insert/delete line, hand label, beat cell ──
function initNotationDelegation() {
  const notationDiv = document.getElementById('notation');
  
  // ── Event delegation สำหรับปุ่ม/ป้ายต่างๆในแต่ละบรรทัด ──────────────────────────
  // เดิม secHeader/insBtn/delBtn/hand-label/line-play-btn/repeat controls ผูก addEventListener
  // แยกทีละตัว "ในลูป renderNotation()" ซึ่งถูกเรียกใหม่แทบทุกครั้งที่แก้โน้ต (พิมพ์โน้ต 1 ตัวก็ rebuild ทั้งตาราง)
  // แปลว่าทุกครั้งที่แก้โน้ต จะมีการสร้าง+ทิ้ง closure หลักร้อยตัวถ้าเพลงยาวหลายบรรทัด (secHeader click+keydown,
  // line-play-btn, insBtn, delBtn, hand-label, repeat checkbox+input = ต่อบรรทัด 7-8 listeners)
  // บนมือถือ/เบราว์เซอร์ที่เก็บ DOM ที่ถูกถอดออกไม่ทันเวลา ทำให้ RAM โตขึ้นเรื่อยๆระหว่าง edit ต่อเนื่อง
  // แก้โดยย้ายมาไว้ที่ listener เดียวบน #notation (ผูกครั้งเดียวตอน init ไม่ใช่ทุกครั้งที่ render)
  // แล้วอ่าน line/action จาก data-* attribute แทนการอาศัย closure ต่อ element
  notationDiv.addEventListener('click', (e) => {
    const secBtn = e.target.closest('.section-header .btn-sec');
    if (secBtn) {
      const lineWrapEl = secBtn.closest('.line-wrap');
      const lineNum = parseInt(lineWrapEl.dataset.lineNum, 10);
      if (secBtn.classList.contains('add-sec')) {
        state.sections[lineNum] = `ท่อนที่ ${Object.keys(state.sections).length + 1}`;
        state._editingSection = lineNum; renderNotation();
      } else if (secBtn.classList.contains('edit-sec')) {
        state._editingSection = lineNum; renderNotation();
      } else if (secBtn.classList.contains('del-sec')) {
        pushUndo(); delete state.sections[lineNum]; renderNotation();
      } else if (secBtn.classList.contains('cancel-sec')) {
        state._editingSection = null; renderNotation();
      } else if (secBtn.classList.contains('save-sec')) {
        const val = document.getElementById(`secInp-${lineNum}`).value.trim();
        pushUndo();
        if (val) state.sections[lineNum] = val;
        else delete state.sections[lineNum];
        state._editingSection = null; renderNotation();
      } else if (secBtn.classList.contains('play-sec')) {
        playSection(lineNum);
      } else if (secBtn.classList.contains('play-range-sec')) {
        openPlayRangeModal(lineNum);
      }
      return;
    }

    const playBtn = e.target.closest('.line-play-btn');
    if (playBtn) {
      const lineNum = parseInt(playBtn.closest('.line-wrap').dataset.lineNum, 10);
      playLine(lineNum);
      return;
    }

    const insBtn = e.target.closest('.btn-line:not(.del)');
    if (insBtn) {
      const line = parseInt(insBtn.closest('.line-wrap').dataset.lineNum, 10) - 1;
      insertLine(line);
      return;
    }
    const delBtn = e.target.closest('.btn-line.del');
    if (delBtn) {
      const line = parseInt(delBtn.closest('.line-wrap').dataset.lineNum, 10) - 1;
      deleteLine(line);
      return;
    }

    const handLabel = e.target.closest('.hand-label.clickable');
    if (handLabel) {
      const lineNum = parseInt(handLabel.closest('.line-wrap').dataset.lineNum, 10);
      if (state.isMultiLineMode) {
          if (state.selectedLines.has(lineNum)) state.selectedLines.delete(lineNum);
          else state.selectedLines.add(lineNum);
          renderNotation();
          return;
      }
      state.selectedLine = lineNum;
      renderNotation();
      hideCellMenus();
      positionLineMenu(e.clientX, e.clientY);
      return;
    }

    const cell = e.target.closest('.beat-cell'); 
    if (!cell) return;

    state.selectedLine = null; 

    const beat = parseInt(cell.dataset.beat); 
    const hand = cell.dataset.hand;
    const now = Date.now();
    const clickedBar = Math.floor(beat / 4);
    const roomKey = `${hand}:${clickedBar}`;

    if (state.isMultiSelectMode) {
        const rightKey = `right:${clickedBar}`;
        const leftKey  = `left:${clickedBar}`;
        const alreadySelected = state.selectedRooms.has(rightKey) || state.selectedRooms.has(leftKey);
        if (alreadySelected) {
            state.selectedRooms.delete(rightKey);
            state.selectedRooms.delete(leftKey);
        } else {
            state.selectedRooms.add(rightKey);
            state.selectedRooms.add(leftKey);
        }
        renderNotation();
        return;
    }

    if (lastTap.beat === beat && lastTap.hand === hand && (now - lastTap.time < 350)) {
        state.cursorBeat = beat; 
        state.hand = hand;
        state.isEditMode = true;
        patchNotation(); // เปลี่ยนแค่ cursor/editMode — โครงสร้าง DOM ไม่เปลี่ยน
        hideCellMenus();
        positionMenuForCell(document.getElementById('cellEditMenu'));
        lastTap.time = 0; 
    } else {
        state.cursorBeat = beat; 
        state.hand = hand;
        state.isEditMode = false;
        patchNotation(); // เปลี่ยนแค่ cursor — โครงสร้าง DOM ไม่เปลี่ยน
        hideCellMenus();
        positionMenuForCell(document.getElementById('cellActionMenu'));
        lastTap = { time: now, beat, hand };
    }
  });

  // section-name input: Enter = บันทึก, Escape = ยกเลิก (เดิมผูกต่อ secHeader ทุกบรรทัด)
  notationDiv.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('sec-input')) return;
    const secHeader = e.target.closest('.section-header');
    if (e.key === 'Enter') secHeader.querySelector('.save-sec')?.click();
    if (e.key === 'Escape') secHeader.querySelector('.cancel-sec')?.click();
  });

  // repeat checkbox/input ต่อบรรทัด (เดิมผูกต่อ element ทุกบรรทัดเช่นกัน) — 'change' bubble ได้ปกติ
  notationDiv.addEventListener('change', (e) => {
    const ctrl = e.target.closest('.line-repeat-controls');
    if (!ctrl) return;
    const lineNum       = parseInt(ctrl.dataset.line, 10);
    const thisSecStart  = parseInt(ctrl.dataset.secStart, 10);
    const displayLineNum = parseInt(ctrl.dataset.displayLine, 10);
    const cb  = ctrl.querySelector('.repeat-checkbox');
    const inp = ctrl.querySelector('.repeat-target-input');

    pushUndo();
    if (!state.repeats) state.repeats = {};

    if (e.target === cb) {
      if (cb.checked) {
          let val = parseInt(inp.value, 10) || 1;
          val = Math.max(1, Math.min(displayLineNum, val));
          state.repeats[lineNum] = thisSecStart + val - 1;
          inp.disabled = false;
      } else {
          delete state.repeats[lineNum];
          inp.disabled = true;
      }
    } else if (e.target === inp) {
      let val = parseInt(inp.value, 10) || 1;
      val = Math.max(1, Math.min(displayLineNum, val));
      inp.value = val;
      if (state.repeats[lineNum] !== undefined) {
        state.repeats[lineNum] = thisSecStart + val - 1;
      }
    }
  });
}

// ── คลิกนอกพื้นที่เพื่อยกเลิก selection, ปุ่มลัดคีย์บอร์ด, Escape ปิด modal ──
function initGlobalPointerAndKeyboard() {
  document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.beat-cell') || 
          e.target.closest('.touch-sel-menu') || 
          e.target.closest('.touch-keyboard') || 
          e.target.closest('.controls') ||
          e.target.closest('.line-play-btn') ||
          e.target.closest('.section-header') ||
          e.target.closest('.hand-label.clickable') ||
          e.target.closest('.line-action-bar') ||
          e.target.closest('.line-drag-handle') ||
          e.target.closest('.inst-select') ||
          e.target.closest('#toggleManualWrap') ||
          e.target.closest('.modal-overlay') ||
          e.target.closest('.focus-controls')) {
          return;
      }
      
      let needsRender = false;

      if (state.isMultiSelectMode) {
          state.isMultiSelectMode = false;
          if(state.selectedRooms) state.selectedRooms.clear();
          document.getElementById('multiSelectActionMenu')?.classList.add('hidden');
          needsRender = true;
      } 
      
      if (state.cursorBeat !== -1) {
          state.cursorBeat = -1;
          state.isEditMode = false;
          hideCellMenus();
          needsRender = true;
      }
      
      if (state.selectedLine !== null) {
          state.selectedLine = null;
          hideCellMenus();
          needsRender = true;
      }
      
      if (needsRender) renderNotation();
      
  }, { passive: true });

  const CODE_MAP_MASTER = {
    'KeyQ':'ดํ', 'KeyW':'รํ', 'KeyE':'มํ', 'KeyR':'ฟํ', 'KeyT':'ซํ', 'KeyY':'ลํ', 'KeyU':'ทํ',
    'KeyA':'ด', 'KeyS':'ร', 'KeyD':'ม', 'KeyF':'ฟ', 'KeyG':'ซ', 'KeyH':'ล', 'KeyJ':'ท',
    'KeyZ':'ดฺ', 'KeyX':'รฺ', 'KeyC':'มฺ', 'KeyV':'ฟฺ', 'KeyB':'ซฺ', 'KeyN':'ลฺ', 'KeyM':'ทฺ'
  };

  // ระนาดเอก: ผังคีย์ลัดของตัวเอง (22 ลูก เรียงต่างจากฆ้อง) — สร้างจาก INSTRUMENTS.ranatek.keyCodes ครั้งเดียว
  const RANATEK_CODE_MAP = {};
  (INSTRUMENTS.ranatek.keyCodes || []).forEach((k, idx) => {
    if (Array.isArray(k)) k.forEach(code => { RANATEK_CODE_MAP[code] = idx; });
    else RANATEK_CODE_MAP[k] = idx;
  });
  
  const pressedCodes = new Set();
  
  function updateModUIState() {
    const elTab = document.getElementById('tkModTab'); if (elTab) elTab.classList.toggle('active', tabHeld);
    const elShift = document.getElementById('tkModShift'); if (elShift) elShift.classList.toggle('active', shiftHeld);
    const elUp = document.getElementById('tkModUp'); if (elUp) elUp.classList.toggle('active', arrowUpHeld);
    const elDown = document.getElementById('tkModDown'); if (elDown) elDown.classList.toggle('active', arrowDownHeld);
  }

  const _MODAL_ESCAPE_MAP = [
    { modalId: 'clearConfirmModal',  cancelId: 'cancelClearBtn' },
    { modalId: 'switchInstModal',    cancelId: 'cancelSwitchBtn' },
    { modalId: 'playRangeModal',     cancelId: 'cancelPlayRangeBtn' },
    { modalId: 'exportMp3Modal',     cancelId: null,
      close: () => { if (!isExporting) document.getElementById('exportMp3Modal').classList.remove('show'); } },
  ];

  _MODAL_ESCAPE_MAP.forEach(({ modalId, cancelId, close }) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target !== modal) return;
      if (close) close();
      else document.getElementById(cancelId).click();
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const code = e.code;

    if (code === 'Escape') {
      for (const { modalId, cancelId, close } of _MODAL_ESCAPE_MAP) {
        const modal = document.getElementById(modalId);
        if (modal && modal.classList.contains('show')) {
          e.preventDefault();
          if (close) close();
          else document.getElementById(cancelId).click();
          return;
        }
      }
    }
    
    if (e.ctrlKey || e.metaKey) {
      if (code === 'KeyY' || (code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); performRedo(); return; }
      if (code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); performUndo(); return; }
    }

    if (code === 'Tab') { tabHeld = true; updateModUIState(); e.preventDefault(); return; }
    if (code === 'ShiftLeft' || code === 'ShiftRight') { shiftHeld = true; updateModUIState(); e.preventDefault(); return; }
    if (code === 'ArrowUp') { arrowUpHeld = true; updateModUIState(); e.preventDefault(); return; }
    if (code === 'ArrowDown') { arrowDownHeld = true; updateModUIState(); e.preventDefault(); return; }

    if (pressedCodes.has(code)) return; 
    
    if (currentInstrument === 'ranatek') {
        if (RANATEK_CODE_MAP[code] !== undefined) {
            e.preventDefault();
            unlockAudio();
            pressedCodes.add(code);
            typeNote(RANATEK_CODE_MAP[code]);
            return;
        }
    } else if (CODE_MAP_MASTER[code] !== undefined) { 
        e.preventDefault(); 
        unlockAudio(); 
        pressedCodes.add(code); 
        const noteStr = CODE_MAP_MASTER[code];
        const inst = getActiveInst();
        const idx = inst.display.indexOf(noteStr);
        if (idx !== -1) {
            typeNote(idx);
        }
        return; 
    }

    if (code === 'Space') { 
        e.preventDefault(); 
        pressedCodes.add(code); 
        if (state.isEditMode) {
            insertRest(); 
        } else {
            if (state.isPlaying) stopPlayback(true);
            else startPlayback();
        }
        return; 
    }
    if (code === 'Delete' || code === 'Backspace') { e.preventDefault(); pressedCodes.add(code); deleteAtCursor(); return; }
    if (code === 'ArrowLeft') { e.preventDefault(); pressedCodes.add(code); moveCursorBy(-1); return; }
    if (code === 'ArrowRight') { e.preventDefault(); pressedCodes.add(code); moveCursorBy(+1); return; }
    if (code === 'Enter' || code === 'NumpadEnter') { e.preventDefault(); pressedCodes.add(code); appendNewVak(); return; }
  });

  window.addEventListener('keyup', (e) => {
    pressedCodes.delete(e.code);
    if (e.code === 'Tab') { tabHeld = false; updateModUIState(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { shiftHeld = false; updateModUIState(); }
    if (e.code === 'ArrowUp') { arrowUpHeld = false; updateModUIState(); }
    if (e.code === 'ArrowDown') { arrowDownHeld = false; updateModUIState(); }
  });

  window.addEventListener('blur', () => { pressedCodes.clear(); tabHeld = shiftHeld = arrowUpHeld = arrowDownHeld = false; updateModUIState(); });
}
