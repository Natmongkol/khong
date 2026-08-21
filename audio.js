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

// ===== Master bus + Limiter =====
// กันเสียงแตก/ซ่า/กระตุกตอนหลายลูกดังซ้อนกัน (เสียงค้าง ~2.8s ต่อลูก, คอร์ด, และคู่แปดที่เพิ่มมาทำให้เสียงซ้อนกันบ่อยขึ้น)
// เดิมทุกลูกฆ้อง/ระนาดต่อตรงเข้า ctx.destination โดยไม่มีการจำกัดระดับเสียงรวม พอสัญญาณรวมเกิน 0dBFS
// เบราว์เซอร์จะ hard-clip เงียบๆ กลายเป็นเสียงนอยส์/กระตุก ทั้งตอนเล่นสดและตอน export MP3 (คนละ context กัน จึงต้อง cache แยกตาม ctx)
const _masterBusCache = new WeakMap();
function getMasterBus(ctx) {
  if (_masterBusCache.has(ctx)) return _masterBusCache.get(ctx);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 6;
  comp.attack.value = 0.003; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  _masterBusCache.set(ctx, comp);
  return comp;
}

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
    master.connect(lp); lp.connect(getMasterBus(ctx));

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
    const noiseEnv = ctx.createGain(); noiseEnv.gain.setValueAtTime(0.11, t); noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    
    noise.connect(noiseFilter); noiseFilter.connect(noiseEnv); noiseEnv.connect(master); noise.start(t);
    noise.onended = () => { try { noise.disconnect(); noiseFilter.disconnect(); noiseEnv.disconnect(); } catch(e){} };

    // ล้าง master/lp เมื่อ osc ที่อายุยาวสุด (maxDecay) จบ — ป้องกัน node สะสม
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

// ===== ขลุ่ยเพียงออ: เสียงตัวอย่างที่บันทึกจากเครื่องจริง =====
// เก็บไฟล์ไว้ใน assets/khluy และโหลดครั้งเดียว แล้วใช้ได้ทั้งการเล่นสดและ export MP3
const KHLUY_SAMPLE_FILES = ['ด.mp3', 'ร.mp3', 'ม.mp3', 'ฟ.mp3', 'ซ.mp3', 'ล.mp3', 'ท.mp3', 'ดํ.mp3'];
let khluySampleBuffers = null;
let khluySampleLoadPromise = null;
let activeKhluyVoice = null;
// ไฟล์ตัวอย่างถูกบันทึกมาที่ระดับค่อนข้างสูง จึงเผื่อ headroom ไว้ก่อนรวมกับฉิ่ง/เมโทรนอม
// เพื่อไม่ให้สัญญาณรวมชนกันจนเกิด clipping หรือ compressor pumping.
const KHLUY_PLAYBACK_GAIN = 0.46;
const CHING_PLAYBACK_GAIN = 0.28;
const METRONOME_PLAYBACK_GAIN = 0.10;
const SAMPLE_ATTACK_SEC = 0.008;
// จำกัดเสียงขลุ่ยแต่ละโน้ตไม่ให้ยาวเกิน 1 ห้อง (4 จังหวะ)
const KHLUY_MAX_BEATS_PER_NOTE = 4;

function khluyNoteDuration() {
  return KHLUY_MAX_BEATS_PER_NOTE * (60 / state.bpm);
}

function stopKhluyVoice(voice, when) {
  if (!voice) return;
  const t = Math.max(voice.ctx.currentTime, when);
  try {
    // คง envelope ณ เวลาที่ถูกตัดก่อน แล้วค่อยลดลง: ห้ามตั้ง gain กลับไปเป็นค่าคงที่
    // เพราะหากโน้ตก่อนหน้ากำลัง fade out จะเกิดการกระโดดของ waveform และได้ยินเป็นเสียงช็อต
    if (typeof voice.level.gain.cancelAndHoldAtTime === 'function') {
      voice.level.gain.cancelAndHoldAtTime(t);
    } else {
      voice.level.gain.cancelScheduledValues(t);
    }
    voice.level.gain.linearRampToValueAtTime(0, t + 0.025);
    voice.source.stop(t + 0.03);
  } catch (_) {}
}

