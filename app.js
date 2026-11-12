(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const input = $('input');
  const output = $('output');
  const preview = $('preview');
  const status = $('status');
  const fields = ['title', 'author', 'key', 'tempo'].map($);
  const modeSel = $('mode');

  let fileBaseName = '';
  let outputEditedByHand = false;
  let statusTimer;

  function flash(msg) {
    status.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ''), 2500);
  }

  function metadata() {
    return { title: $('title').value, author: $('author').value, key: $('key').value, tempo: $('tempo').value };
  }

  // ── diccionario personal (se guarda en este navegador) ──
  const dictBox = $('dictionary');
  const DICT_KEY = 'songpro.dictionary';
  try { dictBox.value = localStorage.getItem(DICT_KEY) || ''; } catch { /* sin almacenamiento */ }

  function updateDictCount() {
    const n = ChordConverter.parseDictionary(dictBox.value).size;
    $('dictCount').textContent = n ? `(${n} regla${n === 1 ? '' : 's'})` : '';
  }
  updateDictCount();
  if (dictBox.value.trim()) $('dictPanel').open = false;

  dictBox.addEventListener('input', () => {
    try { localStorage.setItem(DICT_KEY, dictBox.value); } catch { /* ignorar */ }
    updateDictCount();
    clearTimeout(debounce);
    debounce = setTimeout(convertSafely, 250);
  });

  function convert() {
    const text = input.value;
    output.value = text.trim()
      ? ChordConverter.convertTxt(text, metadata(), modeSel.value, dictBox.value)
      : '';
    outputEditedByHand = false;
    updateChordButtons();
    if (!preview.hidden) renderPreview();
  }

  // ── escritura rápida de acordes ──
  const chordButtons = $('chordButtons');
  const customChord = $('customChord');
  let lastChordKey = '';

  // Acordes usados en el .cho, del más usado al menos usado
  function songChords() {
    const counts = new Map();
    for (const line of output.value.split('\n')) {
      if (/^\s*\{.*\}\s*$/.test(line)) continue; // directivas
      for (const m of line.matchAll(/\[([^\]\s]+)\]/g)) {
        counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([chord]) => chord);
  }

  function updateChordButtons() {
    const chords = songChords();
    const key = chords.join('|');
    if (key === lastChordKey) return; // evitar redibujar en cada tecla
    lastChordKey = key;
    chordButtons.innerHTML = '';
    if (!chords.length) {
      chordButtons.innerHTML = '<span class="hint">Los acordes de la canción aparecerán aquí</span>';
      return;
    }
    for (const chord of chords) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chord-btn';
      b.textContent = chord;
      b.title = `Insertar [${chord}] en el cursor`;
      // mousedown + preventDefault: el editor no pierde el cursor
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => insertAtCursor(`[${chord}]`));
      chordButtons.appendChild(b);
    }
  }

  // Inserta texto en el cursor del editor .cho; Ctrl+Z lo deshace
  function insertAtCursor(text, at) {
    output.focus();
    if (at !== undefined) output.setSelectionRange(at, at);
    else output.setSelectionRange(output.selectionStart, output.selectionStart);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      output.setRangeText(text, output.selectionStart, output.selectionEnd, 'end');
      output.dispatchEvent(new Event('input'));
    }
  }

  customChord.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const chord = customChord.value.trim().replace(/^\[|\]$/g, '');
    if (!chord) return;
    insertAtCursor(`[${chord}]`);
    customChord.value = '';
  });

  // Etiqueta: se pone al inicio de la línea donde está el cursor
  $('labelInsert').addEventListener('change', (e) => {
    const label = e.target.value;
    e.target.value = '';
    if (!label) return;
    const pos = output.selectionStart;
    const lineStart = output.value.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = output.value.indexOf('\n', pos);
    const currentLine = output.value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const directive = `{comment: ${label}}`;
    insertAtCursor(currentLine.trim() ? `${directive}\n` : directive, lineStart);
  });

  // Si el usuario editó el .cho a mano, confirmar antes de sobrescribirlo
  function convertSafely() {
    if (outputEditedByHand && !confirm('Editaste el .cho a mano. ¿Volver a convertir y perder esos cambios?')) return;
    convert();
  }

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(convertSafely, 150);
  });
  fields.forEach((f) => f.addEventListener('input', convertSafely));
  modeSel.addEventListener('change', convertSafely);
  output.addEventListener('input', () => {
    outputEditedByHand = true;
    updateChordButtons();
    if (!preview.hidden) renderPreview();
  });

  // ── archivos ──
  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      input.value = ChordConverter.normalizeText(String(reader.result));
      fileBaseName = file.name;
      if (!$('title').value.trim()) $('title').value = file.name.replace(/\.[^.]+$/, '');
      outputEditedByHand = false;
      convert();
      flash(`Cargado: ${file.name}`);
    };
    reader.readAsText(file, 'utf-8');
  }

  $('file').addEventListener('change', (e) => {
    loadFile(e.target.files[0]);
    e.target.value = '';
  });

  const drop = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  $('clear').addEventListener('click', () => {
    input.value = '';
    fileBaseName = '';
    fields.forEach((f) => (f.value = ''));
    convert();
    input.focus();
  });

  // ── salida ──
  $('copy').addEventListener('click', async () => {
    if (!output.value) return flash('No hay nada que copiar');
    try {
      await navigator.clipboard.writeText(output.value);
    } catch {
      output.select();
      document.execCommand('copy');
    }
    flash('Copiado al portapapeles');
  });

  $('download').addEventListener('click', () => {
    if (!output.value) return flash('Primero pega o abre una canción');
    const name = ChordConverter.sanitizeBaseName($('title').value || fileBaseName || 'cancion') + '.cho';
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(`Descargado: ${name}`);
  });

  // ── pestañas ──
  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      const showPreview = tab.dataset.tab === 'preview';
      preview.hidden = !showPreview;
      output.hidden = showPreview;
      $('quickbar').hidden = showPreview;
      if (showPreview) renderPreview();
    }));

  // ── vista previa ChordPro ──
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SECTION_NAMES = { verse: 'Verso', chorus: 'Coro', bridge: 'Puente' };

  function renderLine(line) {
    const parts = line.split(/\[([^\]]*)\]/);
    // parts: [texto, acorde, texto, acorde, texto...]
    const lyricOnly = parts.filter((_, i) => i % 2 === 0).join('');
    const chordsOnly = lyricOnly.trim() === '';
    let html = '';
    if (parts[0]) html += `<span class="seg"><span class="c"></span><span class="l">${esc(parts[0])}</span></span>`;
    for (let i = 1; i < parts.length; i += 2) {
      const lyric = chordsOnly ? '' : parts[i + 1] || '';
      html += `<span class="seg"><span class="c">${esc(parts[i])}</span><span class="l">${esc(lyric) || (chordsOnly ? '' : '&nbsp;')}</span></span>`;
    }
    return `<div class="line${chordsOnly ? ' chords-only' : ''}">${html}</div>`;
  }

  // Convierte el .cho en HTML de hoja de canción. Cada sección (etiqueta +
  // sus líneas) va en un bloque .blk para que al imprimir no se parta.
  function buildSheet(text) {
    const meta = {};
    const blocks = [];
    let current = null;

    const close = () => {
      if (current && current.body) blocks.push(current);
      current = null;
    };
    const ensure = () => { if (!current) current = { cls: 'blk', body: '' }; };

    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      const dir = /^\s*\{\s*([\w_]+)\s*(?::\s*(.*?))?\s*\}\s*$/.exec(line);
      if (dir) {
        const name = dir[1].toLowerCase();
        const val = dir[2] || '';
        if (['title', 't', 'author', 'artist', 'key', 'tempo'].includes(name)) { meta[name] = val; continue; }
        const start = /^(?:start_of_|so)(verse|chorus|bridge|v|c|b)$/.exec(name);
        if (start) {
          close();
          const k = { v: 'verse', c: 'chorus', b: 'bridge' }[start[1]] || start[1];
          current = { cls: 'blk section', body: `<div class="section-label">${esc(val || SECTION_NAMES[k])}</div>` };
          continue;
        }
        if (/^(?:end_of_|eo)(verse|chorus|bridge|v|c|b)$/.test(name)) { close(); continue; }
        if (['comment', 'c', 'comment_italic', 'ci'].includes(name)) {
          close();
          current = { cls: 'blk', body: `<div class="comment">${esc(val)}</div>` };
          continue;
        }
        continue;
      }
      if (line.trim() === '') {
        // una línea vacía cierra el bloque, salvo justo después de una etiqueta
        if (current && !current.hasLines) continue;
        close();
        continue;
      }
      ensure();
      current.body += renderLine(line);
      current.hasLines = true;
    }
    close();

    const title = meta.title || meta.t || '';
    const sub = [meta.author || meta.artist, meta.key && `Tono: ${meta.key}`, meta.tempo && `Tempo: ${meta.tempo}`]
      .filter(Boolean).join(' · ');
    const html =
      (title ? `<div class="title">${esc(title)}</div>` : '') +
      (sub ? `<div class="sub">${esc(sub)}</div>` : '') +
      `<div class="song">${blocks.map((b) => `<div class="${b.cls}">${b.body}</div>`).join('')}</div>`;
    return { title, html, empty: blocks.length === 0 };
  }

  function renderPreview() {
    const sheet = buildSheet(output.value);
    preview.innerHTML = sheet.empty && !sheet.title
      ? '<div class="sub">Nada que mostrar todavía.</div>'
      : sheet.html;
  }

  // ── PDF: hoja de impresión + "Guardar como PDF" del navegador ──
  const printSheet = $('printSheet');
  $('pdf').addEventListener('click', () => {
    if (!output.value.trim()) return flash('Primero pega o abre una canción');
    const sheet = buildSheet(output.value);
    printSheet.innerHTML = sheet.html;
    printSheet.classList.toggle('two-cols', $('pdfCols').value === '2');
    const previousTitle = document.title;
    // El navegador usa el título de la página como nombre del PDF
    document.title = ChordConverter.sanitizeBaseName($('title').value || sheet.title || fileBaseName || 'cancion');
    const restore = () => { document.title = previousTitle; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1000);
  });

  updateChordButtons();
})();
