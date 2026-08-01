// ===== io.js: text import/export, PDF export =====

function exportText() {
  if (chordTimer) { clearTimeout(chordTimer); commitChord(); }
  let output = "";
  if (state.songName.trim()) output += `ชื่อเพลง: ${state.songName}\n`;
  output += `เครื่องดนตรี: ${getActiveInst().name}\n\n`;
  
  const displayNotes = getActiveInst().display;

  let currentSectionStartLine = 1;
  const totalVaks = Math.ceil(state.numBars / BARS_PER_VAK);
  
  for (let v = 0; v < totalVaks; v++) {
    const lineNum = v + 1;
    if (state.sections && state.sections[lineNum] !== undefined) {
        currentSectionStartLine = lineNum;
        output += `\n--- ${state.sections[lineNum]} ---\n`;
    }
    const displayLineNum = lineNum - currentSectionStartLine + 1;
    const barsInThisLine = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : BARS_PER_VAK;
    const beatsPerLine = barsInThisLine * BEATS_PER_BAR;
    
    output += `[บรรทัดที่ ${displayLineNum}]\n`;
    let rightLine = "";
    let leftLine = "";
    for (let b = 0; b < beatsPerLine; b++) {
      const globalBeat = v * 32 + b; 
      const rn = state.notes.right[globalBeat];
      const ln = state.notes.left[globalBeat];
      
      rightLine += (rn !== null && rn !== undefined && displayNotes[rn]) ? displayNotes[rn] : "-";
      if (state.recordMode !== 'one') {
        leftLine += (ln !== null && ln !== undefined && displayNotes[ln]) ? displayNotes[ln] : "-";
      }
      
      if ((b + 1) % BEATS_PER_BAR === 0) { 
        rightLine += "  "; 
        if (state.recordMode !== 'one') leftLine += "  "; 
      }
    }
    output += rightLine.trimEnd() + "\n";
    if (state.recordMode !== 'one') output += leftLine.trimEnd() + "\n";
    output += "\n";
  }

  const blob = new Blob([output.trim()], { type: 'text/plain;charset=utf-8' });
  const safeName = getSafeFilename(state.songName); 
  const a = document.createElement('a'); 
  a.href = URL.createObjectURL(blob); 
  a.download = `${safeName}_${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.txt`;
  a.click();
}

const isIframe = window !== window.parent;
const hasFSAPI = !isIframe && ('showSaveFilePicker' in window) && ('showOpenFilePicker' in window);

