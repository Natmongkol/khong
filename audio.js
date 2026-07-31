// ===== audio.js: audio engine (synth), playback scheduler, mp3 export glue =====

function ac() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) { showToast('เบราว์เซอร์ของคุณไม่รองรับระบบเสียง', 'error'); return null; }
    audioCtx = new AudioCtx();
  }
  return audioCtx;
}

function unlockAudio() {
  if(audioUnlocked) return;
  const ctx = ac(); if (!ctx) return;
  const doUnlock = () => {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer; source.connect(ctx.destination); source.start(0);
      audioUnlocked = true;
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !iosWarned) {
        showToast('หากไม่มีเสียงบน iPhone/iPad โปรดตรวจสอบปุ่มปิดเสียงข้างเครื่อง', 'success');
        iosWarned = true;
      }
    } catch (e) {
      console.warn("Audio unlock suppressed:", e);
    }
  };
  if (ctx.state === 'suspended') {
    ctx.resume().then(doUnlock).catch((e) => console.warn("Audio context resume blocked:", e));
  } else doUnlock();
}
window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
window.addEventListener('click', unlockAudio, { once: true });

// หยุดเล่นเมื่อ tab/app เข้า background — ป้องกัน AudioContext ค้างและ visual desync บน iOS/Android
function _resetDragSideEffects() {
  document.body.style.userSelect = '';
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (typeof stopPlayback === 'function' && state.isPlaying) stopPlayback(true);
    _resetDragSideEffects();
  }
});

window.addEventListener('pagehide', _resetDragSideEffects);

let _cachedNoiseBuf = null;
let _cachedNoiseSR  = 0;   // sampleRate ที่ใช้สร้าง buffer — แยกออกมาเพราะ AudioBuffer.sampleRate เป็น read-only
function _getNoiseBuf(ctx) {
  const sr = ctx.sampleRate || 44100;
  const isOffline = (window.OfflineAudioContext && ctx instanceof window.OfflineAudioContext)
                 || (window.webkitOfflineAudioContext && ctx instanceof window.webkitOfflineAudioContext);
  // OfflineAudioContext ต้องสร้าง buffer ใหม่เสมอ เพราะ buffer จาก live context ใช้ข้ามกันไม่ได้
  if (isOffline) {
    const bufLen = Math.floor(0.03 * sr);
    const buf = ctx.createBuffer(1, bufLen, sr); const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    return buf;
  }
  // live AudioContext: reuse cache ถ้า sampleRate เหมือนกัน
  if (_cachedNoiseBuf && _cachedNoiseSR === sr) return _cachedNoiseBuf;
  const bufLen = Math.floor(0.03 * sr);
  const buf = ctx.createBuffer(1, bufLen, sr); const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
  _cachedNoiseBuf = buf; _cachedNoiseSR = sr;
  return buf;
}

function playGongFreq(freq, when, gain = 1, customCtx = null) {
  try {
    const ctx = customCtx || ac(); if (!ctx) return null;
    if (!customCtx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    
    const t = Math.max(ctx.currentTime, (when ?? ctx.currentTime));
    const master = ctx.createGain(); master.gain.value = 0.28 * gain;
    
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500; lp.Q.value = 0.4;
    master.connect(lp); lp.connect(ctx.destination);

    const partials = [
      { ratio: 1.00, gain: 0.62, decay: 2.8 }, { ratio: 2.05, gain: 0.30, decay: 1.6 },
      { ratio: 3.42, gain: 0.16, decay: 0.95 }, { ratio: 5.70, gain: 0.08, decay: 0.45 },
      { ratio: 8.30, gain: 0.035, decay: 0.22 },
    ];
    
    let maxDecay = 0; let lastOsc = null;
    partials.forEach(({ratio, gain: g, decay}) => {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * ratio;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + 0.004); env.gain.exponentialRampToValueAtTime(0.0006, t + decay);
      osc.connect(env); env.connect(master); osc.start(t); osc.stop(t + decay + 0.05);
      osc.onended = () => { try { osc.disconnect(); env.disconnect(); } catch(e){} };
      if (decay > maxDecay) { maxDecay = decay; lastOsc = osc; }
    });

    const buf = _getNoiseBuf(ctx);
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const noiseFilter = ctx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = Math.min(3500, freq * 6); noiseFilter.Q.value = 1.4;
    const noiseEnv = ctx.createGain(); noiseEnv.gain.setValueAtTime(0.18, t); noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    
    noise.connect(noiseFilter); noiseFilter.connect(noiseEnv); noiseEnv.connect(master); noise.start(t);
    noise.onended = () => { try { noise.disconnect(); noiseFilter.disconnect(); noiseEnv.disconnect(); } catch(e){} };

    // ล้าง master/lp เมื่อ osc ที่อายุยาวสุด (maxDecay) จบ — ป้องกัน node สะสม
    // ใช้ onended แทน setTimeout เพื่อหลีกเลี่ยง timer ที่อาจยิงผิดเวลา
    // OfflineAudioContext: onended เชื่อถือได้กว่า setTimeout ระหว่าง startRendering
    if (lastOsc) {
      const origOnEnded = lastOsc.onended;
      lastOsc.onended = () => {
        if (origOnEnded) origOnEnded();
        try { master.disconnect(); lp.disconnect(); } catch(e){}
      };
    }

    return master;
  } catch (err) { return null; }
}

