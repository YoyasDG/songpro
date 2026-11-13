/*
 * Conversor TXT -> ChordPro (.cho)
 * Port a JavaScript puro de src/parser.ts + src/alignment.ts.
 * La lógica de alineación de acordes es la misma que la versión original.
 */
(function (global) {
  'use strict';

  // ───────────────────────── alignment ─────────────────────────

  const PROJECTION_BLEND = 0;
  const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
  const VOWEL_RE = /[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]/u;
  const WHITESPACE_RE = /\s/u;

  function expandTabs(line, tabSize = 8) {
    let expanded = '';
    let column = 0;
    for (const char of line) {
      if (char === '\t') {
        const spaces = tabSize - (column % tabSize);
        expanded += ' '.repeat(spaces);
        column += spaces;
        continue;
      }
      expanded += char;
      column += 1;
    }
    return expanded;
  }

  function isWordChar(char) {
    return char ? WORD_CHAR_RE.test(char) : false;
  }

  function getWordSpan(line, index) {
    let start = index;
    let end = index;
    while (start > 0 && isWordChar(line[start - 1])) start -= 1;
    while (end < line.length && isWordChar(line[end])) end += 1;
    return { start, end, length: Math.max(0, end - start) };
  }

  function classifyPosition(lyricLine, index, syllableBreaks) {
    const left = lyricLine[index - 1];
    const right = lyricLine[index];
    const leftWord = isWordChar(left);
    const rightWord = isWordChar(right);
    const wordSpan = getWordSpan(lyricLine, index);

    if (index === 0 || index === lyricLine.length) {
      return index === 0
        ? { score: 0.5, reason: 'line edge' }
        : { score: 1.5, reason: 'line edge' };
    }
    if (!leftWord && !rightWord) return { score: -1, reason: 'whitespace boundary' };
    if (!leftWord && rightWord) {
      const bonus = WHITESPACE_RE.test(left ?? '') ? -1.5 : -0.5;
      return { score: bonus, reason: 'word start' };
    }
    if (leftWord && !rightWord) return { score: 4, reason: 'word ending' };

    const fromStart = index - wordSpan.start;
    const toEnd = wordSpan.end - index;
    if (fromStart <= 1) return { score: -0.5, reason: 'near word start' };
    if (toEnd <= 1) return { score: 5, reason: 'near word ending' };
    if (syllableBreaks.has(index)) return { score: 1, reason: 'syllable boundary' };
    return { score: wordSpan.length >= 6 ? 3.5 : 2.5, reason: 'inside word' };
  }

  function approximateSyllableBreaks(line) {
    const breaks = new Set();
    for (let index = 0; index < line.length;) {
      if (!isWordChar(line[index])) { index += 1; continue; }
      const start = index;
      while (index < line.length && isWordChar(line[index])) index += 1;
      const end = index;
      const vowels = [];
      for (let p = start; p < end; p += 1) {
        if (VOWEL_RE.test(line[p])) vowels.push(p);
      }
      if (vowels.length > 1) for (const p of vowels.slice(1)) breaks.add(p);
      const lastVowel = vowels[vowels.length - 1];
      if (lastVowel !== undefined && lastVowel + 1 < end) breaks.add(lastVowel + 1);
    }
    return Array.from(breaks);
  }

  function scoreCandidate(lyricLine, candidateIndex, targetPosition, occupied, syllableBreaks) {
    const base = classifyPosition(lyricLine, candidateIndex, new Set(syllableBreaks));
    const occupiedPenalty = occupied.has(candidateIndex) ? 1000 : 0;
    const distance = Math.abs(candidateIndex - targetPosition);
    return { score: distance + base.score + occupiedPenalty, distance, reason: base.reason };
  }

  function alignChordLineMusical(chords, lyricLine, options = {}) {
    const expandedLyric = expandTabs(lyricLine);
    const lyricLength = expandedLyric.length;
    const chordLineLength = Math.max(
      1,
      options.sourceLineLength ?? Math.max(...chords.map((c) => c.index + c.chord.length), 0),
    );
    const syllableBreaks = approximateSyllableBreaks(expandedLyric);
    const decisions = [];
    const occupied = new Set();

    const sorted = [...chords].sort((a, b) => (a.index !== b.index ? a.index - b.index : a.order - b.order));

    for (const chord of sorted) {
      const relativePosition = chordLineLength === 0 ? 0 : chord.index / chordLineLength;
      const scaledTarget = relativePosition * lyricLength;
      const projectedTarget = chord.index + (scaledTarget - chord.index) * PROJECTION_BLEND;
      const targetPosition = Math.max(0, Math.min(lyricLength, Math.round(projectedTarget)));
      const windowStart = Math.max(0, targetPosition - 3);
      const windowEnd = Math.min(expandedLyric.length, targetPosition + 3);

      let chosenPosition = Math.min(targetPosition, expandedLyric.length);
      let reason = 'projected position';
      let bestScore = Infinity;
      let bestDistance = Infinity;

      for (let ci = windowStart; ci <= windowEnd; ci += 1) {
        const cand = scoreCandidate(expandedLyric, ci, targetPosition, occupied, syllableBreaks);
        if (
          cand.score < bestScore ||
          (cand.score === bestScore && cand.distance < bestDistance) ||
          (cand.score === bestScore && cand.distance === bestDistance &&
            Math.abs(ci - targetPosition) < Math.abs(chosenPosition - targetPosition))
        ) {
          bestScore = cand.score;
          bestDistance = cand.distance;
          chosenPosition = ci;
          reason = cand.reason;
        }
      }

      occupied.add(chosenPosition);
      decisions.push({ chord, targetPosition, chosenPosition, reason });
    }

    let result = expandedLyric;
    const ordered = [...decisions].sort((a, b) =>
      a.chosenPosition !== b.chosenPosition ? b.chosenPosition - a.chosenPosition : b.chord.order - a.chord.order,
    );

    for (let i = 0; i < ordered.length;) {
      const position = ordered[i].chosenPosition;
      const group = [];
      while (i < ordered.length && ordered[i].chosenPosition === position) {
        group.push(ordered[i]);
        i += 1;
      }
      if (position > result.length) result += ' '.repeat(position - result.length);
      const payload = group.map((d) => `[${d.chord.chord}]`).join(' ');
      result = result.slice(0, position) + payload + result.slice(position);
    }

    return { line: result, decisions };
  }

  function alignChordLineStrict(chords, lyricLine) {
    const expandedLyric = expandTabs(lyricLine);
    const bySource = [...chords].sort((a, b) => (a.index !== b.index ? a.index - b.index : a.order - b.order));

    let insertedWidth = 0;
    const adjusted = bySource.map((chord) => {
      const targetIndex = Math.max(0, chord.index - insertedWidth);
      insertedWidth += chord.chord.length + 2;
      return { ...chord, targetIndex };
    });

    const ordered = adjusted.sort((a, b) =>
      a.targetIndex !== b.targetIndex ? b.targetIndex - a.targetIndex : b.order - a.order,
    );

    let result = expandedLyric;
    for (const chord of ordered) {
      let t = chord.targetIndex;
      if (t < result.length && WHITESPACE_RE.test(result[t] ?? '')) {
        while (t < result.length && WHITESPACE_RE.test(result[t] ?? '')) t += 1;
      }
      if (t > result.length) result += ' '.repeat(t - result.length);
      result = result.slice(0, t) + `[${chord.chord}]` + result.slice(t);
    }
    return result;
  }

  // ───────────────────────── parser ─────────────────────────

  const CHORD_ROOT = String.raw`[A-G](?:#|b)?`;
  // Incluye la notación de Cifra Club / Brasil: 7M y M7 (séptima mayor),
  // 7+ (aumentado), ° º (disminuido), ø (semidisminuido), Δ, b5 #9 etc.
  const CHORD_SUFFIX = String.raw`(?:maj7|maj9|maj11|maj13|maj|Maj7|Maj|min7|min9|min11|min13|min|mmaj7|mMaj7|m7M|m7b5|m6|m7|m9|m11|m13|m|M7|M9|M13|7M|9M|13M|M|dim7|dim9|dim|aug7|aug|sus2|sus4|sus|add2|add4|add6|add7|add9|add11|add13|[b#](?:5|9|11|13)|6|7|9|11|13|5|2|4|\+|°|º|ø|Δ)`;
  const CHORD_BODY = String.raw`${CHORD_ROOT}(?:${CHORD_SUFFIX})*(?:\([^)]+\))?(?:/[A-G](?:#|b)?)?`;
  const CHORD_TOKEN_RE = new RegExp(`^(?:${CHORD_BODY}|N\\.?C\\.?|X|x|%)$`);
  const isBlankLine = (line) => line.trim() === '';
  const isDirectiveLine = (line) => {
    const t = line.trim();
    return t.startsWith('{') && t.endsWith('}');
  };

  function formatChordOnlyLine(chords) {
    return chords.map((t) => `[${t.chord}]`).join(' ');
  }

  // Acordes opcionales o de paso entre paréntesis: "(E)", o "(E D)" en dos
  // fichas "(E" y "D)". Devuelve el acorde con sus paréntesis: "(E)", "(D)".
  function parseChordToken(text) {
    if (CHORD_TOKEN_RE.test(text)) return text;
    const m = /^\(?([^()]+?)\)?$/.exec(text);
    if (m && m[1] !== text && CHORD_TOKEN_RE.test(m[1]) && !/^[xX%]$/.test(m[1])) return `(${m[1]})`;
    return null;
  }

  function isMostlyChordTokens(tokens) {
    if (tokens.length === 0) return false;
    let chordTokens = 0;
    let nonChordTokens = 0;
    for (const token of tokens) {
      if (parseChordToken(token.text)) { chordTokens += 1; continue; }
      if (/^[|:.\-]+$/.test(token.text)) continue;
      nonChordTokens += 1;
    }
    return chordTokens > 0 && chordTokens >= nonChordTokens && chordTokens / tokens.length >= 0.5;
  }

  function extractChords(line) {
    const expanded = expandTabs(line);
    const tokens = [];
    let order = 0;
    for (const match of expanded.matchAll(/\S+/g)) {
      const text = match[0];
      const index = match.index ?? 0;
      const chord = parseChordToken(text);
      if (chord) tokens.push({ chord, index, order, width: text.length });
      order += 1;
    }
    return {
      chords: tokens,
      isChordLine: isMostlyChordTokens(Array.from(expanded.matchAll(/\S+/g), (m) => ({ text: m[0] }))),
      sourceLineLength: expanded.length,
    };
  }

  const detectChordLine = (line) => extractChords(line).isChordLine;

  // ── Etiquetas de sección (español / inglés / portugués) ──
  // Cada etiqueta reconocida se emite como {comment: Nombre}, que es lo que
  // usan WorshipTools / Worship Extreme en lugar de {start_of_chorus}, etc.
  // Las claves están normalizadas: minúsculas, sin acentos, guiones = espacio.
  const SECTION_ALIASES = {
    'Verso': ['verso', 'verse', 'estrofa', 'estrofe', 'parte', 'stanza'],
    'Pre-coro': ['pre coro', 'precoro', 'pre chorus', 'prechorus', 'pre refrao', 'prerefrao', 'pre estribillo'],
    'Coro': ['coro', 'chorus', 'estribillo', 'refrao', 'refrain'],
    'Puente': ['puente', 'bridge', 'ponte'],
    'Intro': ['intro', 'introduccion', 'introducao', 'introduction', 'intro instrumental'],
    'Interludio': ['inter', 'interludio', 'interlude', 'interlude instrumental'],
    'Instrumental': ['instrumental'],
    'Solo': ['solo'],
    'Final': ['final', 'outro', 'ending', 'coda', 'finale'],
    'Tag': ['tag'],
  };
  // Las secciones "instrumentales" pueden llevar acordes en la misma línea.
  const INSTRUMENTAL = new Set(['Intro', 'Interludio', 'Instrumental', 'Solo', 'Final']);
  // "Primeira Parte", "Segunda Parte"... (Cifra Club) -> Verso 1, Verso 2...
  const ORDINALS = {
    primeira: 1, primera: 1, first: 1, segunda: 2, second: 2, terceira: 3, tercera: 3, third: 3,
    quarta: 4, cuarta: 4, fourth: 4, quinta: 5, fifth: 5,
  };

  const ALIAS_TO_NAME = new Map();
  for (const [name, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) ALIAS_TO_NAME.set(alias, name);
  }
  // Más largos primero para que "pre coro" gane sobre "coro".
  const ALIAS_PATTERN = [...ALIAS_TO_NAME.keys()]
    .sort((a, b) => b.length - a.length)
    .map((a) => a.replace(/ /g, '[\\s\\-]*'))
    .join('|');
  const ORDINAL_PATTERN = Object.keys(ORDINALS).join('|');

  const LABEL_RE = new RegExp(
    '^\\s*[\\[(]?\\s*' +
      '(?:(?<ord>' + ORDINAL_PATTERN + ')\\s+(?<parte>parte|part)' +
      '|(?<num1>\\d+)\\s*(?:a|o|º|ª)?\\s+(?<alias1>' + ALIAS_PATTERN + ')(?![a-z])' +
      '|(?<alias>' + ALIAS_PATTERN + ')(?![a-z])(?:\\s*(?<num>\\d+)(?!\\s*(?:x|veces|vezes|times)(?![a-z])))?)' +
      '\\s*[\\])]?\\s*(?:[:.\\-–]\\s*)?(?<rest>.*)$',
  );

  // Quita acentos carácter por carácter para que los índices sigan alineados.
  function foldForMatch(line) {
    let out = '';
    for (const ch of line) {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += (base[0] || ch).toLowerCase();
    }
    return out;
  }

  const REPEAT_RE = /^\(?\s*(?:x\s*(\d+)|(\d+)\s*x|(\d+)\s*veces|(\d+)\s*vezes|(\d+)\s*times)\s*\)?$/i;

  function parseLabelLine(line) {
    const folded = foldForMatch(line.normalize('NFC'));
    const m = LABEL_RE.exec(folded);
    if (!m || !m.groups) return null;
    const g = m.groups;

    let name;
    let number;
    if (g.ord) {
      name = 'Verso';
      number = String(ORDINALS[g.ord]);
    } else {
      const alias = (g.alias || g.alias1).replace(/[\s\-]+/g, ' ').trim();
      name = ALIAS_TO_NAME.get(alias) || ALIAS_TO_NAME.get(alias.replace(/ /g, ''));
      number = g.num || g.num1;
    }
    if (!name) return null;

    // El "resto" se toma del texto original (mismas posiciones).
    const restStart = m[0].length - (g.rest || '').length;
    const rest = line.normalize('NFC').slice(restStart);
    return { name, number, rest };
  }

  // ── Diccionario personal ──
  // Formato, una regla por línea:
  //   Primeira parte = Verso 1
  //   Pre-Estribillo = {comment: Pre-coro}
  //   # las líneas con # son comentarios
  function dictKey(text) {
    return foldForMatch(text.normalize('NFC'))
      .trim()
      .replace(/^[\[(]\s*/, '')
      .replace(/\s*[\])]$/, '')
      .replace(/\s*[:.\-–]\s*$/, '')
      .replace(/[\s\-_]+/g, ' ')
      .trim();
  }

  function parseDictionary(text) {
    const map = new Map();
    for (const raw of (text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = dictKey(line.slice(0, eq));
      let value = line.slice(eq + 1).trim();
      if (!key || !value) continue;
      if (!value.startsWith('{')) value = `{comment: ${value}}`;
      map.set(key, value);
    }
    return map;
  }

  // "[Estribillo Final]", "[Refrão 2x]", "[Vamp]" ... (estilo Cifra Club):
  // una línea que empieza con [texto] y ese texto no es un acorde.
  const BRACKET_LABEL_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;

  function labelFromText(inner) {
    const text = inner.trim().replace(/\s*[:.\-–]\s*$/, '');
    const parsed = parseLabelLine(text);
    if (parsed) {
      const base = parsed.number ? `${parsed.name} ${parsed.number}` : parsed.name;
      const rest = parsed.rest.trim();
      if (!rest) return base;
      const repeat = REPEAT_RE.exec(rest);
      if (repeat) return `${base} x${repeat.slice(1).find(Boolean)}`;
      // calificador extra: "Final", "(Variación)", etc.
      return `${base} ${rest[0].toUpperCase()}${rest.slice(1)}`;
    }
    return text[0].toUpperCase() + text.slice(1);
  }

  function convertBracketLabel(line) {
    const m = BRACKET_LABEL_RE.exec(line);
    if (!m) return null;
    const inner = m[1].trim();
    if (!inner || CHORD_TOKEN_RE.test(inner)) return null; // [A] es acorde, no etiqueta
    if (!/[\p{L}]{2,}/u.test(inner)) return null;          // necesita al menos una palabra

    const rest = m[2];
    const label = labelFromText(inner);
    if (!rest.trim()) return { kind: 'label', lines: [`{comment: ${label}}`] };

    const repeat = REPEAT_RE.exec(rest.trim());
    if (repeat) return { kind: 'label', lines: [`{comment: ${label} x${repeat.slice(1).find(Boolean)}}`] };

    const extracted = extractChords(rest);
    if (extracted.isChordLine) {
      return { kind: 'label', lines: [`{comment: ${label}}`, formatChordOnlyLine(extracted.chords)] };
    }
    return null; // "[algo] seguido de letra": no tocar
  }

  function convertSpecialLine(line, dictionary) {
    if (dictionary && dictionary.size && !isBlankLine(line)) {
      const custom = dictionary.get(dictKey(line));
      if (custom) return { kind: 'label', lines: [custom] };
    }

    const bracketed = convertBracketLabel(line);
    if (bracketed) return bracketed;

    const parsed = parseLabelLine(line);
    if (!parsed) return { kind: 'none', lines: [] };

    const { name, number, rest } = parsed;
    let label = number ? `${name} ${number}` : name;
    const trimmed = rest.trim();

    if (!trimmed) {
      return { kind: 'label', lines: [`{comment: ${label}}`] };
    }

    const repeat = REPEAT_RE.exec(trimmed);
    if (repeat) {
      const times = repeat.slice(1).find(Boolean);
      return { kind: 'label', lines: [`{comment: ${label} x${times}}`] };
    }

    // "Intro: D A E", "[Intro] D A E", "Coro: G D Em C"
    const extracted = extractChords(rest);
    if (extracted.isChordLine && (INSTRUMENTAL.has(name) || extracted.chords.length > 0)) {
      return { kind: 'label', lines: [`{comment: ${label}}`, formatChordOnlyLine(extracted.chords)] };
    }

    // Cualquier otra cosa (p. ej. una letra que empieza con "Coro de ángeles...")
    return { kind: 'none', lines: [] };
  }

  function mergeChordLine(chords, lyricLine, options = {}) {
    // Cifra Club y otros sitios sangran la letra con espacios. Se quita esa
    // sangría y se recorren los acordes la misma cantidad, así la alineación
    // relativa se conserva y no quedan espacios sobrantes ("  [A] No me...").
    const expanded = expandTabs(lyricLine);
    const indent = expanded.length - expanded.trimStart().length;
    let lyric = expanded;
    let shifted = chords;
    let sourceLineLength = options.sourceLineLength;
    if (indent > 0 && expanded.trim()) {
      lyric = expanded.slice(indent);
      shifted = chords.map((c) => ({ ...c, index: Math.max(0, c.index - indent) }));
      if (sourceLineLength !== undefined) sourceLineLength = Math.max(1, sourceLineLength - indent);
    }

    // Acordes entre paréntesis pegados a otro ("G (E D)" = G y luego E, D de
    // paso): no se reparten por columna, van junto al acorde anterior.
    const GLUE = '\u0001';
    const glued = new Map();
    {
      const main = [];
      for (const c of [...shifted].sort((a, b) => a.index - b.index || a.order - b.order)) {
        const prev = main[main.length - 1];
        const prevEnd = prev ? prev.index + (prev.width ?? prev.chord.length) : -Infinity;
        if (prev && c.chord.startsWith('(') && c.index - prevEnd <= 1) {
          if (!glued.has(prev.key)) glued.set(prev.key, { chord: prev.chord, extra: [] });
          glued.get(prev.key).extra.push(c.chord);
          prev.width = c.index + (c.width ?? c.chord.length) - prev.index;
          continue;
        }
        main.push({ ...c, key: `${GLUE}${main.length}${GLUE}` });
      }
      for (const c of main) if (glued.has(c.key)) c.chord = `${c.chord}${c.key}`;
      shifted = main;
    }

    // Acordes que caen después de que termina la letra (p. ej. "Te quiero"
    // seguido de D Bm G A): no se amontonan en la última palabra, se ponen
    // al final respetando la separación que traían.
    const lyricEnd = lyric.trimEnd().length;
    const inside = shifted.filter((c) => c.index < lyricEnd);
    const trailing = shifted
      .filter((c) => c.index >= lyricEnd)
      .sort((a, b) => a.index - b.index || a.order - b.order);

    let line = inside.length
      ? (options.mode === 'strict'
        ? alignChordLineStrict(inside, lyric)
        : alignChordLineMusical(inside, lyric, { sourceLineLength }).line)
      : lyric;
    line = line.trimEnd();

    let prevEnd = lyricEnd;
    for (const c of trailing) {
      const gap = Math.max(1, c.index - prevEnd);
      line += ' '.repeat(gap) + `[${c.chord}]`;
      prevEnd = c.index + (c.width ?? c.chord.length);
    }
    for (const [key, g] of glued) {
      line = line.replace(`[${g.chord}${key}]`, `[${g.chord}]` + g.extra.map((x) => `[${x}]`).join(''));
    }
    return line;
  }

  // Caracteres invisibles que se cuelan al copiar de páginas web (Cifra Club
  // pone un espacio de ancho cero U+200B al inicio de cada línea). Se quitan,
  // y los espacios "raros" (no separables, etc.) se vuelven espacios normales.
  function cleanInvisible(text) {
    return text
      .replace(/[​‌‍⁠﻿­]/g, '')
      .replace(/[  -   　]/g, ' ');
  }

  function parseSong(text, options = {}) {
    const lines = cleanInvisible(text).replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    const dictionary = options.dictionary instanceof Map
      ? options.dictionary
      : parseDictionary(options.dictionary);
    let index = 0;

    while (index < lines.length) {
      const rawLine = lines[index];
      const special = convertSpecialLine(rawLine, dictionary);

      if (special.kind === 'label') {
        output.push(...special.lines);
        index += 1;
        continue;
      }

      if (isBlankLine(rawLine)) {
        output.push('');
        index += 1;
        continue;
      }

      if (isDirectiveLine(rawLine)) {
        output.push(rawLine.trimEnd());
        index += 1;
        continue;
      }

      const extracted = extractChords(rawLine);
      if (extracted.isChordLine) {
        const nextLine = lines[index + 1];
        const nextSpecial = nextLine !== undefined ? convertSpecialLine(nextLine, dictionary) : { kind: 'none' };
        const canMerge =
          nextLine !== undefined &&
          !isBlankLine(nextLine) &&
          !isDirectiveLine(nextLine) &&
          nextSpecial.kind === 'none' &&
          !detectChordLine(nextLine);

        if (canMerge) {
          output.push(mergeChordLine(extracted.chords, nextLine, {
            ...options,
            sourceLineLength: extracted.sourceLineLength,
          }));
          index += 2;
          continue;
        }

        output.push(formatChordOnlyLine(extracted.chords));
        index += 1;
        continue;
      }

      // Letra sin acordes: quitar espacios sobrantes al final
      output.push(rawLine.trimEnd());
      index += 1;
    }

    return output.join('\n');
  }

  // ───────────────────────── metadata (songService.ts) ─────────────────────────

  function normalizeText(content) {
    return cleanInvisible(content).replace(/\r\n?/g, '\n');
  }

  function applyMetadata(content, metadata = {}) {
    const directives = [
      metadata.title?.trim() ? `{title: ${metadata.title.trim()}}` : '',
      metadata.author?.trim() ? `{author: ${metadata.author.trim()}}` : '',
      metadata.key?.trim() ? `{key: ${metadata.key.trim()}}` : '',
      metadata.tempo?.trim() ? `{tempo: ${metadata.tempo.trim()}}` : '',
    ].filter(Boolean);
    if (directives.length === 0) return content;
    const normalized = normalizeText(content).replace(/^\n+/, '');
    return `${directives.join('\n')}\n\n${normalized}`;
  }

  function convertTxt(text, metadata = {}, mode = 'musical', dictionary = '') {
    const cho = parseSong(normalizeText(text), { mode, dictionary });
    return `${applyMetadata(cho, metadata).trimEnd()}\n`;
  }

  function sanitizeBaseName(name) {
    const base = (name || '').replace(/\.[^.]+$/, '').trim() || 'cancion';
    return (
      base
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .toLowerCase() || 'cancion'
    );
  }

  const api = {
    parseSong, convertTxt, applyMetadata, extractChords, detectChordLine,
    alignChordLineMusical, alignChordLineStrict, sanitizeBaseName, normalizeText,
    parseDictionary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChordConverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