async function executeImport(fileType) {
  if (hasFSAPI) {
    try {
      const opts = fileType === 'json' 
        ? [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
        : [{ description: 'Text Files', accept: { 'text/plain': ['.txt'] } }];
      const [handle] = await window.showOpenFilePicker({ types: opts, multiple: false });
      const file = await handle.getFile(); await processImportFile(file, handle);
    } catch(e) { if (e.name !== 'AbortError') showToast('เปิดไฟล์ไม่สำเร็จ: ' + e.message, 'error'); }
  } else {
    const picker = document.createElement('input'); picker.type = 'file'; 
    picker.accept = fileType === 'json' ? '.json,application/json' : '.txt,text/plain';
    picker.addEventListener('change', async () => {
      const file = picker.files[0]; if (!file) return; await processImportFile(file, null); picker.value = '';
    });
    picker.click();
  }
}

async function processImportFile(file, handle) {
  const btn = document.getElementById('importMainBtn'); const name = file.name.toLowerCase(); const mime = (file.type || '').toLowerCase();
  const isJson  = name.endsWith('.json') || mime === 'application/json';
  const isTxt   = name.endsWith('.txt')  || mime === 'text/plain';
  const originalBtnText = btn.textContent;

  try {
    btn.textContent = 'กำลังประมวลผล...'; btn.disabled = true;
    if (isJson) {
      const text = await file.text(); applyImport(JSON.parse(text));
      if (handle) { currentFileHandle = handle; updateSaveUI(); }
      showToast('เปิดไฟล์สำเร็จ', 'success'); return;
    }

    let text = '';
    if (isTxt) text = await file.text();
    else { showToast('ไม่รองรับไฟล์ประเภทนี้', 'error'); return; }

    applyTextImport(text); currentFileHandle = null; updateSaveUI();
  } catch (err) { showToast('นำเข้าไม่สำเร็จ: ' + err.message, 'error'); }
  finally { btn.textContent = originalBtnText; btn.disabled = false; }
}

function parseNotesFromText(text) {
  return text.match(/(ดํ|รํ|มํ|ฟํ|ซํ|ลํ|ทํ|ดฺ|รฺ|มฺ|ฟฺ|ซฺ|ลฺ|ทฺ|ด|ร|ม|ฟ|ซ|ล|ท|\-|—|–|_|~|x)/g) || [];
}

const REST_TOKENS = new Set(['-','—','–','x','_','~']);

function tokensToNoteArray(tokens) { 
    return tokens.map(t => {
        if(REST_TOKENS.has(t)) return null;
        const idx = getActiveInst().display.indexOf(t);
        return idx !== -1 ? idx : null; // Drop if note doesn't exist in current inst
    }); 
}

function applyTextImport(text) {
  const rawLines = text.split(/\r?\n/);
  const groups = []; 
  let currentGroup = [];

  for (const line of rawLines) {
    const tokens = parseNotesFromText(line);
    if (tokens.length > 0) {
      currentGroup.push(tokens);
    } else {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  if (groups.length === 0) {
    throw new Error("ไม่พบข้อมูลโน้ตเพลงไทยในไฟล์");
  }

  const allGroupsHaveTwoLines = groups.every(g => g.length === 2);
  const allGroupsHaveOneLine  = groups.every(g => g.length === 1);
  const isSingleGroup = groups.length === 1;
  const singleGroupEven = isSingleGroup && (groups[0].length % 2 === 0);

  let rightNotes = [];
  let leftNotes  = [];

  if (allGroupsHaveTwoLines || (isSingleGroup && singleGroupEven && !allGroupsHaveOneLine)) {
    const pairsToProcess = allGroupsHaveTwoLines
      ? groups.map(g => [g[0], g[1]])
      : (() => {
          const pairs = [];
          for (let i = 0; i < groups[0].length; i += 2) {
            pairs.push([groups[0][i], groups[0][i+1] || []]);
          }
          return pairs;
        })();

    for (const [topTokens, bottomTokens] of pairsToProcess) {
      const topArr    = tokensToNoteArray(topTokens);
      const bottomArr = tokensToNoteArray(bottomTokens);

      const pairMax = Math.max(topArr.length, bottomArr.length);
      const pairTarget = Math.max(32, Math.ceil(pairMax / 32) * 32);

      const paddedTop    = [...topArr];
      const paddedBottom = [...bottomArr];
      while (paddedTop.length    < pairTarget) paddedTop.push(null);
      while (paddedBottom.length < pairTarget) paddedBottom.push(null);

      rightNotes.push(...paddedTop);
      leftNotes.push(...paddedBottom);
    }

  } else {
    const allTokens = groups.flat(2);
    const allArr = tokensToNoteArray(allTokens.flat ? allTokens : allTokens.reduce((a,b) => a.concat(b), []));
    rightNotes = allArr;
    leftNotes  = new Array(allArr.length).fill(null);
  }

  const totalNotes = Math.max(rightNotes.length, leftNotes.length);
  const vaks = Math.max(1, Math.ceil(totalNotes / 32));
  state.numBars = vaks * BARS_PER_VAK;
  document.getElementById('numVak').value = vaks;
  ensureCapacity();
  pushUndo();

  state.notes.right.fill(null);
  state.notes.left.fill(null);
  for (let i = 0; i < rightNotes.length; i++) state.notes.right[i] = rightNotes[i];
  if (state.recordMode !== 'one') {
    for (let i = 0; i < leftNotes.length; i++) state.notes.left[i] = leftNotes[i];
  }
  state.lineLengths = {};

  state.cursorBeat = 0;
  if (chordTimer) { clearTimeout(chordTimer); chordTimer = null; }
  renderNotation();

  const modeLabel = (allGroupsHaveTwoLines || (isSingleGroup && singleGroupEven && !allGroupsHaveOneLine))
    ? `แบ่งมือ ${groups.length || Math.ceil(groups[0].length/2)} วรรค`
    : `ไม่แบ่งมือ ${vaks} วรรค`;
  showToast(`นำเข้าสำเร็จ · ${modeLabel}`, 'success');
}

function applyImport(data, silent = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid project data');

  const importedInstrument = data.instrument || currentInstrument;
  if (!Object.prototype.hasOwnProperty.call(INSTRUMENTS, importedInstrument)) {
    throw new Error('Unknown instrument in imported project');
  }

  if (importedInstrument !== currentInstrument) {
      currentInstrument = importedInstrument;
      
      const sel = document.getElementById('instSelect');
      if (sel && sel.value !== importedInstrument) sel.value = importedInstrument;

      document.getElementById('instPanelTitle').textContent = `${getActiveInst().name} · ${getActiveInst().numGongs} ลูก`;
      document.getElementById('notationSubtitle').textContent = `ทาง${getActiveInst().name}`;
      document.getElementById('kb-kwy').style.display = (importedInstrument === 'kwy') ? 'block' : 'none';
      document.getElementById('kb-kmwy').style.display = (importedInstrument === 'kmwy') ? 'block' : 'none';
      document.getElementById('kb-ranatek').style.display = (importedInstrument === 'ranatek') ? 'block' : 'none';
      renderImeInfographic();
      renderGongs();
  }
    
  if (!silent) pushUndo();
  if (typeof data.songName === 'string') { state.songName = data.songName.slice(0, 200); document.getElementById('songName').value = state.songName; } 
  else { state.songName = ''; document.getElementById('songName').value = ''; }
  updatePageTitle();

  if (Number.isFinite(data.tempo)) { state.bpm = Math.max(30, Math.min(300, data.tempo)); document.getElementById('bpm').value = state.bpm; }
  const noteLength = Array.isArray(data.notes?.right) ? data.notes.right.length : 0;
  const requestedVak = Number.isFinite(data.vak) ? data.vak : Math.ceil(noteLength / 32);
  const vak = Math.max(1, Math.min(MAX_VAKS, Math.round(requestedVak || 1)));
  state.numBars = vak * BARS_PER_VAK;
  document.getElementById('numVak').value = state.numBars / BARS_PER_VAK;
  
  const validLine = (key) => Number.isInteger(Number(key)) && Number(key) >= 1 && Number(key) <= vak;
  state.repeats = {};
  if (data.repeats && typeof data.repeats === 'object') {
    for (const [line, target] of Object.entries(data.repeats)) {
      if (validLine(line) && validLine(target)) state.repeats[line] = Number(target);
    }
  }
  state.sections = {};
  if (data.sections && typeof data.sections === 'object') {
    for (const [line, name] of Object.entries(data.sections)) {
      if (validLine(line) && typeof name === 'string') state.sections[line] = name.slice(0, 100);
    }
  }
  state.lineLengths = {};
  if (data.lineLengths && typeof data.lineLengths === 'object') {
    for (const [line, length] of Object.entries(data.lineLengths)) {
      if (validLine(line) && Number.isInteger(length) && length >= 1 && length <= BARS_PER_VAK) state.lineLengths[line] = length;
    }
  }
  state._editingSection = null;
  state.selectedLine = null;
  
  if (data.notes) {
    const maxIdx = getActiveInst().numGongs - 1;
    // clamp note indices ให้อยู่ใน range ของ instrument ปัจจุบัน
    // ป้องกัน inst.display[idx] / inst.freqs[idx] เป็น undefined เมื่อ import ข้าม instrument
    const maxBeats = vak * BARS_PER_VAK * BEATS_PER_BAR;
    const clampNotes = (arr) => Array.isArray(arr)
      ? arr.slice(0, maxBeats).map(v => (v == null ? null : (Number.isInteger(v) && v >= 0 && v <= maxIdx) ? v : null))
      : [];
    state.notes.right = clampNotes(data.notes.right);
    state.notes.left  = clampNotes(data.notes.left);
  }

  // โหมดบันทึกโน้ต: ใช้ค่าที่บันทึกไว้ในไฟล์ ถ้าไม่มี (ไฟล์เก่าก่อนมีฟีเจอร์นี้) ให้ถือเป็นสองมือ (ค่าเริ่มต้นเดิม)
  state.recordMode = (data.recordMode === 'one') ? 'one' : 'two';
  if (state.recordMode === 'one') { state.notes.left.fill(null); state.hand = 'right'; }
  applyRecordModeUI(state.recordMode);
  
  state.cursorBeat = 0; ensureCapacity(); renderNotation();
}


function exportPDF() {
  if (chordTimer) { clearTimeout(chordTimer); commitChord(); }

  const displayNotes = getActiveInst().display;
  
  function noteHTML(idx) {
    if (idx === null || idx === undefined || !displayNotes[idx]) return '<span class="rest">-</span>';
    return `<span class="note">${displayNotes[idx]}</span>`;
  }

  const totalLines = Math.ceil(state.numBars / BARS_PER_VAK);
  const songTitle = _escHTML((state.songName && state.songName.trim()) ? state.songName.trim() : 'ไม่มีชื่อเพลง');
  let contentHTML = '';
  let sectionLeadOpen = false;
  let sectionLeadLines = 0;

  for (let line = 0; line < totalLines; line++) {
    const lineNum = line + 1;

    const secName = (state.sections && state.sections[lineNum] !== undefined) ? state.sections[lineNum] : null;
    if (secName !== null) {
      if (sectionLeadOpen) contentHTML += '</div>';
      // Keep the title and the first three notation lines together on one page.
      contentHTML += `<div class="section-lead"><div class="section-label">${_escHTML(secName)}</div>`;
      sectionLeadOpen = true;
      sectionLeadLines = 0;
    }

    const barsInThisLine = state.lineLengths[lineNum] !== undefined ? state.lineLengths[lineNum] : 8;
    const beatsInThisLine = barsInThisLine * 4;
    const tableWidth = (barsInThisLine / 8) * 100; // คำนวณความกว้างตารางให้สมส่วน

    let topCells = '', botCells = '';
    for (let b = 0; b < beatsInThisLine; b++) {
      const isBarEnd = (b + 1) % 4 === 0;
      const barEndClass = isBarEnd ? ' bar-end' : '';
      
      const globalBeat = line * 32 + b;
      const rn = state.notes.right[globalBeat];
      const ln = state.notes.left[globalBeat];
      topCells += `<td class="nc${barEndClass}">${noteHTML(rn)}</td>`;
      if (state.recordMode !== 'one') botCells += `<td class="nc${barEndClass}">${noteHTML(ln)}</td>`;
    }

    const hasRepeat = state.repeats && state.repeats[lineNum] !== undefined;

    contentHTML += `
      <div class="line-block${hasRepeat ? ' has-repeat' : ''}">
        <table class="notation-table" style="width: ${tableWidth}%;">
          <tbody>
            <tr class="top-row">${topCells}</tr>
            ${state.recordMode !== 'one' ? `<tr class="bot-row">${botCells}</tr>` : ''}
          </tbody>
        </table>
        ${hasRepeat ? `<div class="repeat-label" style="width: ${tableWidth}%;">กลับต้น</div>` : ''}
      </div>
    `;

    if (sectionLeadOpen && ++sectionLeadLines >= 3) {
      contentHTML += '</div>';
      sectionLeadOpen = false;
    }
  }
  if (sectionLeadOpen) contentHTML += '</div>';

  const printHTML = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1024">
<title>${songTitle}</title> 
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page {
    size: A4 portrait;
    margin-top: 0; margin-bottom: 0.5in; margin-left: 0.5in; margin-right: 0.5in;
    @bottom-right {
      content: "หน้า " counter(page) " / " counter(pages);
      font-family: 'Sarabun', sans-serif; font-size: 12px;
    }
  }
  body {
    font-family: 'Sarabun', 'TH Sarabun New', 'Noto Sans Thai', serif;
    background: #ffffff !important; color: #000000; font-size: 14px; line-height: 1.4;
  }
  @media screen {
    body { padding: 0.5in; max-width: 210mm; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
  }
  .doc-title { text-align: center; font-size: 18px; font-weight: 700; margin-bottom: 22px; letter-spacing: 0.01em; }
  .section-lead { break-inside: avoid; page-break-inside: avoid; }
  .section-label { font-size: 14px; font-weight: 700; margin-top: 18px; margin-bottom: 4px; text-align: left; }
  .line-block { margin-bottom: 14px; page-break-inside: avoid; }
  table.notation-table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 13px; }
  td.nc { border: none; text-align: center; padding: 0; height: 28px; vertical-align: middle; }
  .top-row td:first-child, .bot-row td:first-child { border-left: 1px solid #000; }
  .top-row td:last-child,  .bot-row td:last-child  { border-right: 1px solid #000; }
  .top-row td { border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .bot-row td { border-bottom: 1px solid #000; }
  td.nc.bar-end { border-right: 1px solid #000; }
  td.nc.empty-cell { background-color: #fafafa; border-top-color: #eee; border-bottom-color: #eee; }
  td.nc.empty-cell.bar-end { border-right-color: #eee; }
  .note, .rest { display: inline-block; height: 14px; line-height: 14px; font-size: 13px; text-align: center; vertical-align: middle; }
  .rest { color: #000; }
  .repeat-label { text-align: right; font-size: 12px; font-weight: 600; margin-top: 2px; padding-right: 2px; }
  .print-actions { position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; z-index: 1000; width: 90%; max-width: 500px; }
  .print-btn { flex: 1; background: #000; color: #fff; border: none; padding: 16px 20px; font-size: 20px; font-family: 'Sarabun', sans-serif; font-weight: 700; cursor: pointer; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center; transition: transform 0.1s; }
  .print-btn.close { background: #ff5e7a; }
  .print-btn:active { transform: scale(0.96); }
  .print-btn:hover { filter: brightness(1.2); }
  @media print { .print-actions { display: none !important; } body { padding: 0; background: #ffffff !important; } }
</style>
</head>
<body>

<table style="width: 100%; border: none; border-collapse: collapse;">
  <thead>
    <tr><th style="height: 0.6in; padding: 0; border: none;"></th></tr>
  </thead>
  <tbody>
    <tr><td style="padding: 0; border: none;">
      
      <div class="doc-title">เพลง${songTitle}</div>
      ${contentHTML}

    </td></tr>
  </tbody>
</table>

<div class="print-actions">
   <button class="print-btn close" onclick="history.back()">← กลับ</button>
   <button class="print-btn" onclick="window.print()">🖨️ พิมพ์/Save</button>
</div>

</body>
</html>`;

  try {
      // iOS Safari บล็อก window.open('','_blank') + document.write() — ใช้ Blob URL แทน
      // Blob URL เป็น URL จริง (ไม่ใช่ about:blank) จึงผ่าน popup blocker ได้
      const blob = new Blob([printHTML], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // คืน memory หลังเปิด tab — หน้าใหม่โหลดเสร็จแล้วค่อย revoke
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      showToast('เปิดหน้าตารางโน้ต PDF แล้ว', 'success');
  } catch(e) {
      showToast('ไม่สามารถสร้างหน้า PDF ได้ในหน้าจอนี้', 'error');
  }
}

const PDF_IMPORT = (() => {
  'use strict';
  
  const FALLBACK_NOTES = {
    'ดฺ': 'ด', 'รฺ': 'ร', 'มฺ': 'ม'
  };
  
  const TOKEN_RE = /(ดํ|รํ|มํ|ฟํ|ซํ|ลํ|ทํ|มฺ|ฟฺ|ซฺ|ลฺ|ทฺ|ด|ร|ม|ฟ|ซ|ล|ท|[-–—−_~xX○o])/g;

  function tokenizeLine(text) {
    return [...text.matchAll(TOKEN_RE)].map(m => m[1]);
  }

  function tokenToIndex(tok) {
    if (REST_TOKENS.has(tok)) return null;
    let lookUpTok = FALLBACK_NOTES[tok] || tok;
    const idx = getActiveInst().display.indexOf(lookUpTok);
    if (idx !== -1) return idx;
    
    // Fallback: strip dots and try again
    const baseNote = lookUpTok.replace(/[ฺํ]/g, '');
    const baseIdx = getActiveInst().display.indexOf(baseNote);
    return baseIdx !== -1 ? baseIdx : null;
  }

  let pdfLibReady = false;
  let pdfLibLoading = false;
  let pdfLibCallbacks = [];

  // mirror หลายแหล่ง กันกรณี CDN เจ้าใดเจ้าหนึ่งล่ม/ถูกบล็อกในบางเครือข่าย/องค์กร
  const PDFJS_MIRRORS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js'
  ];
  const PDFJS_LOAD_TIMEOUT_MS = 10000; // กันกรณี CDN โหลดค้าง (ไม่ error ไม่ load) ไม่ให้รอไปตลอดกาล

  // โหลด <script> เดี่ยวๆ พร้อม timeout ของตัวเอง (s.onerror อย่างเดียวไม่ครอบคลุมกรณีเน็ตช้า/ค้าง)
  function loadScriptWithTimeout(src, timeoutMs) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        s.remove();
        reject(new Error(`หมดเวลาโหลด (เกิน ${Math.round(timeoutMs / 1000)} วิ)`));
      }, timeoutMs);
      s.onload = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      s.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); s.remove(); reject(new Error('โหลดสคริปต์ไม่สำเร็จ')); };
      s.src = src;
      document.head.appendChild(s);
    });
  }

  function loadPdfJs() {
    return new Promise((resolve, reject) => {
      if (pdfLibReady) { resolve(); return; }
      pdfLibCallbacks.push({ resolve, reject });
      if (pdfLibLoading) return;
      pdfLibLoading = true;

      // เช็คก่อนเลยว่ามีเน็ตไหม — ไม่งั้นจะปล่อยให้รอจน timeout เฉยๆโดยเปล่าประโยชน์ (แอปนี้ใช้ offline ได้เกือบทั้งหมด ยกเว้นฟีเจอร์นี้ที่ต้องโหลด pdf.js ครั้งแรก)
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const err = new Error('ไม่มีการเชื่อมต่ออินเทอร์เน็ต — ฟีเจอร์ "นำเข้า PDF" ต้องใช้เน็ตเพื่อโหลดตัวอ่านไฟล์ (pdf.js) ในการใช้งานครั้งแรกเท่านั้น');
        pdfLibCallbacks.forEach(cb => cb.reject(err));
        pdfLibCallbacks = []; pdfLibLoading = false;
        return;
      }

      (async () => {
        let lastErr = null;
        for (const src of PDFJS_MIRRORS) {
          try {
            await loadScriptWithTimeout(src, PDFJS_LOAD_TIMEOUT_MS);

            // ปิด Worker ตั้งแต่ต้น — รัน PDF parsing บน main thread โดยไม่มี warning
            // workerSrc = '' บังคับให้ pdf.js ใช้ FakeWorker แบบ silent
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';

            // ปิด console.warn ชั่วคราว เฉพาะตอน setup เพื่อซ่อน "Setting up fake worker"
            const _warn = console.warn;
            console.warn = (...args) => {
              if (typeof args[0] === 'string' && args[0].includes('fake worker')) return;
              _warn.apply(console, args);
            };
            setTimeout(() => { console.warn = _warn; }, 3000);

            pdfLibReady = true;
            pdfLibCallbacks.forEach(cb => cb.resolve());
            pdfLibCallbacks = [];
            return; // สำเร็จ — ไม่ต้องลอง mirror ถัดไป
          } catch (e) {
            lastErr = e; // ลอง mirror ถัดไป
          }
        }
        // ทุก mirror ล้มเหลว (หรือ setup พัง) — ยอมแพ้ พร้อม reset ให้กดลองใหม่ได้
        const err = new Error('โหลด pdf.js ไม่สำเร็จ (ลองแล้วทุกแหล่ง) — ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่' + (lastErr ? `: ${lastErr.message}` : ''));
        pdfLibCallbacks.forEach(cb => cb.reject(err));
        pdfLibCallbacks = [];
        pdfLibLoading = false;
      })();
    });
  }

  async function extractPdfPages(arrayBuffer, onProgress) {
    const pdf = await window.pdfjsLib.getDocument({
      data: arrayBuffer,
      disableWorker: true,
      isEvalSupported: false,
    }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent({ normalizeWhitespace: false });

      const items = tc.items.filter(it => it.str && it.str.trim() !== '');
      const groups = [];
      for (const it of items) {
        const y = Math.round(it.transform[5]);
        const x = it.transform[4];
        let placed = false;
        for (const g of groups) {
          if (Math.abs(g.y - y) <= 3) {
            g.items.push({ x, str: it.str });
            placed = true; break;
          }
        }
        if (!placed) groups.push({ y, items: [{ x, str: it.str }] });
      }

      groups.sort((a, b) => b.y - a.y);
      const lines = groups.map(g => {
        g.items.sort((a, b) => a.x - b.x);
        return g.items; 
      });

      pages.push(lines);
    }
    return pages;
  }

  function parseAllLines(allLines) {
    const result = { songName: '', vaks: [] };

    const annotated = allLines.map(lineItems => {
      const t = lineItems.map(it => it.str).join(' ').trim();
      const tokens = tokenizeLine(t);
      const noteCount = tokens.length;
      const isRepeat = /กลับต้น/.test(t);
      const isPageNum = /^หน้า\s*\d/.test(t) || /^©/.test(t) || /^\d+\s*\/\s*\d+$/.test(t);
      
      const textNoSpace = t.replace(/\s+/g, '');
      const validTokensLen = tokens.join('').length;
      const noteRatio = textNoSpace.length > 0 ? validTokensLen / textNoSpace.length : 0;
      const isNoteRow = noteCount >= 4 && noteRatio > 0.4;

      const isSectionCandidate = !isNoteRow && !isPageNum && !isRepeat
        && t.length >= 1 && t.length <= 60 && !t.startsWith('เพลง');
        
      return { text: t, items: lineItems, tokens, noteCount, isNoteRow, isRepeat, isPageNum, isSectionCandidate };
    });

    for(let i=0; i < Math.min(10, annotated.length); i++) {
        const a = annotated[i];
        if (a.text.startsWith('เพลง') && a.text.length > 4) { result.songName = a.text.replace(/^เพลง/, '').trim(); break; }
        if (a.text.length >= 2 && a.text.length <= 80 && a.noteCount === 0 && !a.isPageNum) { result.songName = a.text; break; }
    }
    
    if (result.songName) {
        annotated.forEach(a => { if (a.text === result.songName) a.isSectionCandidate = false; });
    }

    let globalMinX = Infinity;
    let globalMaxX = -Infinity;
    annotated.filter(a => a.isNoteRow).forEach(a => {
        a.items.forEach(it => {
            if (tokenizeLine(it.str).length > 0) {
                if (it.x < globalMinX) globalMinX = it.x;
                if (it.x > globalMaxX) globalMaxX = it.x;
            }
        });
    });

    if (globalMaxX <= globalMinX) { globalMinX = 50; globalMaxX = 500; }
    const colSpacing = (globalMaxX - globalMinX) / 7;

    let pendingSection = null;
    let i = 0;

    while (i < annotated.length) {
      const a = annotated[i];

      if (a.isPageNum || a.text === '' || a.text.startsWith('เพลง')) { i++; continue; }
      if (a.isSectionCandidate) { pendingSection = a.text; i++; continue; }

      if (a.isNoteRow) {
        let botIdx = -1;
        for (let j = i + 1; j < Math.min(i + 4, annotated.length); j++) {
          if (annotated[j].isNoteRow) { botIdx = j; break; }
          if (annotated[j].isSectionCandidate || annotated[j].isRepeat) break;
        }

        const BEATS = 32;
        const topArr = new Array(BEATS).fill(null);
        const botArr = new Array(BEATS).fill(null);

        const fillSpatial = (items, targetArr) => {
            const measures = Array.from({length: 8}, () => []);
            items.forEach(it => {
                let colIdx = Math.round((it.x - globalMinX) / colSpacing);
                if (colIdx < 0) colIdx = 0;
                if (colIdx > 7) colIdx = 7;
                measures[colIdx].push(...tokenizeLine(it.str));
            });

            for (let m = 0; m < 8; m++) {
                const notes = measures[m].map(tokenToIndex); 
                const startBeat = m * 4;
                const putCount = Math.min(4, notes.length);
                for (let k = 0; k < putCount; k++) {
                    targetArr[startBeat + (4 - putCount) + k] = notes[notes.length - putCount + k];
                }
            }
        };

        fillSpatial(a.items, topArr);

        let nextI = i + 1;
        if (botIdx !== -1) {
          fillSpatial(annotated[botIdx].items, botArr);
          nextI = botIdx + 1;
        }

        let hasRepeat = false;
        for (let k = i; k < Math.min(nextI + 1, annotated.length); k++) {
          if (annotated[k].isRepeat || /กลับต้น/.test(annotated[k].text)) { hasRepeat = true; break; }
        }

        result.vaks.push({
          section: pendingSection,
          right: topArr,
          left: botArr,
          repeat: false 
        });
        
        pendingSection = null;
        i = nextI;
        continue;
      }
      i++;
    }
    return result;
  }

  function applyParsed(parsed) {
    if (parsed.vaks.length === 0) throw new Error('ไม่พบโน้ตในไฟล์ PDF นี้ หรืออาจจะอ่านไม่ออกเนื่องจากเป็นภาพสแกน');

    pushUndo();

    state.songName = parsed.songName || '';
    document.getElementById('songName').value = state.songName;
    updatePageTitle();

    const numVaks = parsed.vaks.length;
    state.numBars = numVaks * BARS_PER_VAK;
    document.getElementById('numVak').value = numVaks;

    state.sections = {};
    state.repeats  = {};
    state.lineLengths = {};
    state._editingSection = null;

    ensureCapacity();
    state.notes.right.fill(null);
    state.notes.left.fill(null);

    const BEATS = BARS_PER_VAK * BEATS_PER_BAR; 
    parsed.vaks.forEach((vak, vi) => {
      const lineNum = vi + 1;
      const offset  = vi * BEATS;

      if (vak.section) state.sections[lineNum] = vak.section;

      vak.right.forEach((n, bi) => { state.notes.right[offset + bi] = n; });
      vak.left .forEach((n, bi) => { state.notes.left [offset + bi] = n; });
    });

    state.cursorBeat = 0;
    if (typeof chordTimer !== 'undefined' && chordTimer) { clearTimeout(chordTimer); chordTimer = null; }
    renderNotation();

    const secCount = Object.keys(state.sections).length;
    const repCount = Object.keys(state.repeats).length;
    const noteR = state.notes.right.filter(n => n !== null).length;
    const noteL = state.notes.left .filter(n => n !== null).length;

    return { numVaks, secCount, repCount, noteR, noteL };
  }

  function buildPreview(parsed) {
    if (parsed.vaks.length === 0) return '<span style="color:var(--red)">ไม่พบโน้ต</span>';

    const displayNotes = getActiveInst().display;
    const MAX_PREVIEW = 4;
    let html = '';

    if (parsed.songName) {
      html += `<div style="color:var(--gold);font-weight:700;margin-bottom:6px;">เพลง ${_escHTML(parsed.songName)}</div>`;
    }

    parsed.vaks.slice(0, MAX_PREVIEW).forEach((vak, vi) => {
      if (vak.section) {
        html += `<div style="color:var(--accent);font-size:11px;margin-top:4px;">[${_escHTML(vak.section)}]</div>`;
      }
      const toStr = arr => arr.map(n => n === null || !displayNotes[n] ? '-' : displayNotes[n]).join(' ');
      html += `<div style="color:var(--muted);font-size:11px;">วรรค ${vi+1}</div>`;
      html += `<div style="color:var(--gold)">R: ${toStr(vak.right)}</div>`;
      html += `<div style="color:var(--accent)">L: ${toStr(vak.left)}</div>`;
    });

    if (parsed.vaks.length > MAX_PREVIEW) {
      html += `<div style="color:var(--dim);margin-top:4px;">... และอีก ${parsed.vaks.length - MAX_PREVIEW} วรรค</div>`;
    }
    return html;
  }

  let _parsedData = null;

  function openModal() {
    _parsedData = null;
    const overlay  = document.getElementById('importPdfOverlay');
    const progress = document.getElementById('pdfImportProgress');
    const preview  = document.getElementById('pdfImportPreview');
    const errDiv   = document.getElementById('pdfImportError');
    const confirmBtn = document.getElementById('confirmPdfImportBtn');
    const input    = document.getElementById('pdfFileInput');

    progress.style.display = 'none';
    preview.style.display  = 'none';
    errDiv.style.display   = 'none';
    confirmBtn.disabled    = true;
    input.value            = '';
    overlay.classList.add('show');
  }

  function closeModal() {
    document.getElementById('importPdfOverlay').classList.remove('show');
    _parsedData = null;
  }

  async function processFile(file) {
    const progress   = document.getElementById('pdfImportProgress');
    const progressBar = document.getElementById('pdfProgressBar');
    const label      = document.getElementById('pdfProgressLabel');
    const preview    = document.getElementById('pdfImportPreview');
    const previewContent = document.getElementById('pdfPreviewContent');
    const errDiv     = document.getElementById('pdfImportError');
    const confirmBtn = document.getElementById('confirmPdfImportBtn');

    _parsedData = null;
    confirmBtn.disabled = true;
    preview.style.display = 'none';
    errDiv.style.display  = 'none';
    progress.style.display = 'block';
    progressBar.style.width = '5%';
    label.textContent = 'โหลด pdf.js...';

    try {
      await loadPdfJs();
      progressBar.style.width = '15%';
      label.textContent = 'อ่าน PDF...';

      const buf = await file.arrayBuffer();
      progressBar.style.width = '25%';

      const pages = await extractPdfPages(buf, (cur, total) => {
        const pct = 25 + Math.round((cur / total) * 55);
        progressBar.style.width = pct + '%';
        label.textContent = `อ่านหน้า ${cur}/${total}...`;
      });

      progressBar.style.width = '85%';
      label.textContent = 'วิเคราะห์โน้ต...';

      const allLines = pages.flat();
      const parsed = parseAllLines(allLines);
      
      progressBar.style.width = '100%';
      label.textContent = `พบ ${parsed.vaks.length} วรรค`;

      if (parsed.vaks.length === 0) throw new Error('ไม่พบโน้ตไทยในไฟล์ — PDF อาจเป็นภาพสแกน หรือฟอนต์อาจจะอ่านไม่ได้');

      _parsedData = parsed;
      previewContent.innerHTML = buildPreview(parsed);
      preview.style.display = 'block';
      confirmBtn.disabled = false;

    } catch(err) {
      progress.style.display = 'none';
      errDiv.style.display = 'block';
      errDiv.textContent = '✕ ' + err.message;
    }
  }

  function confirmImport() {
    if (!_parsedData) return;
    try {
      const stats = applyParsed(_parsedData);
      closeModal();
      showToast(
        `นำเข้า PDF สำเร็จ · ${stats.numVaks} วรรค` +
        (stats.secCount ? ` · ${stats.secCount} ท่อน` : ''),
        'success'
      );
    } catch(err) {
      showToast('นำเข้าไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  function init() {
    document.getElementById('importPdfBtn').addEventListener('click', () => {
        const importMenu = document.getElementById('importMenu');
        if(importMenu) importMenu.classList.remove('show');
        openModal();
    });
    document.getElementById('cancelPdfImportBtn').addEventListener('click', closeModal);
    document.getElementById('importPdfOverlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('importPdfOverlay')) closeModal();
    });
    document.getElementById('confirmPdfImportBtn').addEventListener('click', confirmImport);

    const dropZone = document.getElementById('pdfDropZone');
    const fileInput = document.getElementById('pdfFileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--purple)';
      dropZone.style.background  = 'rgba(191,140,255,0.08)';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = '';
      dropZone.style.background  = '';
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '';
      dropZone.style.background  = '';
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') processFile(f);
      else showToast('กรุณาเลือกไฟล์ .PDF', 'error');
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (f) processFile(f);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  init();
  PDF_IMPORT.init();
  initQuickNav();
});