// เสียงเคาะจังหวะ (metronome tick) — ใช้ที่โน้ตตัวที่ 4 ของทุกห้อง
// อ้างอิงจากเสียงเมโทรนอมจริง: มี 2 ส่วนซ้อนกัน
//   1) transient แหลมสั้นๆ (noise ผ่าน bandpass ~1.6kHz) จำลองเสียงกระทบ
//   2) โทนเสียง "ตุ๊บ" สั้นๆ ที่ ~1050Hz จำลองเสียงกึกก้องของตัวเครื่อง
function playMetronomeClick(when, gain = 1, customCtx = null) {
  try {
    const ctx = customCtx || ac(); if (!ctx) return null;
    if (!customCtx && ctx.state === 'suspended') ctx.resume().catch(() => {});

    const t = Math.max(ctx.currentTime, (when ?? ctx.currentTime));
    const master = ctx.createGain(); master.gain.value = 0.34 * gain; // ดังขึ้นกว่าเดิม
    master.connect(ctx.destination);

    // ส่วนที่ 1: transient แหลมสั้นๆ
    const buf = _getNoiseBuf(ctx);
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 1.1;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0, t);
    noiseEnv.gain.linearRampToValueAtTime(1, t + 0.001);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    noise.connect(bp); bp.connect(noiseEnv); noiseEnv.connect(master);
    noise.start(t);

    // ส่วนที่ 2: โทนเสียงตุ๊บสั้นๆ ที่ ~1050Hz
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 1050;
    const oscEnv = ctx.createGain();
    oscEnv.gain.setValueAtTime(0, t);
    oscEnv.gain.linearRampToValueAtTime(0.8, t + 0.002);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(oscEnv); oscEnv.connect(master);
    osc.start(t); osc.stop(t + 0.1);

    osc.onended = () => {
      try { osc.disconnect(); oscEnv.disconnect(); noise.disconnect(); bp.disconnect(); noiseEnv.disconnect(); master.disconnect(); } catch(e){}
    };

    return master;
  } catch (err) { return null; }
}

function playGong(idx, when) { 
    return playGongFreq(getActiveInst().freqs[idx], when); 
}


function getPlaybackSequence() {
  const seq = []; const totalLines = Math.ceil(state.numBars / BARS_PER_VAK);
  let currentLine = 1; const repeated = new Set();
  const MAX_STEPS = totalLines * 4; let steps = 0;

  while (currentLine <= totalLines && steps++ < MAX_STEPS) {
    const barsInThisLine = state.lineLengths[currentLine] !== undefined ? state.lineLengths[currentLine] : BARS_PER_VAK;
    const startBeat = (currentLine - 1) * 32; 
    const endBeat = startBeat + (barsInThisLine * 4) - 1;
    for (let b = startBeat; b <= endBeat; b++) if (b < totalBeats()) seq.push(b);
    
    if (state.repeats && state.repeats[currentLine] !== undefined && !repeated.has(currentLine)) {
      repeated.add(currentLine); 
      let target = parseInt(state.repeats[currentLine], 10);
      if (target >= 1 && target <= currentLine) { currentLine = target; continue; }
    }
    currentLine++;
  }
  return seq;
}

function playCurrentRoom() {
  hideCellMenus();
  if (state.cursorBeat === -1) return;
  if (state.isPlaying) stopPlayback(true);
  unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const barIndex = Math.floor(state.cursorBeat / 4);
  const startBeat = barIndex * 4;
  
  state.playMode = 'section'; 
  state.selectionHands = ['right', 'left']; 
  playbackSeq = [startBeat, startBeat + 1, startBeat + 2, startBeat + 3];
  
  state.isPlaying = true; currentStep = 0; nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if (pBar) pBar.style.width = '0%';
  scheduler();
}

function playSelectedRooms() {
  if (!state.selectedRooms || state.selectedRooms.size === 0) return;
  if (state.isPlaying) stopPlayback(true); unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const bars = Array.from(state.selectedRooms).map(k => parseInt(k.split(':')[1]));
  const uniqueBars = [...new Set(bars)].sort((a, b) => a - b);
  
  const seq = [];
  uniqueBars.forEach(bar => {
      const startB = bar * 4;
      for(let i=0; i<4; i++) {
          if (startB + i < totalBeats()) seq.push(startB + i);
      }
  });

  if (seq.length === 0) return;

  state.playMode = 'section'; state.selectionHands = ['right', 'left'];
  playbackSeq = seq;
  state.isPlaying = true; currentStep = 0; nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if (pBar) pBar.style.width = '0%';
  scheduler();
}