async function ensureKhluySamples() {
  if (khluySampleBuffers) return khluySampleBuffers;
  if (khluySampleLoadPromise) return khluySampleLoadPromise;

  const ctx = ac();
  if (!ctx) throw new Error('ไม่สามารถเริ่มระบบเสียงได้');
  khluySampleLoadPromise = Promise.all(KHLUY_SAMPLE_FILES.map(async (fileName) => {
    const response = await fetch(`assets/khluy/${encodeURIComponent(fileName)}`);
    if (!response.ok) throw new Error(`ไม่พบไฟล์เสียงขลุ่ย ${fileName}`);
    return ctx.decodeAudioData(await response.arrayBuffer());
  })).then((buffers) => {
    khluySampleBuffers = buffers;
    return buffers;
  }).catch((error) => {
    khluySampleLoadPromise = null;
    throw error;
  });
  return khluySampleLoadPromise;
}

function playKhluySample(idx, when, gain = 1, customCtx = null) {
  const buffer = khluySampleBuffers && khluySampleBuffers[idx];
  if (!buffer) {
    ensureKhluySamples().catch((error) => console.error('โหลดเสียงขลุ่ยไม่สำเร็จ:', error));
    return null;
  }
  try {
    const ctx = customCtx || ac(); if (!ctx) return null;
    const t = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const level = ctx.createGain(); level.gain.value = 0;
    // ขลุ่ยเป็นเครื่องเดี่ยว: โน้ตใหม่ต้องหยุดโน้ตก่อนหน้า ไม่ปล่อยให้เสียงซ้อนกัน
    if (!customCtx && activeKhluyVoice) stopKhluyVoice(activeKhluyVoice, t);
    source.connect(level); level.connect(getMasterBus(ctx));
    const duration = Math.min(buffer.duration, khluyNoteDuration());
    const fadeStart = Math.max(t, t + duration - 0.05);
    // ให้ waveform ขึ้นจากศูนย์อย่างนุ่มนวล ป้องกัน click จากจุดเริ่มของไฟล์ MP3
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(KHLUY_PLAYBACK_GAIN * gain, t + SAMPLE_ATTACK_SEC);
    level.gain.setValueAtTime(KHLUY_PLAYBACK_GAIN * gain, fadeStart);
    level.gain.linearRampToValueAtTime(0, t + duration);
    source.start(t);
    source.stop(t + duration + 0.01);
    if (!customCtx) activeKhluyVoice = { source, level, ctx };
    source.onended = () => {
      if (activeKhluyVoice && activeKhluyVoice.source === source) activeKhluyVoice = null;
      try { source.disconnect(); level.disconnect(); } catch (_) {}
    };
    return level;
  } catch (error) { return null; }
}

// ===== ฉิ่ง/ฉับ: เสียงประกอบตามอัตราจังหวะของท่อน =====
const CHING_SAMPLE_FILES = ['ฉิ่ง.mp3', 'ฉับ.mp3'];
let chingSampleBuffers = null;
let chingSampleLoadPromise = null;

async function ensureChingSamples() {
  if (chingSampleBuffers) return chingSampleBuffers;
  if (chingSampleLoadPromise) return chingSampleLoadPromise;

  const ctx = ac();
  if (!ctx) throw new Error('ไม่สามารถเริ่มระบบเสียงได้');
  chingSampleLoadPromise = Promise.all(CHING_SAMPLE_FILES.map(async (fileName) => {
    const response = await fetch(`assets/ching/${encodeURIComponent(fileName)}`);
    if (!response.ok) throw new Error(`ไม่พบไฟล์เสียง ${fileName}`);
    return ctx.decodeAudioData(await response.arrayBuffer());
  })).then((buffers) => {
    chingSampleBuffers = buffers;
    return buffers;
  }).catch((error) => {
    chingSampleLoadPromise = null;
    throw error;
  });
  return chingSampleLoadPromise;
}

