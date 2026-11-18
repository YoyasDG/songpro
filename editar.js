/*
 * SongPro · Editar un PDF
 * Lee los adjuntos que SongPro guarda dentro de sus PDF (songpro.json y los
 * .cho) y los manda a la página principal para seguir editando.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const status = $('status');
  let statusTimer;
  let current = null; // datos leídos del PDF

  function flash(msg) {
    status.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ''), 3000);
  }

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
  const loadPdfLib = () => (window.PDFLib ? Promise.resolve(window.PDFLib)
    : loadScript('vendor/pdf-lib.min.js').then(() => window.PDFLib));

  // Recorre el árbol de nombres /EmbeddedFiles del PDF y devuelve
  // [{ name, bytes }] de cada archivo adjunto.
  async function readAttachments(buffer) {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream } =
      await loadPdfLib();
    const doc = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true });
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    const tree = names && names.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
    if (!tree) return [];

    const out = [];
    const text = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');
    const walk = (node) => {
      const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
      if (kids) for (let i = 0; i < kids.size(); i += 1) walk(kids.lookup(i, PDFDict));
      const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
      if (!arr) return;
      for (let i = 0; i + 1 < arr.size(); i += 2) {
        const spec = arr.lookup(i + 1, PDFDict);
        const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
        const stream = ef && ef.lookup(PDFName.of('F'));
        if (!(stream instanceof PDFRawStream)) continue;
        const name = text(spec.lookup(PDFName.of('UF'))) || text(spec.lookup(PDFName.of('F'))) || text(arr.lookup(i));
        out.push({ name, bytes: decodePDFRawStream(stream).decode() });
      }
    };
    walk(tree);
    return out;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keyLabel = (k) => (k || '').replace('b', '♭').replace('#', '♯');
  const keyOf = (cho) => (/^\s*\{\s*key\s*:\s*([^}]+?)\s*\}/im.exec(cho) || [])[1] || '';

  function show(data) {
    current = data;
    $('editError').hidden = true;
    const book = data.kind === 'book';
    $('editKind').textContent = book ? 'Cancionero' : 'Canción';
    $('editTitle').textContent = book ? data.name || 'Cancionero' : data.songs[0].title || 'Canción';
    const bits = [];
    if (book) {
      bits.push(`${data.songs.length} canciones`, `${data.cols || 2} columna${data.cols === 1 ? '' : 's'}`);
      if (data.numbers) bits.push('en números');
    } else {
      const s = data.songs[0];
      if (s.meta?.author) bits.push(s.meta.author);
      if (s.notation === 'numeros') bits.push('en números');
      bits.push(`${data.cols || 1} columna${(data.cols || 1) === 1 ? '' : 's'}`);
    }
    if (data.created) {
      bits.push(`hecho el ${new Date(data.created).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    }
    $('editSub').textContent = bits.join(' · ');
    $('editSongs').innerHTML = data.songs.map((s) => {
      const base = keyOf(s.cho);
      const sounding = s.sounding || base;
      const tags = [sounding && `Tono ${keyLabel(sounding)}`, s.capo ? `Capo ${s.capo}` : ''].filter(Boolean);
      return `<li><span class="edit-song-title">${esc(s.title || s.file || 'Sin título')}</span>${
        tags.map((t) => `<em>${esc(t)}</em>`).join('')}</li>`;
    }).join('');
    $('editResult').hidden = false;
    $('editOpen').textContent = book ? 'Abrir el cancionero en SongPro' : 'Abrir en SongPro';
  }

  function fail(msg) {
    current = null;
    $('editResult').hidden = true;
    $('editError').hidden = false;
    if (msg) $('editErrorText').textContent = msg;
  }

  async function handle(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      fail('Ese archivo no es un PDF.');
      return;
    }
    flash(`Leyendo ${file.name}…`);
    try {
      const files = await readAttachments(await file.arrayBuffer());
      const json = files.find((f) => f.name === 'songpro.json');
      if (json) {
        const data = JSON.parse(new TextDecoder().decode(json.bytes));
        if (data.app === 'SongPro' && Array.isArray(data.songs) && data.songs.length) { show(data); flash(''); return; }
      }
      // PDF con solo .cho adjuntos (sin ajustes): se abre como cancionero
      const chos = files.filter((f) => /\.cho$/i.test(f.name));
      if (chos.length) {
        show({
          app: 'SongPro', version: 1, kind: chos.length > 1 ? 'book' : 'song', name: file.name.replace(/\.pdf$/i, ''),
          songs: chos.map((f) => {
            const cho = new TextDecoder().decode(f.bytes);
            const title = (/^\s*\{\s*(?:title|t)\s*:\s*(.*?)\s*\}/im.exec(cho) || [])[1] || f.name.replace(/\.cho$/i, '');
            return { file: f.name, title, cho, txt: '', meta: { title }, sounding: '', capo: 0 };
          }),
        });
        return;
      }
      fail();
    } catch {
      fail('No pude leer ese PDF. Puede estar dañado o protegido con contraseña.');
    }
  }

  $('pdfFile').addEventListener('change', (e) => { handle(e.target.files[0]); e.target.value = ''; });
  const drop = $('editDrop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));

  $('editOpen').addEventListener('click', () => {
    if (!current) return;
    try {
      sessionStorage.setItem('songpro.import', JSON.stringify(current));
    } catch {
      flash('Tu navegador no dejó pasar los datos; descarga los .cho y ábrelos en SongPro.');
      return;
    }
    location.href = './';
  });

  $('editDownload').addEventListener('click', () => {
    if (!current) return;
    current.songs.forEach((s, i) => {
      const name = `${(s.title || s.file || `cancion-${i + 1}`).replace(/\.cho$/i, '').replace(/[\\/:*?"<>|]/g, '')}.cho`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([s.cho], { type: 'text/plain;charset=utf-8' }));
      a.download = name;
      setTimeout(() => { a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, i * 250);
    });
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
