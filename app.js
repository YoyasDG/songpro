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
  let choTargetKey = ''; // tono elegido para el .cho ('' = el original)
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
    let cho = text.trim()
      ? ChordConverter.convertTxt(text, metadata(), modeSel.value, dictBox.value)
      : '';
    // Si elegiste otro tono para el .cho, se vuelve a aplicar al reconvertir
    if (cho && choTargetKey) {
      try { cho = transposeTo(cho, choTargetKey); } catch { choTargetKey = ''; }
    }
    output.value = cho;
    outputEditedByHand = false;
    updateChordButtons();
    updateKeyControls();
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
    updateKeyControls();
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
      choTargetKey = '';
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
    choTargetKey = '';
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
        if (['title', 't', 'author', 'artist', 'key', 'tempo', 'capo'].includes(name)) { meta[name] = val; continue; }
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
      // .cho viejos: una línea que es solo "[Primera Parte]" es etiqueta, no acorde
      const bracketOnly = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (bracketOnly && /\p{L}{2,}/u.test(bracketOnly[1]) &&
          !ChordConverter.extractChords(bracketOnly[1]).isChordLine) {
        close();
        current = { cls: 'blk', body: `<div class="comment">${esc(bracketOnly[1].trim())}</div>` };
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
    const capo = parseInt(meta.capo, 10) || 0;
    let keyText = meta.key ? `Tono: ${meta.key}` : '';
    if (meta.key && capo > 0) {
      const sounding = Transposer.soundingKey(meta.key, capo) || meta.key;
      keyText = `Tono: ${sounding} · Capo ${capo} (acordes de ${meta.key})`;
    } else if (capo > 0) {
      keyText = `Capo ${capo}`;
    }
    const sub = [meta.author || meta.artist, keyText, meta.tempo && `Tempo: ${meta.tempo}`]
      .filter(Boolean).join(' · ');
    const html =
      (title ? `<div class="title">${esc(title)}</div>` : '') +
      (sub ? `<div class="sub">${esc(sub)}</div>` : '') +
      `<div class="song">${blocks.map((b) => `<div class="${b.cls}">${b.body}</div>`).join('')}</div>`;
    return { title, html, empty: blocks.length === 0 };
  }

  function renderPreview() {
    const sheet = buildSheet(pdfText());
    preview.innerHTML = sheet.empty && !sheet.title
      ? '<div class="sub">Nada que mostrar todavía.</div>'
      : sheet.html;
  }

  // ── Transpositor ──
  const choKey = $('choKey');
  const pdfKey = $('pdfKey');
  const pdfCapo = $('pdfCapo');

  // Tono de un .cho: el de {key:}; si no hay, el primer acorde (casi siempre
  // es el tono); si tampoco, el que deduzca el transpositor por los acordes.
  function keyInfo(text) {
    const d = Transposer.describeSong(text);
    if (d.key) return { key: d.key, capo: d.capo || 0, guessed: false };
    const first = /\[([A-G][#b]?)([^\]\/\s]*)/.exec(text.replace(/^\s*\{.*\}\s*$/gm, ''));
    if (first) {
      const minor = /^(m|min|mi|-)(?!aj)/.test(first[2]);
      return { key: first[1] + (minor ? 'm' : ''), capo: d.capo || 0, guessed: true };
    }
    if (d.inferred) return { key: d.inferred.key, capo: d.capo || 0, guessed: true };
    return null;
  }

  // Inserta {key:} cuando el .cho no lo trae, para que el transpositor parta
  // del tono correcto (y no de uno que adivine distinto).
  function withKey(text, info) {
    if (!info || !info.guessed) return text;
    const lines = text.split('\n');
    let at = 0;
    while (at < lines.length && /^\s*\{\s*(title|t|subtitle|st|author|artist)\s*:/i.test(lines[at])) at += 1;
    lines.splice(at, 0, `{key: ${info.key}}`);
    return lines.join('\n');
  }

  function transposeTo(text, targetKey) {
    const info = keyInfo(text);
    if (!info) throw new Error('sin tono');
    if (Transposer.parseKey(info.key)?.minor !== Transposer.parseKey(targetKey)?.minor) {
      // mayor ↔ menor no se puede: se usa el relativo con el mismo número de semitonos
      targetKey = targetKey.endsWith('m') ? targetKey.slice(0, -1) : `${targetKey}m`;
    }
    return Transposer.transposeSong(withKey(text, info), { mode: 'key', targetKey }).content;
  }

  // Texto que se imprime: el .cho con el tono final y el capo del PDF.
  // El .cho del editor no cambia.
  function pdfText() {
    return renderFor(output.value, pdfKey.value, +pdfCapo.value);
  }

  // Aplica "suena en" + capo a cualquier .cho (canción suelta o del cancionero)
  function renderFor(text, key, capo) {
    if (!text.trim() || (!key && !capo)) return text;
    const info = keyInfo(text);
    if (!info) return text;
    try {
      return Transposer.applyRenderTarget(withKey(text, info), {
        soundingKey: key || null,
        capo,
      });
    } catch {
      return text;
    }
  }

  function keyLabel(k) { return k.replace('b', '♭').replace('#', '♯'); }

  function fillKeys(select, info, firstOption) {
    const minor = !!Transposer.parseKey(info.key)?.minor;
    const keys = Transposer.keyOptions(minor);
    const prev = select.value;
    select.innerHTML = (firstOption ? `<option value="">${firstOption}</option>` : '') +
      keys.map((k) => `<option value="${k}">${keyLabel(k)}</option>`).join('');
    return { keys, prev };
  }

  let lastKeySig = '';
  function updateKeyControls() {
    const info = output.value.trim() ? keyInfo(output.value) : null;
    const sig = info ? `${info.key}|${info.capo}|${info.guessed}` : '';
    if (sig === lastKeySig) { updatePdfHint(); return; }
    lastKeySig = sig;

    if (!info) {
      choKey.innerHTML = '<option>—</option>';
      choKey.disabled = true;
      pdfKey.innerHTML = '<option value="">Igual al .cho</option>';
      updatePdfHint();
      return;
    }

    // Selector del .cho: el tono actual seleccionado
    const { keys } = fillKeys(choKey, info);
    const current = keys.find((k) => Transposer.pitchClass(Transposer.parseKey(k).tonic) ===
      Transposer.pitchClass(Transposer.parseKey(info.key).tonic)) || info.key;
    if (!keys.includes(current)) choKey.insertAdjacentHTML('afterbegin', `<option value="${current}">${keyLabel(current)}</option>`);
    choKey.value = current;
    choKey.disabled = false;
    choKey.title = info.guessed
      ? `Tono deducido del primer acorde (${info.key}). Si no es correcto, escríbelo en el campo Tono.`
      : 'Transporta el .cho: lo que descargas queda en este tono';
    choKey.classList.toggle('guessed', info.guessed);

    // Selector del PDF: "Igual al .cho (G)" + tonos
    const sounding = info.capo ? (Transposer.soundingKey(info.key, info.capo) || info.key) : info.key;
    const { prev } = fillKeys(pdfKey, info, `Igual al .cho (${keyLabel(sounding)})`);
    pdfKey.value = [...pdfKey.options].some((o) => o.value === prev) ? prev : '';
    updatePdfHint();
  }

  function updatePdfHint() {
    const hint = $('pdfHint');
    const info = output.value.trim() ? keyInfo(output.value) : null;
    const capo = +pdfCapo.value;
    if (!info || (!pdfKey.value && !capo)) { hint.textContent = ''; return; }
    const sounding = pdfKey.value || (info.capo ? Transposer.soundingKey(info.key, info.capo) : info.key);
    if (capo) {
      const shapes = Transposer.describeSong(pdfText()).key || '';
      hint.textContent = `Suena en ${keyLabel(sounding)} · tocas acordes de ${keyLabel(shapes)} con capo en el traste ${capo}`;
    } else {
      hint.textContent = `El PDF sale en ${keyLabel(sounding)} · el .cho se queda en ${keyLabel(info.key)}`;
    }
  }

  // 1) Transportar el .cho (cambia el archivo que descargas)
  choKey.addEventListener('change', () => {
    const target = choKey.value;
    try {
      const next = transposeTo(output.value, target);
      output.value = next;
      choTargetKey = target;
      lastChordKey = '';
      updateChordButtons();
      updateKeyControls();
      if (!preview.hidden) renderPreview();
      flash(`.cho transportado a ${keyLabel(target)}`);
    } catch {
      flash('No pude detectar el tono: escríbelo en el campo Tono');
      updateKeyControls();
    }
  });

  // 2 y 3) Tono final y capo solo para el PDF
  [pdfKey, pdfCapo].forEach((el) => el.addEventListener('change', () => {
    updatePdfHint();
    if (!preview.hidden) renderPreview();
  }));

  // ── PDF: hoja de impresión + "Guardar como PDF" del navegador ──
  const printSheet = $('printSheet');

  function printHtml(html, fileName, twoCols) {
    printSheet.innerHTML = html;
    printSheet.classList.toggle('two-cols', twoCols);
    const previousTitle = document.title;
    // El navegador usa el título de la página como nombre del PDF
    document.title = fileName;
    const restore = () => { document.title = previousTitle; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1000);
  }

  $('pdf').addEventListener('click', () => {
    if (!output.value.trim()) return flash('Primero pega o abre una canción');
    const sheet = buildSheet(pdfText());
    const capo = +pdfCapo.value;
    const extra = [pdfKey.value, capo ? `capo ${capo}` : ''].filter(Boolean).join(' ');
    printHtml(
      `<section class="song-page">${sheet.html}</section>`,
      ChordConverter.sanitizeBaseName(`${$('title').value || sheet.title || fileBaseName || 'cancion'} ${extra}`),
      $('pdfCols').value === '2',
    );
  });

  // ── Cancionero: varios .cho / .txt → un solo PDF ──
  const batchList = $('batchList');
  const batchFiles = $('batchFiles');
  let songs = []; // { name, cho, title, key }

  const readAsText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file, 'utf-8');
  });

  function metaOf(cho) {
    const get = (names) => {
      for (const n of names) {
        const m = new RegExp(`^\\s*\\{\\s*${n}\\s*:\\s*(.*?)\\s*\\}\\s*$`, 'im').exec(cho);
        if (m) return m[1];
      }
      return '';
    };
    return { title: get(['title', 't']), key: get(['key']), author: get(['author', 'artist']) };
  }

  async function addBatchFiles(fileList) {
    const files = [...fileList].filter((f) => /\.(cho|chordpro|chopro|crd|txt)$/i.test(f.name));
    if (!files.length) return flash('Solo se aceptan archivos .cho o .txt');
    files.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    for (const file of files) {
      const raw = ChordConverter.normalizeText(await readAsText(file));
      const baseTitle = file.name.replace(/\.[^.]+$/, '');
      let cho = /\.txt$/i.test(file.name)
        ? ChordConverter.convertTxt(raw, {}, modeSel.value, dictBox.value)
        : raw;
      let meta = metaOf(cho);
      if (!meta.title) {
        cho = `{title: ${baseTitle}}\n${cho}`;
        meta = metaOf(cho);
      }
      const info = keyInfo(cho);
      songs.push({ name: file.name, cho, ...meta, baseKey: info ? info.key : '', sounding: '', capo: 0 });
    }
    renderBatch();
    flash(`${files.length} canción${files.length === 1 ? '' : 'es'} agregada${files.length === 1 ? '' : 's'}`);
  }

  function renderBatch() {
    $('batchCount').textContent = songs.length ? `(${songs.length})` : '';
    $('batchPdf').disabled = !songs.length;
    batchList.innerHTML = '';
    if (!songs.length) {
      batchList.innerHTML = '<li class="batch-empty">Todavía no hay canciones. Elige o arrastra tus archivos .cho aquí.</li>';
      return;
    }
    songs.forEach((song, i) => {
      const li = document.createElement('li');
      li.className = 'batch-item';
      li.innerHTML = `
        <span class="batch-num">${i + 1}</span>
        <span class="batch-title"></span>
        <span class="batch-tp">
          <label class="key-pick" title="Tono en el que va a sonar (no cambia el archivo)"><span>Suena en</span><select data-tp="key"></select></label>
          <label class="key-pick" title="Capo: el PDF muestra las figuras que se tocan"><span>Capo</span><select data-tp="capo"></select></label>
        </span>
        <span class="batch-file"></span>
        <span class="batch-actions">
          <button type="button" data-act="up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-act="down" title="Bajar" ${i === songs.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-act="remove" title="Quitar">✕</button>
        </span>`;
      li.querySelector('.batch-title').textContent = song.title;
      const keySel = li.querySelector('[data-tp="key"]');
      const capoSel = li.querySelector('[data-tp="capo"]');
      if (song.baseKey) {
        const minor = !!Transposer.parseKey(song.baseKey)?.minor;
        keySel.innerHTML = `<option value="">${keyLabel(song.baseKey)} (original)</option>` +
          Transposer.keyOptions(minor).map((k) => `<option value="${k}">${keyLabel(k)}</option>`).join('');
        keySel.value = song.sounding;
      } else {
        keySel.innerHTML = '<option value="">—</option>';
        keySel.disabled = true;
        capoSel.disabled = true;
        keySel.title = 'No encontré el tono de esta canción';
      }
      capoSel.innerHTML = '<option value="0">No</option>' +
        Array.from({ length: 9 }, (_, n) => `<option value="${n + 1}">${n + 1}</option>`).join('');
      capoSel.value = String(song.capo);
      keySel.addEventListener('change', () => { song.sounding = keySel.value; });
      capoSel.addEventListener('change', () => { song.capo = +capoSel.value; });
      li.querySelector('.batch-file').textContent = song.name;
      li.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'remove') songs.splice(i, 1);
        if (act === 'up' && i > 0) [songs[i - 1], songs[i]] = [songs[i], songs[i - 1]];
        if (act === 'down' && i < songs.length - 1) [songs[i + 1], songs[i]] = [songs[i], songs[i + 1]];
        renderBatch();
      }));
      batchList.appendChild(li);
    });
  }

  batchFiles.addEventListener('change', async (e) => {
    await addBatchFiles(e.target.files);
    e.target.value = '';
  });

  const batchDrop = $('batchDrop');
  ['dragenter', 'dragover'].forEach((ev) =>
    batchDrop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); batchDrop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    batchDrop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); batchDrop.classList.remove('dragging'); }));
  batchDrop.addEventListener('drop', (e) => addBatchFiles(e.dataTransfer.files));

  $('batchClear').addEventListener('click', () => { songs = []; renderBatch(); });

  $('batchPdf').addEventListener('click', () => {
    if (!songs.length) return;
    const bookName = $('batchName').value.trim() || 'Cancionero';
    let html = '';
    if ($('batchIndex').checked) {
      html += `<section class="song-page index-page">
        <div class="title">${esc(bookName)}</div>
        <div class="sub">${songs.length} canciones</div>
        <ol class="index-list">${songs.map((s) => {
          const key = s.sounding || s.baseKey;
          const tag = key ? `${keyLabel(key)}${s.capo ? ` · capo ${s.capo}` : ''}` : '';
          return `<li><span>${esc(s.title)}</span>${tag ? `<em>${esc(tag)}</em>` : ''}</li>`;
        }).join('')}</ol>
      </section>`;
    }
    html += songs.map((s) =>
      `<section class="song-page">${buildSheet(renderFor(s.cho, s.sounding, s.capo)).html}</section>`).join('');
    printHtml(html, ChordConverter.sanitizeBaseName(bookName), $('batchCols').value === '2');
  });

  renderBatch();
  updateKeyControls();

  updateChordButtons();
})();

// App instalable: guarda los archivos para poder abrir SongPro sin internet.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline, la app funciona igual */ });
  });
}

// Botón "Instalar app"
// - Android / computadora (Chrome, Edge): abre el aviso de instalación del navegador.
// - iPhone / iPad: Safari no lo permite desde un botón, así que mostramos los pasos.
// - Si ya está instalada (abierta como app), el botón no aparece.
(function () {
  const btn = document.getElementById('installBtn');
  const guide = document.getElementById('installGuide');
  if (!btn) return;

  const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (installed) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad con iPadOS
  let deferredPrompt = null;

  if (isIOS) btn.hidden = false;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // guardamos el aviso para mostrarlo con nuestro botón
    deferredPrompt = e;
    btn.hidden = false;
  });

  btn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') btn.hidden = true;
      return;
    }
    if (guide && typeof guide.showModal === 'function') guide.showModal();
  });

  window.addEventListener('appinstalled', () => { btn.hidden = true; deferredPrompt = null; });
})();