function buildSequenceForRange(startSectionLine, endSectionLine) {
  const totalLines = Math.ceil(state.numBars / BARS_PER_VAK);
  let absoluteEndLine = totalLines;
  for (let l = endSectionLine + 1; l <= totalLines; l++) {
      if (state.sections && state.sections[l] !== undefined) {
          absoluteEndLine = l - 1;
          break;
      }
  }

  const seq = [];
  let currentLine = startSectionLine;
  const repeated = new Set();
  const MAX_STEPS = (absoluteEndLine - startSectionLine + 1) * 8; let steps = 0;

  while (currentLine <= absoluteEndLine && steps++ < MAX_STEPS) {
      const barsInThisLine = state.lineLengths[currentLine] !== undefined ? state.lineLengths[currentLine] : BARS_PER_VAK;
      const startBeat = (currentLine - 1) * 32;
      const endB = startBeat + (barsInThisLine * 4) - 1;
      for (let b = startBeat; b <= endB; b++) if (b < totalBeats()) seq.push(b);
      
      if (state.repeats && state.repeats[currentLine] !== undefined && !repeated.has(currentLine)) {
          repeated.add(currentLine); 
          let target = parseInt(state.repeats[currentLine], 10);
          if (target >= startSectionLine && target <= currentLine) { currentLine = target; continue; }
      }
      currentLine++;
  }
  return seq;
}

function playSection(startLine) {
  if (state.isPlaying) stopPlayback(true); unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const seq = buildSequenceForRange(startLine, startLine);
  if (seq.length === 0) return;

  state.playMode = 'section'; state.selectionHands = ['right', 'left'];
  playbackSeq = seq;
  state.isPlaying = true; currentStep = 0; nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if (pBar) pBar.style.width = '0%';
  scheduler();
}

function openPlayRangeModal(startLineNum) {
    sectionLineMap = Object.keys(state.sections || {}).map(Number).sort((a,b)=>a-b);
    if (!sectionLineMap.includes(1)) sectionLineMap.unshift(1); 
    
    if (sectionLineMap.length === 0) {
        showToast('คุณยังไม่ได้สร้าง "ท่อน" ใดๆ โปรดแทรกท่อนก่อน', 'error');
        return;
    }

    const startSelect = document.getElementById('prStartSel');
    const endSelect = document.getElementById('prEndSel');
    startSelect.innerHTML = '';
    endSelect.innerHTML = '';
    
    sectionLineMap.forEach((lineNum, idx) => {
        const secName = (state.sections && state.sections[lineNum]) ? state.sections[lineNum] : `ท่อนที่ ${idx+1}`;
        startSelect.add(new Option(secName, idx + 1));
        endSelect.add(new Option(secName, idx + 1));
    });

    let startIndex = sectionLineMap.indexOf(startLineNum);
    if (startIndex === -1) startIndex = 0;
    
    startSelect.value = startIndex + 1;
    endSelect.value = sectionLineMap.length;
    
    document.getElementById('playRangeModal').classList.add('show');
}

function playSectionRange(startSectionLine, endSectionLine) {
  if (state.isPlaying) stopPlayback(true); unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const seq = buildSequenceForRange(startSectionLine, endSectionLine);
  if (seq.length === 0) return;

  state.playMode = 'section'; state.selectionHands = ['right', 'left'];
  playbackSeq = seq;
  state.isPlaying = true; currentStep = 0; nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if (pBar) pBar.style.width = '0%';
  scheduler();
}

function playLineRange(startLine, endLine) {
  if (state.isPlaying) stopPlayback(true); unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const seq = [];
  for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
    const barsInThisLine = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : BARS_PER_VAK;
    const startBeat = (lineNum - 1) * 32;
    const endBeat = startBeat + (barsInThisLine * 4) - 1;
    for (let b = startBeat; b <= endBeat; b++) if (b < totalBeats()) seq.push(b);
  }
  if (seq.length === 0) return;

  state.playMode = 'section'; state.selectionHands = ['right', 'left'];
  playbackSeq = seq;
  state.isPlaying = true; currentStep = 0; nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if (pBar) pBar.style.width = '0%';
  scheduler();
  startVisualSync();
}

function playLine(lineNum) {
  if (state.isPlaying && state.playMode === 'line' && state.currentPlayingLine === lineNum) {
      stopPlayback(true);
      return;
  }

  if (state.isPlaying) stopPlayback(true); 
  unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const barsInThisLine = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : 8;
  const startBeat = (lineNum - 1) * 32;
  const endBeat = startBeat + (barsInThisLine * 4) - 1;
  
  const seq = [];
  for (let b = startBeat; b <= endBeat; b++) {
      if (b < totalBeats()) seq.push(b);
  }
  
  if (state.repeats && state.repeats[lineNum] !== undefined) {
      let target = parseInt(state.repeats[lineNum], 10);
      if (target === lineNum) {
          for (let b = startBeat; b <= endBeat; b++) {
              if (b < totalBeats()) seq.push(b);
          }
      } else {
          showToast(`โหมด "เล่นวรรค" จะไม่วนข้ามบรรทัด กรุณาใช้ปุ่ม "▶ เล่นท่อนนี้" ด้านบนแทน`, 'success');
      }
  }

  if (seq.length === 0) return;

  state.playMode = 'line'; 
  state.currentPlayingLine = lineNum;
  state.selectionHands = ['right', 'left'];
  playbackSeq = seq;
  state.isPlaying = true; currentStep = 0; nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if (pBar) pBar.style.width = '0%';
  
  // อัปเดต UI ของปุ่มเล่นบรรทัด โดยไม่ต้อง render ใหม่ทั้งหน้า
  const activeWrap = document.querySelector(`.line-wrap[data-line-num="${lineNum}"]`);
  if (activeWrap) {
      const activeBtn = activeWrap.querySelector('.line-play-btn');
      if (activeBtn) {
          activeBtn.textContent = '■';
          activeBtn.className = 'line-play-btn stop-active';
      }
  }

  scheduler();
}