function playChingSample(sampleIdx, when, customCtx = null) {
  const buffer = chingSampleBuffers && chingSampleBuffers[sampleIdx];
  if (!buffer) {
    ensureChingSamples().catch((error) => console.error('โหลดเสียงฉิ่งไม่สำเร็จ:', error));
    return null;
  }
  try {
    const ctx = customCtx || ac(); if (!ctx) return null;
    const t = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const level = ctx.createGain(); level.gain.value = 0;
    source.connect(level); level.connect(getMasterBus(ctx));
    // ฉิ่งเป็นเสียงกระทบ จึงใช้ attack สั้นมากพอรักษาหัวเสียง แต่ตัด click จากขอบไฟล์ได้
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(CHING_PLAYBACK_GAIN, t + 0.003);
    source.start(t);
    source.onended = () => { try { source.disconnect(); level.disconnect(); } catch (_) {} };
    return level;
  } catch (_) { return null; }
}

// รูปแบบฉิ่ง/ฉับของ 1 บรรทัด (8 ห้อง × 4 โน้ต)
// - สามชั้น: ฉิ่ง ห้อง 2, 6 โน้ต 4 | ฉับ ห้อง 4, 8 โน้ต 4
// - สองชั้น: ฉิ่ง ห้อง 1, 3, 5, 7 โน้ต 4 | ฉับ ห้อง 2, 4, 6, 8 โน้ต 4
// - ชั้นเดียว: ฉิ่ง โน้ต 2 ทุกห้อง | ฉับ โน้ต 4 ทุกห้อง
function getChingHitForBeat(beat) {
  const lineNum = Math.floor(beat / 32) + 1;
  const rate = effectiveSectionTempoRate(lineNum);
  const beatInLine = beat % 32;
  const roomIndex = Math.floor(beatInLine / 4) + 1; // ห้อง 1–8
  const noteInRoom = (beatInLine % 4) + 1;          // โน้ต 1–4

  if (rate === 'sam-chan') {
    if (noteInRoom !== 4) return null;
    return (roomIndex === 2 || roomIndex === 6) ? 0
      : (roomIndex === 4 || roomIndex === 8) ? 1 : null;
  }
  if (rate === 'song-chan') {
    if (noteInRoom !== 4) return null;
    return roomIndex % 2 === 1 ? 0 : 1;
  }
  // ชั้นเดียว
  if (noteInRoom === 2) return 0;
  if (noteInRoom === 4) return 1;
  return null;
}

const chingToggle = document.getElementById('chingToggle');
if (chingToggle) {
  chingToggle.addEventListener('change', () => {
    if (chingToggle.checked) ensureChingSamples().catch((error) => {
      console.error('โหลดเสียงฉิ่งไม่สำเร็จ:', error);
      showToast('โหลดเสียงฉิ่งไม่สำเร็จ โปรดตรวจสอบไฟล์เสียง', 'error');
    });
  });
}

function playGong(idx, when) { 
    if (currentInstrument === 'khluy') return playKhluySample(idx, when);
    return playGongFreq(getActiveInst().freqs[idx], when); 
}

