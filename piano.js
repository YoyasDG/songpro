/*
 * SongPro · Acordes de piano
 * Para pianistas que leen partitura pero aún no el cifrado: cada acorde se
 * dibuja en un teclado (mano derecha) y en un pentagrama en clave de sol,
 * con sus notas en Do-Re-Mi y el bajo para la mano izquierda.
 * Cada acorde se coloca en la posición (inversión) más cercana al anterior,
 * para que el cambio de un acorde a otro mueva la mano lo menos posible.
 */
(function (global) {
  'use strict';

  const LETTERS = 'CDEFGAB';
  const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SOLFEGE = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

  // Intervalo → [semitonos, pasos de letra]
  const IV = {
    1: [0, 0], b2: [1, 1], 2: [2, 1], b3: [3, 2], 3: [4, 2], 4: [5, 3], b5: [6, 4], 5: [7, 4], '#5': [8, 4],
    6: [9, 5], bb7: [9, 6], b7: [10, 6], 7: [11, 6], b9: [1, 1], 9: [2, 1], '#9': [3, 1], 11: [5, 3],
    '#11': [6, 3], b13: [8, 5], 13: [9, 5],
  };

  // Lee un acorde y devuelve sus intervalos (máximo 4 notas en la mano derecha)
  function parse(chord) {
    const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(String(chord).trim());
    if (!m) return null;
    const [, letter, acc, rawSuffix, bassLetter, bassAcc] = m;
    let s = rawSuffix.replace(/[()]/g, '').replace(/\s+/g, '');

    let third = '3';
    let fifth = '5';
    let seventh = null;
    let sixth = false;
    const adds = [];
    let noThird = false;

    const take = (re) => { const r = re.exec(s); if (r) s = s.slice(0, r.index) + s.slice(r.index + r[0].length); return r; };

    if (take(/^(maj|Maj|M)(?=7|9|11|13|$)/) || take(/^Δ/)) seventh = '7';
    if (take(/^(m(?!aj)|min|mi|-)/)) third = 'b3';
    if (take(/^(dim|°|º|o)/)) { third = 'b3'; fifth = 'b5'; if (take(/^7/)) seventh = 'bb7'; }
    if (take(/^ø/)) { third = 'b3'; fifth = 'b5'; seventh = 'b7'; take(/^7/); }
    if (take(/^(aug|\+)/)) fifth = '#5';
    if (/^m7b5/.test(rawSuffix)) { third = 'b3'; fifth = 'b5'; seventh = 'b7'; s = s.replace(/7b5/, ''); }
    if (take(/^5(?![0-9])/) && !s) { noThird = true; }

    // séptimas y extensiones: 7, 7M, M7, maj7, 9, 11, 13, add9, 6, sus…
    if (take(/7M|M7|maj7|Maj7/)) seventh = '7';
    else if (take(/^7/)) { if (seventh === null) seventh = 'b7'; }
    const ext = take(/^(9|11|13)(M)?/);
    if (ext) {
      if (ext[2] || seventh === '7') seventh = '7'; else if (seventh === null) seventh = 'b7';
      adds.push(ext[1] === '9' ? '9' : ext[1] === '11' ? '11' : '13');
    }
    if (take(/^6/)) sixth = true;
    let r;
    while ((r = take(/(add|\+)?(b9|#9|9|#11|11|b13|13|2|4)/))) {
      if (r[2] === '2') adds.push('9'); else if (r[2] === '4') { third = null; adds.push('4'); } else adds.push(r[2]);
    }
    if (take(/sus2/) ) { third = null; adds.push('2'); }
    if (take(/sus4|sus/)) { third = null; adds.push('4'); }
    if (take(/b5/)) fifth = 'b5';
    if (take(/#5/)) fifth = '#5';
    if (take(/^4$/)) { third = null; adds.push('4'); }

    let ivs = ['1'];
    if (third && !noThird) ivs.push(third);
    if (adds.includes('2')) ivs.push('2');
    if (adds.includes('4')) ivs.push('4');
    ivs.push(fifth);
    if (sixth) ivs.push('6');
    if (seventh) ivs.push(seventh);
    for (const a of adds) if (!['2', '4'].includes(a)) ivs.push(a);
    ivs = [...new Set(ivs)];
    // cuatro notas como máximo: se quita la quinta justa (la que menos se extraña)
    if (ivs.length > 4 && fifth === '5') ivs = ivs.filter((x) => x !== '5');
    if (ivs.length > 4) ivs = ivs.slice(0, 4);

    const notes = ivs.map((iv) => spell(letter, acc, iv));
    const bass = bassLetter ? { letter: bassLetter, acc: bassAcc } : { letter, acc };
    return { root: { letter, acc }, notes, bass, slash: !!bassLetter };
  }

  // Nota del acorde con su nombre correcto (en B♭: Si♭ · Re · Fa)
  function spell(letter, acc, iv) {
    const [semi, steps] = IV[iv];
    const rootPc = (NATURAL_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
    const L = LETTERS[(LETTERS.indexOf(letter) + steps) % 7];
    const pc = (rootPc + semi) % 12;
    let diff = (pc - NATURAL_PC[L] + 12) % 12;
    if (diff > 6) diff -= 12;
    const accName = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' }[diff] ?? '';
    return { letter: L, acc: accName, pc };
  }

  const pcOf = (n) => (NATURAL_PC[n.letter] + ({ bb: -2, b: -1, '': 0, '#': 1, '##': 2 }[n.acc] || 0) + 12) % 12;
  const solfa = (n, sharpsName) => SOLFEGE[n.letter] + (n.acc || '').replace(/##/g, '𝄪').replace(/bb/g, '𝄫').replace(/#/g, '♯').replace(/b/g, '♭');

  // ── Posiciones: inversión más cercana a la anterior ──
  const LOW = 60;  // Do central
  const HIGH = 84; // Do dos octavas arriba (el teclado muestra Do4…Si5)

  function voicings(notes) {
    const pcs = notes.map(pcOf);
    const out = [];
    for (let inv = 0; inv < pcs.length; inv += 1) {
      const order = pcs.slice(inv).concat(pcs.slice(0, inv));
      const idx = notes.slice(inv).concat(notes.slice(0, inv));
      for (let base = 48; base < 84; base += 12) {
        const midi = [];
        let prev = -1;
        for (const pc of order) {
          let m = base + pc;
          while (m <= prev) m += 12;
          midi.push(m);
          prev = m;
        }
        if (midi[0] >= LOW && midi[midi.length - 1] < HIGH) out.push({ midi, notes: idx });
      }
    }
    return out;
  }

  function choose(notes, previous) {
    const all = voicings(notes);
    if (!all.length) return null;
    if (!previous) {
      // primera vez: lo más cerca de Do central, en posición fundamental si se puede
      const center = 67;
      return all.reduce((best, v) => {
        const score = Math.abs(v.midi.reduce((a, b) => a + b, 0) / v.midi.length - center) + (v.notes[0] === notes[0] ? 0 : 3);
        return !best || score < best.score ? { ...v, score } : best;
      }, null);
    }
    const prevAvg = previous.midi.reduce((a, b) => a + b, 0) / previous.midi.length;
    return all.reduce((best, v) => {
      // movimiento total de los dedos (nota con nota más cercana) + no alejarse
      let move = 0;
      for (const m of v.midi) move += Math.min(...previous.midi.map((p) => Math.abs(p - m)));
      const avg = v.midi.reduce((a, b) => a + b, 0) / v.midi.length;
      const score = move + Math.abs(avg - prevAvg) * 0.5 + Math.abs(avg - 67) * 0.15;
      return !best || score < best.score ? { ...v, score } : best;
    }, null);
  }

  // ── Dibujos ──
  const C = {
    white: '#ffffff', black: '#2a211c', line: '#8f8476', on: '#8fa9d6', onBlack: '#3d5f9e',
    ink: '#2a211c', staff: '#5f554c',
  };

  function keyboardSvg(midiOn) {
    const W = 14;
    const H = 52;
    const BW = 9;
    const BH = 32;
    const whites = [];
    const blacks = [];
    let x = 0;
    for (let m = 60; m < 84; m += 1) {
      const pc = m % 12;
      const isBlack = [1, 3, 6, 8, 10].includes(pc);
      if (!isBlack) {
        whites.push(`<rect x="${x}" y="0" width="${W}" height="${H}" rx="1.5" fill="${midiOn.includes(m) ? C.on : C.white}" stroke="${C.line}" stroke-width="0.8"/>`);
        x += W;
      } else {
        blacks.push(`<rect x="${x - BW / 2}" y="0" width="${BW}" height="${BH}" rx="1.2" fill="${midiOn.includes(m) ? C.onBlack : C.black}"/>`);
      }
    }
    // marca del Do central
    const mark = `<circle cx="${W / 2}" cy="${H - 6}" r="1.6" fill="${C.line}"/>`;
    return `<svg class="pk" viewBox="-1 -1 ${x + 2} ${H + 2}" width="${x + 2}" height="${H + 2}" xmlns="http://www.w3.org/2000/svg">${whites.join('')}${blacks.join('')}${mark}</svg>`;
  }

  // Clave de sol simplificada (trazo propio)
  const CLEF = 'M13.2 4.5c3.2 0 4.6 3.4 3.4 7.6-1.1 3.6-4.6 6.6-7.3 9.6-2.6 2.9-4.1 5.3-4.1 8.6 0 4.4 3.5 7.4 8 7.4 4.1 0 6.9-2.5 6.9-5.9 0-3-2.3-5.1-5.2-5.1-2.8 0-4.7 1.9-4.7 4.2 0 1.6.8 2.8 2 3.4-2.9-.4-4.6-2.5-4.6-5.3 0-3.7 3.2-6.4 7.1-6.4 4.5 0 7.6 3.2 7.6 7.4 0 4.6-3.8 8.2-9.4 8.2-.4 0-.8 0-1.2-.1l1.6 8.1c.4 2.1-.4 4.2-2.6 4.7-1.7.4-3.6-.4-4-2-.3-1.2.4-2.4 1.6-2.6 1.1-.2 2.1.5 2.2 1.5.1.5-.1 1-.4 1.3 1-.1 1.6-1.2 1.4-2.3l-1.6-8c-5.6-1.4-8.9-5.8-8.9-10.7 0-4.5 2.4-7.6 5.7-11.2 2.6-2.9 5.2-5.2 5.9-8.4.5-2.4-.2-4.1-1.5-4.1-1.9 0-3.4 3.3-3.2 7.4l.9 13.9-1.6.3-.9-14.1C6.5 9.6 9 4.5 13.2 4.5z';

  function staffSvg(voiced) {
    const SP = 6;            // separación entre líneas
    const TOP = 18;          // y de la quinta línea (Fa5)
    const W = 92;
    const lines = [0, 1, 2, 3, 4].map((i) => `<line x1="0" y1="${TOP + i * SP}" x2="${W}" y2="${TOP + i * SP}" stroke="${C.staff}" stroke-width="0.7"/>`).join('');
    // paso diatónico respecto a Mi4 (primera línea)
    const stepOf = (n, midi) => {
      let oct = Math.floor(midi / 12) - 1;
      if (n.letter === 'B' && (n.acc === '#' || n.acc === '##') && midi % 12 <= 1) oct -= 1;
      if (n.letter === 'C' && (n.acc === 'b' || n.acc === 'bb') && midi % 12 >= 10) oct += 1;
      return oct * 7 + LETTERS.indexOf(n.letter) - (4 * 7 + 2);
    };
    const yOf = (step) => TOP + 4 * SP - step * (SP / 2);
    const items = voiced.midi.map((m, i) => ({ step: stepOf(voiced.notes[i], m), note: voiced.notes[i] }))
      .sort((a, b) => a.step - b.step);
    const X = 50;
    let svg = '';
    // líneas adicionales
    const minStep = items[0].step;
    const maxStep = items[items.length - 1].step;
    for (let s = -2; s >= minStep; s -= 2) svg += `<line x1="${X - 7}" y1="${yOf(s)}" x2="${X + 13}" y2="${yOf(s)}" stroke="${C.staff}" stroke-width="0.7"/>`;
    for (let s = 10; s <= maxStep; s += 2) svg += `<line x1="${X - 7}" y1="${yOf(s)}" x2="${X + 13}" y2="${yOf(s)}" stroke="${C.staff}" stroke-width="0.7"/>`;
    // cabezas de nota (las segundas se corren a la derecha) y alteraciones
    let prevStep = null;
    let shifted = false;
    let accCol = 0;
    items.forEach((it) => {
      shifted = prevStep !== null && it.step - prevStep === 1 && !shifted;
      const cx = X + (shifted ? 6.6 : 0);
      const cy = yOf(it.step);
      svg += `<ellipse cx="${cx}" cy="${cy}" rx="3.6" ry="2.6" transform="rotate(-20 ${cx} ${cy})" fill="none" stroke="${C.ink}" stroke-width="1.5"/>`;
      if (it.note.acc) {
        const ax = X - 9 - (accCol % 2) * 6;
        accCol += 1;
        svg += accidentalSvg(it.note.acc, ax, cy);
      }
      prevStep = it.step;
    });
    const minY = Math.min(TOP - 8, yOf(maxStep) - 6);
    const maxY = Math.max(TOP + 4 * SP + 8, yOf(minStep) + 6);
    const clef = `<path d="${CLEF}" transform="translate(2 ${TOP - 9}) scale(0.55)" fill="${C.ink}"/>`;
    return `<svg class="ps" viewBox="0 ${minY} ${W} ${maxY - minY}" width="${W}" height="${maxY - minY}" xmlns="http://www.w3.org/2000/svg">${lines}${clef}${svg}</svg>`;
  }

  function accidentalSvg(acc, x, y) {
    const s = `stroke="${C.ink}" stroke-width="0.9" fill="none"`;
    if (acc === '#' || acc === '##') {
      return `<g ${s}><line x1="${x - 1.4}" y1="${y - 5}" x2="${x - 1.4}" y2="${y + 5}"/><line x1="${x + 1.4}" y1="${y - 5.6}" x2="${x + 1.4}" y2="${y + 4.4}"/>` +
        `<line x1="${x - 3}" y1="${y - 1.2}" x2="${x + 3}" y2="${y - 2.4}" stroke-width="1.6"/><line x1="${x - 3}" y1="${y + 2.4}" x2="${x + 3}" y2="${y + 1.2}" stroke-width="1.6"/></g>`;
    }
    return `<g ${s}><line x1="${x - 1.8}" y1="${y - 7}" x2="${x - 1.8}" y2="${y + 2.6}"/>` +
      `<path d="M${x - 1.8} ${y + 2.6} C ${x + 3.2} ${y} ${x + 2.4} ${y - 3} ${x - 1.8} ${y - 0.6}" stroke-width="1.2"/></g>`;
  }

  // ── Bloque completo ──
  // chords: [{ chord: 'G', label: 'G' o '1 (G)' }]
  function block(chords, esc) {
    const seen = new Set();
    const unique = chords.filter((c) => {
      const p = parse(c.chord);
      if (!p || seen.has(c.chord)) return false;
      seen.add(c.chord);
      return true;
    });
    if (!unique.length) return '';
    let prev = null;
    const cards = unique.map((c) => {
      const p = parse(c.chord);
      const v = choose(p.notes, prev) || { midi: [], notes: [] };
      if (v.midi.length) prev = v;
      const names = v.notes.map((n) => solfa(n)).join(' · ');
      const lh = solfa(p.bass);
      return `<div class="pc">
        <div class="pc-name">${c.labelHtml ?? esc(c.label)}</div>
        ${keyboardSvg(v.midi)}
        ${v.midi.length ? staffSvg(v) : ''}
        <div class="pc-notes">M.D.: ${esc(names)}</div>
        <div class="pc-lh">M.I.: ${esc(lh)}</div>
      </div>`;
    });
    return `<div class="blk piano-blk"><div class="comment">Acordes de piano</div><div class="pc-break"></div>${cards.join('')}</div>`;
  }

  const api = { parse, block, choose, solfa };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Piano = api;
})(typeof window !== 'undefined' ? window : globalThis);