let playbackEndTimer = null, playbackVisualTimers = [], playbackActiveMasters = [];
let schedulerTimer = null; let currentStep = 0; let nextNoteTime = 0; let playbackSeq = [];

// --- Visual sync loop -----------------------------------------------------
// เดิม flashGong/highlight ถูกยิงด้วย setTimeout(ms) แยกทีละอัน คำนวณ delay ครั้งเดียวตอน schedule
// ปัญหา: setTimeout ไม่แม่นยำ และเบราว์เซอร์จะ throttle timer เมื่อ tab ไม่ active (background)
// ทำให้เสียง (Web Audio, เดินด้วย audio-hardware clock ที่แม่นยำและไม่ถูก throttle) กับภาพ (setTimeout) เพี้ยนออกจากกัน
// วิธีแก้: เก็บ event เป็นคิวที่เรียงตามเวลา (audio-clock time) แล้วใช้ rAF วน "เทียบเวลาจริง" ทุกเฟรมแทน
// ข้อดี: ไม่มี drift สะสม เพราะเช็คกับ ctx.currentTime ตรงๆทุกครั้ง และถ้า tab ถูกซ่อนแล้วกลับมา (rAF หยุดเองตอนซ่อน)
// พอกลับมาเฟรมแรกจะ "ไล่ยิง" ทุก event ที่เลยเวลาไปแล้วรวดเดียว ทำให้ภาพกระโดดไปตรงกับเสียงทันที ไม่ใช่ค้าง/กระตุกตามหลัง
let _visualSyncRAF = null;
function startVisualSync() {
  if (_visualSyncRAF !== null) return; // กันไม่ให้มีลูปซ้อนกัน
  _visualSyncRAF = requestAnimationFrame(visualSyncTick);
}
function stopVisualSync() {
  if (_visualSyncRAF !== null) { cancelAnimationFrame(_visualSyncRAF); _visualSyncRAF = null; }
}
function visualSyncTick() {
  if (!state.isPlaying) { _visualSyncRAF = null; return; }
  const ctx = ac();
  const now = ctx ? ctx.currentTime : 0;
  // playbackVisualTimers ถูก push เรียงตามเวลาเพิ่มขึ้นเสมอ (step/time เดินหน้าอย่างเดียว) จึงยิงจากหัวคิวได้เลย
  while (playbackVisualTimers.length && playbackVisualTimers[0].time <= now) {
    const ev = playbackVisualTimers.shift();
    try { ev.run(); } catch (_) {}
  }
  _visualSyncRAF = requestAnimationFrame(visualSyncTick);
}

function startPlayback() {
  if (state.isPlaying) return; unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  // เริ่มจากต้นเสมอ (หยุดแล้วเล่นใหม่ทุกครั้ง)
  playbackSeq = getPlaybackSequence();
  currentStep = 0;

  state.isPlaying = true; state.playMode = 'all';
  nextNoteTime = ctx.currentTime + 0.1; state.playStart = nextNoteTime;
  playbackActiveMasters = []; playbackVisualTimers = [];
  _autoScrollLastLine = null;
  const pBar = document.getElementById('playbackBar'); if(pBar) pBar.style.width = '0%';
  if (typeof window._syncFocusPlayBtn === 'function') window._syncFocusPlayBtn();
  if (typeof window._focusSeekRebuild === 'function') window._focusSeekRebuild();
  scheduler();
  startVisualSync();
}

function scheduler() {
  if (!state.isPlaying) return; const ctx = ac(); 
  const lookahead = 25.0; const scheduleAheadTime = 0.15; 
  
  const currentBeatDur = 60 / state.bpm; // bpm ไม่เปลี่ยนระหว่าง loop — คำนวณครั้งเดียว
  while (currentStep < playbackSeq.length && nextNoteTime < ctx.currentTime + scheduleAheadTime) {
      scheduleBeat(currentStep, nextNoteTime); 
      nextNoteTime += currentBeatDur; 
      currentStep++;
  }
  
  if (currentStep < playbackSeq.length) { schedulerTimer = setTimeout(scheduler, lookahead); } 
  else { playbackEndTimer = setTimeout(() => stopPlayback(), (nextNoteTime - ctx.currentTime + 0.5) * 1000); }
}

// --- lookup map: beat -> [cells] สร้างครั้งเดียวหลัง renderNotation ---
let _beatCellMap = null;
function _buildBeatCellMap() {
  _beatCellMap = new Map();
  document.querySelectorAll('.beat-cell[data-beat]').forEach(el => {
    const b = parseInt(el.dataset.beat);
    if (!_beatCellMap.has(b)) _beatCellMap.set(b, []);
    _beatCellMap.get(b).push(el);
  });
}
let _currentBeatCells = [];   // cells ที่ highlight อยู่ตอนนี้
let _autoScrollLastLine = null; // บรรทัดล่าสุดที่ scroll ไป