// เสียงเคาะจังหวะเดิม: คลิกสั้น ๆ ความถี่สูง
function playMetronomeClick(when, customCtx = null) {
  try {
    const ctx = customCtx || ac(); if (!ctx) return null;
    const t = Math.max(ctx.currentTime, (when ?? ctx.currentTime));
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 1800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(METRONOME_PLAYBACK_GAIN, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    osc.connect(env); env.connect(getMasterBus(ctx));
    osc.start(t); osc.stop(t + 0.06);
    osc.onended = () => { try { osc.disconnect(); env.disconnect(); } catch(e) {} };
    return env;
  } catch (err) { return null; }
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
      if (target >= 1 && target <= currentLine) {
        currentLine = target; continue;
      }
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
  startVisualSync();
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
  startVisualSync();
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
  startVisualSync();
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
  startVisualSync();
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
  startVisualSync();
}

let playbackEndTimer = null, playbackVisualTimers = [], playbackActiveMasters = [];
let schedulerTimer = null; let currentStep = 0; let nextNoteTime = 0; let playbackSeq = [];

// --- Visual sync loop -----------------------------------------------------
let _visualSyncRAF = null;
function startVisualSync() {
  if (_visualSyncRAF !== null) return; 
  _visualSyncRAF = requestAnimationFrame(visualSyncTick);
}
function stopVisualSync() {
  if (_visualSyncRAF !== null) { cancelAnimationFrame(_visualSyncRAF); _visualSyncRAF = null; }
}
function visualSyncTick() {
  if (!state.isPlaying) { _visualSyncRAF = null; return; }
  const ctx = ac();
  const now = ctx ? ctx.currentTime : 0;
  while (playbackVisualTimers.length && playbackVisualTimers[0].time <= now) {
    const ev = playbackVisualTimers.shift();
    try { ev.run(); } catch (_) {}
  }
  _visualSyncRAF = requestAnimationFrame(visualSyncTick);
}

function startPlayback() {
  if (state.isPlaying) return; unlockAudio(); const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

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
  
  const currentBeatDur = 60 / state.bpm; 
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
let _currentBeatCells = [];   
let _autoScrollLastLine = null; 

let _scrollLerpId = null;
let _scrollTarget = 0;
let _scrollWrapper = null;

function smoothScrollTick() {
    if (!_scrollWrapper) return;
    const current = _scrollWrapper.scrollLeft;
    const diff = _scrollTarget - current;

    if (Math.abs(diff) > 0.5) {
        _scrollWrapper.scrollLeft = current + diff * 0.08;
        _scrollLerpId = requestAnimationFrame(smoothScrollTick);
    } else {
        _scrollWrapper.scrollLeft = _scrollTarget; 
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
  // ขลุ่ยเป็นเครื่องเดี่ยว: ไม่เล่นข้อมูลมือซ้ายที่อาจค้างมาจากเพลง/เครื่องดนตรีก่อนหน้า
  const handsToPlay = currentInstrument === 'khluy'
    ? ['right']
    : (state.playMode === 'selection' || state.playMode === 'section' || state.playMode === 'line')
      ? state.selectionHands
      : ['right', 'left'];
  
  for (const hand of handsToPlay) {
      const baseGong = state.notes[hand][beat]; 
      if (baseGong == null) continue;

      let gongsToPlay = [baseGong];
      
      // [เพิ่มใหม่] Logic เล่นคู่แปดสำหรับระนาดเอก (โหมดมือเดียว)
      if (state.recordMode === 'one' && currentInstrument === 'ranatek' && hand === 'right') {
          const lowerGong = baseGong - 7; // โน้ตดนตรีไทย 1 คู่แปดห่างกัน 7 เสียง (Index - 7)
          if (lowerGong >= 0) {
              // ถ้ายังอยู่ในขอบเขตของเสียงที่ต่ำที่สุด ให้เพิ่มเข้าไปเล่นพร้อมกัน
              gongsToPlay.push(lowerGong);
          }
      }

      for (const gong of gongsToPlay) {
          const master = playGong(gong, time); 
          if (master) playbackActiveMasters.push(master);
          
          // [แก้ใหม่] กราฟิกไฟกะพริบบนหน้าจอ ให้ขยับทุกโน้ตที่ตี (รวมถึงคู่แปด)
          playbackVisualTimers.push({ time: Math.max(0, time - 0.005), run: () => flashGong(gong) });
      }
  }

  // เมื่อเปิดเมโทรนอม ให้เคาะทุกตัวโน้ตตาม BPM
  const metronomeEl = document.getElementById('metronomeToggle');
  if (metronomeEl && metronomeEl.checked) {
    const clickNode = playMetronomeClick(time);
    if (clickNode) playbackActiveMasters.push(clickNode);
  }

  const chingEl = document.getElementById('chingToggle');
  if (chingEl && chingEl.checked) {
    const chingHit = getChingHitForBeat(beat);
    if (chingHit !== null) {
      const chingNode = playChingSample(chingHit, time);
      if (chingNode) playbackActiveMasters.push(chingNode);
    }
  }
  
  playbackVisualTimers.push({ time, run: () => {
      if (!state.isPlaying) return; state.currentBeat = beat;
      const pct = Math.round((step / Math.max(1, playbackSeq.length - 1)) * 100);

      const prevCells = _currentBeatCells;
      const nextCells = (_beatCellMap && _beatCellMap.get(beat)) || [];

      let autoScrollOn = false;
      let lineWrap = null, scrollTarget = null, isNewLine = false, thisLine = null;
      let wrapper = null, targetScroll = 0;

      if (nextCells.length > 0) {
        const autoScroll = document.getElementById('autoScrollToggle');
        autoScrollOn = !autoScroll || autoScroll.checked;

        if (autoScrollOn) {
          lineWrap = nextCells[0].closest('.line-wrap');
          scrollTarget = lineWrap || nextCells[0];
          thisLine = lineWrap ? lineWrap.dataset.lineNum : null;
          isNewLine = thisLine !== _autoScrollLastLine;

          const cell = nextCells[0];
          wrapper = cell.closest('.notation-wrapper');
          if (wrapper) {
            const cellRect = cell.getBoundingClientRect();
            const wrapRect = wrapper.getBoundingClientRect();
            const absoluteCellCenter = (cellRect.left + cellRect.width / 2) - wrapRect.left + wrapper.scrollLeft;

            targetScroll = absoluteCellCenter - wrapRect.width * 0.30;
            const maxScroll = wrapper.scrollWidth - wrapRect.width;
            targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
          }
        }
      }

      const bar = document.getElementById('playbackBar'); if (bar) bar.style.width = pct + '%';
      if (typeof window._focusSeekUpdate === 'function') window._focusSeekUpdate(step);

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
            setScrollTarget(wrapper, 0, true);
            if (targetScroll > 0) {
                setTimeout(() => setScrollTarget(wrapper, targetScroll, false), 50);
            }
          } else {
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

  if (_scrollLerpId) { cancelAnimationFrame(_scrollLerpId); _scrollLerpId = null; }

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

  playbackSeq = [];
  currentStep = 0;
  state.playMode = 'all';
  const bar = document.getElementById('playbackBar'); if (bar) bar.style.width = '0%';
  if (typeof window._focusSeekUpdate === 'function') window._focusSeekUpdate(0);

  if (typeof window._syncFocusPlayBtn === 'function') window._syncFocusPlayBtn();

  document.querySelectorAll('.line-play-btn.stop-active').forEach(btn => {
      btn.textContent = '▶';
      btn.className = 'line-play-btn';
  });
}

let isExporting = false;
let isMp3ExportCancelRequested = false;

function requestMp3ExportCancel() {
  if (!isExporting || isMp3ExportCancelRequested) return;
  isMp3ExportCancelRequested = true;
  const btn = document.getElementById('cancelExportProgressBtn');
  if (btn) btn.disabled = true;
  setExportProgress(0, 'กำลังยกเลิก… จะหยุดหลังประมวลผลช่วงปัจจุบัน');
}

function throwIfMp3ExportCancelled() {
  if (!isMp3ExportCancelRequested) return;
  const error = new Error('ผู้ใช้ยกเลิกการสร้าง MP3');
  error.name = 'ExportCancelledError';
  throw error;
}



let _lamejsLoadPromise = null;
// โหลด lamejs.js แบบ lazy — เรียกครั้งแรกตอน export MP3 เท่านั้น (ไฟล์นี้ใหญ่ ~150KB
// ไม่ต้องให้ทุกคนที่เปิดหน้าเว็บโหลดไปฟรีๆ ถ้าไม่ได้ export)
function ensureLamejs() {
  if (window.lamejs) return Promise.resolve();
  if (_lamejsLoadPromise) return _lamejsLoadPromise;
  _lamejsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'lamejs.js';
    script.onload = () => resolve();
    script.onerror = () => { _lamejsLoadPromise = null; reject(new Error('โหลด lamejs.js ไม่สำเร็จ')); };
    document.body.appendChild(script);
  });
  return _lamejsLoadPromise;
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
  const cancelBtn = document.getElementById('cancelExportProgressBtn');
  if (cancelBtn) cancelBtn.disabled = false;
}

function hideExportProgress() {
  const selArea  = document.getElementById('exMp3SelectArea');
  const progArea = document.getElementById('exMp3ProgressArea');
  if (selArea)  selArea.style.display  = '';
  if (progArea) progArea.style.display = 'none';
  document.getElementById('exportMp3Modal').classList.remove('show');
  const cancelBtn = document.getElementById('cancelExportProgressBtn');
  if (cancelBtn) cancelBtn.disabled = false;
}

async function exportMP3(customSeq = null, suffix = '') {
  if (isExporting) { showToast('กำลังสร้างไฟล์ MP3 อยู่ กรุณารอสักครู่...', 'error'); return; }
  if (!state.notes.right.some(n => n !== null) && !state.notes.left.some(n => n !== null)) {
    hideExportProgress();
    return showToast('ไม่มีโน้ตที่จะส่งออก', 'error');
  }

  const beatDur = 60 / state.bpm;
  const seq = customSeq || getPlaybackSequence();
  if (seq.length === 0) return showToast('ไม่พบช่วงโน้ตที่จะเล่น', 'error');
  const songDurationSec = seq.length * beatDur;
  isExporting = true;
  isMp3ExportCancelRequested = false;
  showExportProgress();
  try {
    setExportProgress(2, 'โหลดไลบรารีเสียง...');
    await ensureLamejs();
    throwIfMp3ExportCancelled();

    const isKhluy = currentInstrument === 'khluy';
    const chingOn = !!document.getElementById('chingToggle')?.checked;
    if (isKhluy) {
      setExportProgress(5, 'กำลังโหลดเสียงขลุ่ยจริง...');
      await ensureKhluySamples();
      throwIfMp3ExportCancelled();
    }
    if (chingOn) {
      setExportProgress(6, 'กำลังโหลดเสียงฉิ่ง...');
      await ensureChingSamples();
      throwIfMp3ExportCancelled();
    }

    const tailSec = Math.max(3.5, beatDur * 4);
    startExportTimer(songDurationSec);

    setExportProgress(8, isKhluy ? 'เตรียมเสียงขลุ่ย...' : 'เตรียมเสียงลูกฆ้อง...');
    await new Promise(r => setTimeout(r, 10));
    throwIfMp3ExportCancelled();

    const sampleRate = 44100;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) throw new Error('เบราว์เซอร์ไม่รองรับ OfflineAudioContext');

    const inst = getActiveInst();
    const uniqueGongs = new Set();
    for (let step = 0; step < seq.length; step++) {
      const beat = seq[step];
      for (const hand of (isKhluy ? ['right'] : ['right', 'left'])) {
        const g = state.notes[hand][beat];
        if (g != null) {
          uniqueGongs.add(g);
            
            // [เพิ่มใหม่] ดึงโน้ตคู่แปดมาระบุเพื่อสร้าง Buffer ไว้ล่วงหน้า
            if (state.recordMode === 'one' && currentInstrument === 'ranatek' && hand === 'right') {
                const lowerG = g - 7;
                if (lowerG >= 0) uniqueGongs.add(lowerG);
            }
        }
      }
    }
    const gongList = [...uniqueGongs];
    const gongBuffers = {};

    let oneShotDur = isKhluy
      ? Math.max(...gongList.map((idx) => khluySampleBuffers[idx].duration))
      : 3.2;
    if (chingOn) oneShotDur = Math.max(oneShotDur, ...chingSampleBuffers.map((buffer) => buffer.duration));
    const oneShotLen = Math.ceil(sampleRate * oneShotDur);

    for (let gi = 0; gi < gongList.length; gi++) {
      throwIfMp3ExportCancelled();
      const gongIdx = gongList[gi];
      if (isKhluy) {
        gongBuffers[gongIdx] = khluySampleBuffers[gongIdx];
      } else {
        const freq = inst.freqs[gongIdx];
        const miniCtx = new OfflineCtx(2, oneShotLen, sampleRate);
        playGongFreq(freq, 0, 1, miniCtx);
        gongBuffers[gongIdx] = await miniCtx.startRendering();
      }
      throwIfMp3ExportCancelled();
      const pct = 8 + Math.round(((gi + 1) / gongList.length) * 22); 
      setExportProgress(pct, isKhluy
        ? `เตรียมเสียงขลุ่ย ${gi + 1}/${gongList.length} ตัว...`
        : `เตรียมเสียง ${gi + 1}/${gongList.length} ลูก...`);
    }

    // Render/encode ทีละช่วง เพื่อไม่สร้าง PCM ของทั้งเพลงพร้อมกันในหน่วยความจำ.
    // ช่วงที่เริ่มกลางเสียงจะใส่โน้ตก่อนหน้ากลับเข้ามาพร้อม offset เพื่อให้เสียงกังวานต่อเนื่อง.
    setExportProgress(32, 'ประกอบเพลงเป็นช่วง ๆ...');
    await new Promise(r => setTimeout(r, 10));
    throwIfMp3ExportCancelled();

    const metronomeOn = document.getElementById('metronomeToggle')?.checked;
    const mp3encoder = new window.lamejs.Mp3Encoder(2, sampleRate, 128);
    const mp3Data = [];
    const sampleBlockSize = 1152;
    const stepsPerChunk = Math.max(1, Math.floor(20 / beatDur));

    for (let chunkStart = 0; chunkStart < seq.length; chunkStart += stepsPerChunk) {
      throwIfMp3ExportCancelled();
      const chunkEnd = Math.min(seq.length, chunkStart + stepsPerChunk);
      const chunkStartSec = chunkStart * beatDur;
      const isFinalChunk = chunkEnd === seq.length;
      const chunkDuration = (chunkEnd - chunkStart) * beatDur + (isFinalChunk ? tailSec : 0);
      const offlineCtx = new OfflineCtx(2, Math.ceil(sampleRate * chunkDuration), sampleRate);
      const exportBus = getMasterBus(offlineCtx);
      const firstAudibleStep = Math.max(0, Math.ceil((chunkStartSec - oneShotDur) / beatDur));
      let previousKhluyExportVoice = null;

      for (let step = firstAudibleStep; step < chunkEnd; step++) {
        const beat = seq[step];
        const relativeTime = step * beatDur - chunkStartSec;
        if (metronomeOn && relativeTime >= 0) playMetronomeClick(relativeTime, offlineCtx);
        if (chingOn) {
          const chingHit = getChingHitForBeat(beat);
          if (chingHit !== null) {
            const src = offlineCtx.createBufferSource();
            src.buffer = chingSampleBuffers[chingHit];
            const level = offlineCtx.createGain(); level.gain.value = 0;
            level.gain.setValueAtTime(0, Math.max(0, relativeTime));
            level.gain.linearRampToValueAtTime(CHING_PLAYBACK_GAIN, Math.max(0, relativeTime) + 0.003);
            src.connect(level); level.connect(exportBus);
            if (relativeTime < 0) src.start(0, -relativeTime);
            else src.start(relativeTime);
          }
        }

        for (const hand of (isKhluy ? ['right'] : ['right', 'left'])) {
          const baseGong = state.notes[hand][beat];
          if (baseGong == null) continue;
          const gongsToRender = [baseGong];
          if (state.recordMode === 'one' && currentInstrument === 'ranatek' && hand === 'right') {
            const lowerGong = baseGong - 7;
            if (lowerGong >= 0) gongsToRender.push(lowerGong);
          }
          for (const gong of gongsToRender) {
            const noteTime = relativeTime;
            const src = offlineCtx.createBufferSource();
            src.buffer = gongBuffers[gong];
            if (isKhluy) {
              const level = offlineCtx.createGain();
              const startAt = Math.max(0, noteTime);
              const offset = Math.max(0, -noteTime);
              const duration = Math.min(
                src.buffer.duration - offset,
                khluyNoteDuration() - offset
              );
              if (duration <= 0) continue;
              // ส่งออกแบบเสียงเดี่ยวเช่นเดียวกับการเล่นสด: โน้ตใหม่หยุดโน้ตก่อนหน้า
              if (previousKhluyExportVoice) stopKhluyVoice(previousKhluyExportVoice, startAt);
              const fadeStart = Math.max(startAt, startAt + duration - 0.05);
              level.gain.setValueAtTime(0, startAt);
              level.gain.linearRampToValueAtTime(KHLUY_PLAYBACK_GAIN, startAt + SAMPLE_ATTACK_SEC);
              level.gain.setValueAtTime(KHLUY_PLAYBACK_GAIN, fadeStart);
              level.gain.linearRampToValueAtTime(0, startAt + duration);
              src.connect(level); level.connect(exportBus);
              src.start(startAt, offset, duration);
              previousKhluyExportVoice = { source: src, level, ctx: offlineCtx };
            } else {
              src.connect(exportBus);
              if (noteTime < 0) src.start(0, -noteTime);
              else src.start(noteTime);
            }
          }
        }
      }

      const renderedBuffer = await offlineCtx.startRendering();
      throwIfMp3ExportCancelled();
      const left = renderedBuffer.getChannelData(0);
      const right = renderedBuffer.getChannelData(1);
      for (let i = 0; i < left.length; i += sampleBlockSize) {
        if (i % (sampleBlockSize * 64) === 0) {
          throwIfMp3ExportCancelled();
          await new Promise(r => setTimeout(r, 0));
        }
        const end = Math.min(i + sampleBlockSize, left.length);
        const leftInt16 = new Int16Array(end - i);
        const rightInt16 = new Int16Array(end - i);
        for (let j = 0; j < leftInt16.length; j++) {
          leftInt16[j] = left[i + j] < 0 ? left[i + j] * 32768 : left[i + j] * 32767;
          rightInt16[j] = right[i + j] < 0 ? right[i + j] * 32768 : right[i + j] * 32767;
        }
        const mp3buf = mp3encoder.encodeBuffer(leftInt16, rightInt16);
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
      }
      const completed = chunkEnd / seq.length;
      const progress = 32 + Math.round(completed * 63);
      setExportProgress(progress, `สร้าง MP3 เป็นช่วง ๆ... ${Math.round(completed * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
    }

    throwIfMp3ExportCancelled();
    const finalBuf = mp3encoder.flush();
    if (finalBuf.length > 0) mp3Data.push(finalBuf);
    if (mp3Data.length === 0) throw new Error('ไม่มีข้อมูลเสียงที่จะบันทึก');

    setExportProgress(97, 'กำลังดาวน์โหลด...');
    await new Promise(r => setTimeout(r, 50));
    throwIfMp3ExportCancelled();

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
    if (err?.name === 'ExportCancelledError') {
      showToast('ยกเลิกการสร้าง MP3 แล้ว', 'success');
    } else {
      reportSaveFailure('สร้างไฟล์ MP3', err);
    }
  } finally {
    stopExportTimer();
    isExporting = false;
    hideExportProgress();
  }
}
