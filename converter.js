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
  const CHORD_SUFFIX = String.raw`(?:maj7|maj9|maj11|maj13|maj|min7|min9|min11|min13|min|mmaj7|m7b5|m6|m7|m9|m11|m13|m|dim7|dim9|dim|aug7|aug|sus2|sus4|sus|add2|add4|add6|add7|add9|add11|add13|6|7|9|11|13|5|2|4)`;
  const CHORD_BODY = String.raw`${CHORD_ROOT}(?:${CHORD_SUFFIX})*(?:\([^)]+\))?(?:/[A-G](?:#|b)?)?`;
  const CHORD_TOKEN_RE = new RegExp(`^(?:${CHORD_BODY}|N\\.?C\\.?|X|x|%)$`);
  const LABEL_RE = /^\s*(?<label>intro|inter|intro\s+instrumental|verse|verso|coro|chorus|bridge|puente|outro|estrofa|estribillo|refrao|refrain)(?:\s+(?<number>\d+))?\s*[:\-]?\s*(?<rest>.*)$/i;

  const isBlankLine = (line) => line.trim() === '';
  const isDirectiveLine = (line) => {
    const t = line.trim();
    return t.startsWith('{') && t.endsWith('}');
  };

  function mapLabelToSection(label) {
    const n = label.toLowerCase();
    if (n === 'verse' || n === 'verso' || n === 'estrofa') return 'verse';
    if (n === 'chorus' || n === 'coro' || n === 'estribillo' || n === 'refrain' || n === 'refrao') return 'chorus';
    if (n === 'bridge' || n === 'puente') return 'bridge';
    return null;
  }

  function makeSectionDirective(kind, label) {
    const d = kind === 'verse' ? 'start_of_verse' : kind === 'chorus' ? 'start_of_chorus' : 'start_of_bridge';
    return label ? `{${d}: ${label}}` : `{${d}}`;
  }

  function makeEndDirective(kind) {
    return kind === 'verse' ? '{end_of_verse}' : kind === 'chorus' ? '{end_of_chorus}' : '{end_of_bridge}';
  }

  function formatChordOnlyLine(chords) {
    return chords.map((t) => `[${t.chord}]`).join(' ');
  }

  function isMostlyChordTokens(tokens) {
    if (tokens.length === 0) return false;
    let chordTokens = 0;
    let nonChordTokens = 0;
    for (const token of tokens) {
      if (CHORD_TOKEN_RE.test(token.text)) { chordTokens += 1; continue; }
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
      if (CHORD_TOKEN_RE.test(text)) tokens.push({ chord: text, index, order });
      order += 1;
    }
    return {
      chords: tokens,
      isChordLine: isMostlyChordTokens(Array.from(expanded.matchAll(/\S+/g), (m) => ({ text: m[0] }))),
      sourceLineLength: expanded.length,
    };
  }

  const detectChordLine = (line) => extractChords(line).isChordLine;

  function parseLabelLine(line) {
    const match = LABEL_RE.exec(line);
    if (!match || !match.groups) return null;
    const { label, number } = match.groups;
    const rest = match.groups.rest ?? '';
    const n = label.toLowerCase();
    if (n === 'intro' || n === 'inter' || n === 'outro') return { label, number, rest };
    if (!mapLabelToSection(label)) return null;
    return { label, number, rest };
  }

  const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

  function convertSpecialLine(line) {
    const parsed = parseLabelLine(line);
    if (!parsed) return { kind: 'none', lines: [] };

    const { label, number, rest } = parsed;
    const section = mapLabelToSection(label);

    if (section && isBlankLine(rest)) {
      const sectionLabel = number ? `${capitalize(label)} ${number}` : undefined;
      return { kind: 'section-start', lines: [makeSectionDirective(section, sectionLabel)], openSection: section };
    }

    const n = label.toLowerCase();
    const isInstrumental = n === 'intro' || n === 'inter' || n === 'intro instrumental' || n === 'outro';

    if (isInstrumental && rest.trim()) {
      const extracted = extractChords(rest);
      if (extracted.isChordLine) {
        return {
          kind: 'comment-and-chords',
          lines: [`{comment: ${capitalize(label)}}`, formatChordOnlyLine(extracted.chords)],
        };
      }
    }

    if (isInstrumental && isBlankLine(rest)) {
      return { kind: 'comment-and-chords', lines: [`{comment: ${capitalize(label)}}`] };
    }

    return { kind: 'none', lines: [] };
  }

  function mergeChordLine(chords, lyricLine, options = {}) {
    if (options.mode === 'strict') return alignChordLineStrict(chords, lyricLine);
    return alignChordLineMusical(chords, lyricLine, { sourceLineLength: options.sourceLineLength }).line;
  }

  function parseSong(text, options = {}) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let openSection = null;
    let index = 0;

    while (index < lines.length) {
      const rawLine = lines[index];
      const special = convertSpecialLine(rawLine);

      if (special.kind === 'section-start') {
        if (openSection) output.push(makeEndDirective(openSection));
        openSection = special.openSection ?? null;
        output.push(...special.lines);
        index += 1;
        continue;
      }

      if (special.kind === 'comment-and-chords') {
        output.push(...special.lines);
        index += 1;
        continue;
      }

      if (isBlankLine(rawLine)) {
        if (openSection) {
          output.push(makeEndDirective(openSection));
          openSection = null;
        }
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
        const nextSpecial = nextLine !== undefined ? convertSpecialLine(nextLine) : { kind: 'none' };
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

      output.push(rawLine);
      index += 1;
    }

    if (openSection) output.push(makeEndDirective(openSection));
    return output.join('\n');
  }

  // ───────────────────────── metadata (songService.ts) ─────────────────────────

  function normalizeText(content) {
    return content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
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

  function convertTxt(text, metadata = {}, mode = 'musical') {
    const cho = parseSong(normalizeText(text), { mode });
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
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChordConverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