// ระบบ Lerp Scroll เพื่อความนุ่มนวลสูงสุด (ไม่กระตุกตามจังหวะบีท)
let _scrollLerpId = null;
let _scrollTarget = 0;
let _scrollWrapper = null;

function smoothScrollTick() {
    if (!_scrollWrapper) return;
    const current = _scrollWrapper.scrollLeft;
    const diff = _scrollTarget - current;

    // ถ้ายังห่างเป้าหมายอยู่ ให้เลื่อนเข้าหาเป้า 8% ของระยะที่เหลือในทุกๆ เฟรม
    if (Math.abs(diff) > 0.5) {
        _scrollWrapper.scrollLeft = current + diff * 0.08;
        _scrollLerpId = requestAnimationFrame(smoothScrollTick);
    } else {
        _scrollWrapper.scrollLeft = _scrollTarget; // ถึงเป้าหมายแล้ว ล็อคให้เป๊ะ
        _scrollLerpId = null;
    }
}

function setScrollTarget(wrapper, target, instant = false) {
    _scrollWrapper = wrapper;
    _scrollTarget = target;
    if (instant) {
        if (_scrollLerpId) cancelAnimationFrame(_scrollLerpId);
        _scrollLerpId = null;
        wrapper.scrollLeft = target;
    } else {
        if (!_scrollLerpId) {
            _scrollLerpId = requestAnimationFrame(smoothScrollTick);
        }
    }
}

function scheduleBeat(step, time) {
  const beat = playbackSeq[step];
  const handsToPlay = (state.playMode === 'selection' || state.playMode === 'section' || state.playMode === 'line') ? state.selectionHands : ['right', 'left'];
  
  for (const hand of handsToPlay) {
      const gong = state.notes[hand][beat]; if (gong == null) continue;
      const master = playGong(gong, time); if (master) playbackActiveMasters.push(master);
      // ยิงเล็กน้อยก่อนเวลาจริง 5ms เพื่อชดเชย perception lag เดิม (คงพฤติกรรมเดิมไว้)
      playbackVisualTimers.push({ time: Math.max(0, time - 0.005), run: () => flashGong(gong) });
  }

  // เสียงเคาะจังหวะเบาๆ ที่โน้ตตัวที่ 4 ของทุกห้อง (beat % 4 === 3) — เปิด/ปิดได้ที่ toggle
  const metroToggle = document.getElementById('metronomeToggle');
  if (metroToggle && metroToggle.checked && (beat % 4 === 3)) {
      const clickMaster = playMetronomeClick(time);
      if (clickMaster) playbackActiveMasters.push(clickMaster);
  }
  
  playbackVisualTimers.push({ time, run: () => {
      if (!state.isPlaying) return; state.currentBeat = beat;
      const pct = Math.round((step / Math.max(1, playbackSeq.length - 1)) * 100);

      const prevCells = _currentBeatCells;
      const nextCells = (_beatCellMap && _beatCellMap.get(beat)) || [];

      // ===== READ PHASE: อ่านค่า layout ทั้งหมดก่อน ยังไม่แตะ DOM เลย =====
      // (ทำก่อน write ทุกตัว เพื่อเลี่ยง forced synchronous reflow — ปลอดภัย
      //  เพราะ current-beat ใช้แค่ outline/background ซึ่งไม่กระทบ geometry ของ cell)
      let autoScrollOn = false;
      let lineWrap = null, scrollTarget = null, isNewLine = false, thisLine = null;
      let wrapper = null, targetScroll = 0;

      if (nextCells.length > 0) {
        const autoScroll = document.getElementById('autoScrollToggle');
        autoScrollOn = !autoScroll || autoScroll.checked;

        if (autoScrollOn) {
          // scroll ทั้งบรรทัด (line-wrap) ให้อยู่กลางจอ ทุกครั้งที่เปลี่ยนบรรทัด
          lineWrap = nextCells[0].closest('.line-wrap');
          scrollTarget = lineWrap || nextCells[0];
          thisLine = lineWrap ? lineWrap.dataset.lineNum : null;
          isNewLine = thisLine !== _autoScrollLastLine;

          // เลื่อนหน้าจอแนวนอนตามตัวโน้ต
          const cell = nextCells[0];
          wrapper = cell.closest('.notation-wrapper');
          if (wrapper) {
            // คำนวณตำแหน่งที่แน่นอนของตัวโน้ตโดยใช้ getBoundingClientRect เพื่อความแม่นยำสูงสุด
            const cellRect = cell.getBoundingClientRect();
            const wrapRect = wrapper.getBoundingClientRect();

            // ตำแหน่งกึ่งกลางโน้ตสัมพัทธ์กับเนื้อหาทั้งหมดภายในตาราง (ตำแหน่งปัจจุบันบนจอ + ระยะที่เลื่อนไปแล้ว)
            const absoluteCellCenter = (cellRect.left + cellRect.width / 2) - wrapRect.left + wrapper.scrollLeft;

            // ล็อคตำแหน่งตัวโน้ตปัจจุบันให้อยู่ที่ 30% ของหน้าจอเสมอ
            targetScroll = absoluteCellCenter - wrapRect.width * 0.30;

            // ป้องกันไม่ให้เลื่อนเกินขอบซ้าย (0) และขอบขวาสุด
            const maxScroll = wrapper.scrollWidth - wrapRect.width;
            targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
          }
        }
      }

      // ===== WRITE PHASE: เขียน DOM ทั้งหมดรวดเดียว หลังอ่านครบแล้ว =====
      const bar = document.getElementById('playbackBar'); if (bar) bar.style.width = pct + '%';
      if (typeof window._focusSeekUpdate === 'function') window._focusSeekUpdate(step);

      // ลบ highlight เก่า แบบ O(1) จาก cache
      prevCells.forEach(c => c.classList.remove('current-beat'));
      _currentBeatCells = nextCells;
      _currentBeatCells.forEach(c => c.classList.add('current-beat'));

      if (nextCells.length > 0 && autoScrollOn) {
        if (isNewLine) {
          _autoScrollLastLine = thisLine;
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (wrapper) {
          if (isNewLine) {
            // บังคับกลับซ้ายสุดทันทีเมื่อขึ้นบรรทัดใหม่ แบบไม่มีแอนิเมชัน
            setScrollTarget(wrapper, 0, true);
            // หลังจากดีดกลับซ้ายสุดแล้ว ค่อยๆ ให้มันไหลไปตำแหน่งเป้าหมายต่อ
            if (targetScroll > 0) {
                setTimeout(() => setScrollTarget(wrapper, targetScroll, false), 50);
            }
          } else {
            // อัปเดตเป้าหมาย แล้วปล่อยให้ Lerp Animation ค่อยๆ ไหลตามไปอย่างนุ่มนวล
            setScrollTarget(wrapper, targetScroll, false);
          }
        }
      }
  } });
}

function stopPlayback(cutAudio = false) {
  if (!state.isPlaying && playbackActiveMasters.length === 0) return;

  state.isPlaying = false; state.currentBeat = -1; state.currentPlayingLine = null;
  if (schedulerTimer) { clearTimeout(schedulerTimer); schedulerTimer = null; }
  if (playbackEndTimer) { clearTimeout(playbackEndTimer); playbackEndTimer = null; }
  stopVisualSync();
  playbackVisualTimers = [];

  // หยุด animation เลื่อนหน้าจอ
  if (_scrollLerpId) { cancelAnimationFrame(_scrollLerpId); _scrollLerpId = null; }

  // ใช้ cache แทน querySelectorAll
  _currentBeatCells.forEach(c => c.classList.remove('current-beat'));
  _currentBeatCells = [];
  _autoScrollLastLine = null;

  if (cutAudio && audioCtx) {
    const now = audioCtx.currentTime;
    for (const master of playbackActiveMasters) {
      if (!master || !master.gain) continue;
      try { master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value || 0, now); master.gain.linearRampToValueAtTime(0, now + 0.05); } catch (_) {}
    }
  }
  playbackActiveMasters = [];

  // reset เสมอ — ไม่ว่าจะหยุดเองหรือผู้ใช้กดหยุด ให้กลับไปเริ่มต้นใหม่ทุกครั้ง
  playbackSeq = [];
  currentStep = 0;
  state.playMode = 'all';
  const bar = document.getElementById('playbackBar'); if (bar) bar.style.width = '0%';
  if (typeof window._focusSeekUpdate === 'function') window._focusSeekUpdate(0);

  if (typeof window._syncFocusPlayBtn === 'function') window._syncFocusPlayBtn();

  // รีเซ็ตปุ่ม ▶ ของบรรทัดที่เคยเล่นค้างไว้
  document.querySelectorAll('.line-play-btn.stop-active').forEach(btn => {
      btn.textContent = '▶';
      btn.className = 'line-play-btn';
  });
}

let isExporting = false;



function ensureLamejs() {
  return Promise.resolve(); // lamejs ถูก embed ไว้แล้ว ไม่ต้องโหลด
}

function fmtSec(s) {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function setExportProgress(pct, statusText) {
  const bar   = document.getElementById('exMp3ProgressBar');
  const pctEl = document.getElementById('exMp3PercentText');
  const txt   = document.getElementById('exMp3StatusText');
  if (bar)   bar.style.width   = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (txt)   txt.textContent   = statusText;
}

let _exportStartTime = 0;
let _elapsedTimer = null;

function startExportTimer(songDurationSec) {
  _exportStartTime = Date.now();
  const durEl = document.getElementById('exMp3SongDuration');
  const elEl  = document.getElementById('exMp3Elapsed');
  if (durEl) durEl.textContent = fmtSec(songDurationSec);
  _elapsedTimer = setInterval(() => {
    const elapsed = (Date.now() - _exportStartTime) / 1000;
    if (elEl) elEl.textContent = fmtSec(elapsed);
  }, 500);
}

function stopExportTimer() {
  if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
}

function showExportProgress() {
  const selArea  = document.getElementById('exMp3SelectArea');
  const progArea = document.getElementById('exMp3ProgressArea');
  if (selArea)  selArea.style.display  = 'none';
  if (progArea) progArea.style.display = 'flex';
  setExportProgress(0, 'กำลังเตรียมข้อมูล...');
  const elEl  = document.getElementById('exMp3Elapsed');
  const durEl = document.getElementById('exMp3SongDuration');
  if (elEl)  elEl.textContent  = '0:00';
  if (durEl) durEl.textContent = '—';
}

function hideExportProgress() {
  const selArea  = document.getElementById('exMp3SelectArea');
  const progArea = document.getElementById('exMp3ProgressArea');
  if (selArea)  selArea.style.display  = '';
  if (progArea) progArea.style.display = 'none';
  document.getElementById('exportMp3Modal').classList.remove('show');
}

async function exportMP3(customSeq = null, suffix = '') {
  if (isExporting) { showToast('กำลังสร้างไฟล์ MP3 อยู่ กรุณารอสักครู่...', 'error'); return; }
  if (!state.notes.right.some(n => n !== null) && !state.notes.left.some(n => n !== null)) {
    hideExportProgress();
    return showToast('ไม่มีโน้ตที่จะส่งออก', 'error');
  }

  isExporting = true;
  showExportProgress();

  try {
    setExportProgress(2, 'โหลดไลบรารีเสียง...');
    await ensureLamejs();

    const beatDur = 60 / state.bpm;
    const seq = customSeq || getPlaybackSequence();
    if (seq.length === 0) throw new Error('ไม่พบช่วงโน้ตที่จะเล่น');

    const tailSec = Math.max(3.5, beatDur * 4);
    const songDurationSec = seq.length * beatDur;
    startExportTimer(songDurationSec);

    setExportProgress(8, 'เตรียมเสียงลูกฆ้อง...');
    await new Promise(r => setTimeout(r, 10));

    const sampleRate = 44100;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) throw new Error('เบราว์เซอร์ไม่รองรับ OfflineAudioContext');

    // ─── STEP 1: Pre-render แต่ละโน้ตเป็น AudioBuffer ครั้งเดียว ───
    // วิธีนี้เร็วกว่าใช้ oscillators ใน offline context โดยตรงมาก
    // เพราะ graph ใหญ่ (5 osc + filter + gain ต่อโน้ต) ทำให้ render ช้า
    const inst = getActiveInst();
    const uniqueGongs = new Set();
    for (let step = 0; step < seq.length; step++) {
      const beat = seq[step];
      for (const hand of ['right', 'left']) {
        const g = state.notes[hand][beat];
        if (g != null) uniqueGongs.add(g);
      }
    }
    const gongList = [...uniqueGongs];
    const gongBuffers = {};

    // เสียงเคาะจังหวะ: เตรียมไว้ล่วงหน้าถ้าผู้ใช้เปิดใช้งาน toggle
    const includeMetronome = !!document.getElementById('metronomeToggle')?.checked;
    let clickBuffer = null;

    // render เสียง 1 ลูก ≈ 3 วินาที (decay ยาวสุด) ใช้เวลาน้อยมากเพราะ buffer สั้น
    const oneShotDur = 3.2; // วินาที — ครอบ decay ยาวสุด (2.8s) + หาง
    const oneShotLen = Math.ceil(sampleRate * oneShotDur);

    for (let gi = 0; gi < gongList.length; gi++) {
      const gongIdx = gongList[gi];
      const freq = inst.freqs[gongIdx];
      const miniCtx = new OfflineCtx(2, oneShotLen, sampleRate);
      playGongFreq(freq, 0, 1, miniCtx);
      gongBuffers[gongIdx] = await miniCtx.startRendering();
      const pct = 8 + Math.round(((gi + 1) / gongList.length) * 22); // 8→30%
      setExportProgress(pct, `เตรียมเสียง ${gi + 1}/${gongList.length} ลูก...`);
    }

    if (includeMetronome) {
      setExportProgress(30, 'เตรียมเสียงเคาะจังหวะ...');
      const clickLen = Math.ceil(sampleRate * 0.12);
      const miniClickCtx = new OfflineCtx(2, clickLen, sampleRate);
      playMetronomeClick(0, 1, miniClickCtx);
      clickBuffer = await miniClickCtx.startRendering();
    }

    // ─── STEP 2: Assemble เพลงโดย place AudioBufferSourceNode ───
    // เร็วมากเพราะไม่ต้อง synthesize oscillator ซ้ำ
    setExportProgress(32, 'ประกอบเพลง...');
    await new Promise(r => setTimeout(r, 10));

    const duration = seq.length * beatDur + tailSec;
    const renderLength = Math.ceil(sampleRate * duration);
    const offlineCtx = new OfflineCtx(2, renderLength, sampleRate);

    for (let step = 0; step < seq.length; step++) {
      const beat = seq[step]; const t = step * beatDur;
      for (const hand of ['right', 'left']) {
        const gong = state.notes[hand][beat]; if (gong == null) continue;
        const src = offlineCtx.createBufferSource();
        src.buffer = gongBuffers[gong];
        src.connect(offlineCtx.destination);
        src.start(t);
      }
      if (includeMetronome && clickBuffer && (beat % 4 === 3)) {
        const clickSrc = offlineCtx.createBufferSource();
        clickSrc.buffer = clickBuffer;
        clickSrc.connect(offlineCtx.destination);
        clickSrc.start(t);
      }
    }

    setExportProgress(38, 'render เสียงรวม...');
    let renderedBuffer;
    {
      // เดิมใช้ offlineCtx.suspend(pos)/resume() วนทุก 1 วินาทีเพื่ออัปเดต progress
      // ปัญหา: ยิง suspend() หลายจุดพร้อมกันแบบไม่รอกัน ถ้าจังหวะ suspend ตรงกับขอบ buffer พอดี
      // (โดยเฉพาะ Safari) promise อาจไม่ resolve และ error ถูกกลืนเงียบด้วย .catch(()=>{})
      // ทำให้ resume() ในจุดนั้นไม่ถูกเรียก และ startRendering() ค้างไปเลยโดยไม่มี error ให้เห็น
      // แก้โดยปล่อย render รวดเดียว (เร็วอยู่แล้วสำหรับเพลงสั้นๆ) แล้วจำลอง progress ด้วย timer ธรรมดาแทน
      let lastPct = 38;
      const estMs = Math.max(300, duration * 60); // เวลาโดยประมาณที่ render จะใช้ (คร่าวๆ ตามความยาวเพลง)
      const startedAt = performance.now();
      const progressTimer = setInterval(() => {
        const frac = Math.min(0.97, (performance.now() - startedAt) / estMs);
        const pct = 38 + Math.round(frac * 12); // 38→50%
        if (pct > lastPct) { lastPct = pct; setExportProgress(pct, 'render เสียงรวม...'); }
      }, 150);

      try {
        renderedBuffer = await offlineCtx.startRendering();
      } finally {
        clearInterval(progressTimer);
      }
      setExportProgress(50, 'render เสียงรวมเสร็จสิ้น');
    }

    setExportProgress(50, 'แปลงเป็น MP3...');
    await new Promise(r => setTimeout(r, 10));

    const mp3encoder = new window.lamejs.Mp3Encoder(2, renderedBuffer.sampleRate, 128);
    const mp3Data = [];
    const left   = renderedBuffer.getChannelData(0);
    const right   = renderedBuffer.getChannelData(1);
    const sampleBlockSize = 1152;
    const leftInt16  = new Int16Array(left.length);
    const rightInt16 = new Int16Array(right.length);

    for (let i = 0; i < left.length; i++) {
      leftInt16[i]  = left[i]  < 0 ? left[i]  * 32768 : left[i]  * 32767;
      rightInt16[i] = right[i] < 0 ? right[i] * 32768 : right[i] * 32767;
    }

    const CHUNK_SIZE = sampleBlockSize * 100;
    for (let i = 0; i < left.length; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE, left.length);
      for (let j = i; j < end; j += sampleBlockSize) {
        const mp3buf = mp3encoder.encodeBuffer(
          leftInt16.subarray(j, j + sampleBlockSize),
          rightInt16.subarray(j, j + sampleBlockSize)
        );
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
      }
      const progress = 50 + Math.round((end / left.length) * 45);
      setExportProgress(progress, `แปลงเป็น MP3... ${Math.round((end / left.length) * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
    }

    const finalBuf = mp3encoder.flush();
    if (finalBuf.length > 0) mp3Data.push(finalBuf);
    if (mp3Data.length === 0) throw new Error('ไม่มีข้อมูลเสียงที่จะบันทึก');

    setExportProgress(97, 'กำลังดาวน์โหลด...');
    await new Promise(r => setTimeout(r, 50));

    const safeName = getSafeFilename(state.songName);
    const fileName = `${safeName}${suffix}_${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.mp3`;
    const blob = new Blob(mp3Data, { type: 'audio/mpeg' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
    } catch (clickErr) {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      throw clickErr;
    }

    setExportProgress(100, '✓ ดาวน์โหลดสำเร็จ!');
    await new Promise(r => setTimeout(r, 900));
    showToast('ดาวน์โหลด MP3 สำเร็จ!', 'success');

  } catch (err) {
    showToast('Export MP3 ล้มเหลว: ' + err.message, 'error');
  } finally {
    stopExportTimer();
    isExporting = false;
    hideExportProgress();
  }
}

function exportNotation() {
  if (chordTimer) { clearTimeout(chordTimer); commitChord(); }
  const data = { 
    type: 'khong-wong-yai-notation', 
    version: 5, 
    instrument: currentInstrument,
    songName: state.songName, tempo: state.bpm, 
    vak: state.numBars / BARS_PER_VAK, repeats: state.repeats || {}, sections: state.sections || {}, lineLengths: state.lineLengths || {},
    notes: { right: [...state.notes.right], left: [...state.notes.left] } 
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const safeName = getSafeFilename(state.songName); const a = document.createElement('a'); 
  a.href = URL.createObjectURL(blob); a.download = `${safeName}_${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.json`;
  a.click();
}

