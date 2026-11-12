/*
 * Transpositor ChordPro para el navegador.
 * Port de src/chordproSyntax.ts + src/chordproTransposer.ts (compilado con tsc,
 * misma lógica). Sigue la convención oficial de ChordPro:
 *   {key:} = tono de los acordes escritos (las figuras que tocas)
 *   tono que suena = {key:} + capo
 */
(function (global) {
  'use strict';

  "use strict";
  // ── chordproSyntax.ts ──
  /**
   * Shared ChordPro syntax helpers: directive names (long and short forms), chord and
   * key parsing, and document validation. Used by the renderer, the transposer, the
   * editor, and the server, so this module must stay free of DOM and Node APIs.
   *
   * Directive names follow the official specification at https://www.chordpro.org.
   */
  const SHORT_FORMS = {
      ns: 'new_song',
      t: 'title',
      st: 'subtitle',
      c: 'comment',
      ci: 'comment_italic',
      cb: 'comment_box',
      soc: 'start_of_chorus',
      eoc: 'end_of_chorus',
      sov: 'start_of_verse',
      eov: 'end_of_verse',
      sob: 'start_of_bridge',
      eob: 'end_of_bridge',
      sot: 'start_of_tab',
      eot: 'end_of_tab',
      sog: 'start_of_grid',
      eog: 'end_of_grid',
      np: 'new_page',
      npp: 'new_physical_page',
      colb: 'column_break',
      cf: 'chordfont',
      cs: 'chordsize',
      tf: 'textfont',
      ts: 'textsize',
      g: 'grid',
      ng: 'no_grid',
      col: 'columns',
  };
  const LONG_TO_SHORT = Object.fromEntries(Object.entries(SHORT_FORMS).map(([short, long]) => [long, short]));
  const METADATA_DIRECTIVES = new Set([
      'title',
      'sorttitle',
      'subtitle',
      'artist',
      'sortartist',
      'author',
      'composer',
      'lyricist',
      'copyright',
      'album',
      'year',
      'key',
      'time',
      'tempo',
      'duration',
      'capo',
      'tag',
      'meta',
      'ccli',
  ]);
  const STANDALONE_DIRECTIVES = new Set([
      'new_song',
      'comment',
      'comment_italic',
      'comment_box',
      'highlight',
      'image',
      'chorus',
      'define',
      'chord',
      'transpose',
      'new_page',
      'new_physical_page',
      'column_break',
      'pagetype',
      'diagrams',
      'grid',
      'no_grid',
      'titles',
      'columns',
  ]);
  const FORMATTING_PREFIXES = ['chord', 'chorus', 'footer', 'grid', 'tab', 'label', 'toc', 'text', 'title'];
  const FORMATTING_SUFFIXES = ['font', 'size', 'colour'];
  /** Sections whose body is literal text: it is never parsed for chords. */
  const LITERAL_SECTIONS = new Set(['tab', 'grid', 'abc', 'ly', 'svg', 'textblock']);
  function canonicalDirectiveName(name) {
      const lower = name.trim().toLowerCase();
      return SHORT_FORMS[lower] ?? lower;
  }
  function shortDirectiveName(longName) {
      return LONG_TO_SHORT[longName] ?? longName;
  }
  function isMetadataDirective(canonicalName) {
      return METADATA_DIRECTIVES.has(canonicalName);
  }
  function isLiteralSection(sectionType) {
      return LITERAL_SECTIONS.has(sectionType);
  }
  function isKnownDirective(name) {
      if (METADATA_DIRECTIVES.has(name) || STANDALONE_DIRECTIVES.has(name))
          return true;
      if (name.startsWith('x_') || name.startsWith('start_of_') || name.startsWith('end_of_'))
          return true;
      return FORMATTING_PREFIXES.some((prefix) => FORMATTING_SUFFIXES.some((suffix) => name === `${prefix}${suffix}`));
  }
  /** Parses a line that holds a single directive, or returns null if it holds anything else. */
  function parseDirectiveLine(line) {
      const match = line.match(/^\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:-[A-Za-z0-9_!]+)?\s*(?::\s*([^{}]*?)|\s+([^{}]*?))?\s*\}\s*$/);
      if (!match) {
          return null;
      }
      return {
          name: canonicalDirectiveName(match[1]),
          writtenName: match[1].toLowerCase(),
          value: (match[2] ?? match[3] ?? '').trim(),
      };
  }
  /** Returns `chorus` for `start_of_chorus`, and null for anything else. */
  function sectionStartType(directiveName) {
      return directiveName.startsWith('start_of_') ? directiveName.slice('start_of_'.length) : null;
  }
  function sectionEndType(directiveName) {
      return directiveName.startsWith('end_of_') ? directiveName.slice('end_of_'.length) : null;
  }
  /** Accepts both `{soc: Coro}` and the spec's `{soc: label="Coro"}`. */
  function sectionLabel(value) {
      const labelled = value.match(/^label\s*=\s*"([^"]*)"$/i);
      return (labelled ? labelled[1] : value).trim();
  }
  /** A key directive may be wrapped as `{meta: key C}`. Returns the effective name and value. */
  function unwrapMeta(directive) {
      if (directive.name !== 'meta') {
          return { name: directive.name, value: directive.value, isMeta: false };
      }
      const match = directive.value.match(/^(\S+)\s*(.*)$/);
      return match
          ? { name: match[1].toLowerCase(), value: match[2].trim(), isMeta: true }
          : { name: 'meta', value: '', isMeta: true };
  }
  /** Index of the line right after the metadata block at the top of the song. */
  function metadataInsertIndex(lines) {
      let index = 0;
      let lastMetadata = -1;
      while (index < lines.length) {
          const line = lines[index];
          const directive = parseDirectiveLine(line);
          if (directive && isMetadataDirective(directive.name)) {
              lastMetadata = index;
          }
          else if (line.trim() !== '' || lastMetadata >= 0) {
              break;
          }
          index += 1;
      }
      return lastMetadata + 1;
  }
  const NATURAL_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const CHORD_SHAPE = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/;
  const VALID_SUFFIX = /^(?:mmaj|mMaj|maj|Maj|MAJ|M|min|m|dim|aug|sus|add|omit|no|alt|ø|°|Δ|\+|-|[b#]?\d+|\/\d+|\([^()]*\)|,)*$/;
  function parseChord(text) {
      const match = text.trim().match(CHORD_SHAPE);
      if (!match || !VALID_SUFFIX.test(match[2])) {
          return null;
      }
      return { root: match[1], suffix: match[2], bass: match[3] ?? null };
  }
  /** Bracket contents that are legal ChordPro but are not transposable: rests, repeats, `[*Riff]`. */
  function isNonTransposableToken(text) {
      const trimmed = text.trim();
      return /^(?:N\.?C\.?|x|X|%|\/|\|)$/.test(trimmed) || trimmed.startsWith('*');
  }
  /**
   * Splits a token that holds several chords, such as `F - E7`, keeping its separators at
   * the odd positions. Chord sheets from the web often contain these. Returns null otherwise.
   */
  function chordSequenceParts(text) {
      const parts = text.trim().split(/(\s*-\s+|\s+)/);
      const chords = parts.filter((_, index) => index % 2 === 0);
      return chords.length >= 2 && chords.every((chord) => parseChord(chord)) ? parts : null;
  }
  /** Web chord sheets often put headings in brackets: `[Intro]`, `[Coro 1]`. They are not chords. */
  function looksLikeSectionLabel(text) {
      return /\p{L}{3,}/u.test(text) && !parseChord(text) && !chordSequenceParts(text);
  }
  function isSectionLabelLine(line) {
      const match = line.match(/^\s*\[([^\[\]]+)\]\s*$/);
      return match !== null && looksLikeSectionLabel(match[1].trim());
  }
  function isChordSymbolMinor(suffix) {
      return /^(?:m(?!aj)|min|-)/i.test(suffix) && !/^M/.test(suffix);
  }
  function pitchClass(note) {
      const natural = NATURAL_PITCH[note[0]];
      const accidental = note[1] === '#' ? 1 : note[1] === 'b' ? -1 : 0;
      return (natural + accidental + 12) % 12;
  }
  function parseKey(text) {
      const match = text.trim().match(/^([A-G][#b]?)\s*(m|min|minor|menor|-|maj|major|mayor)?$/);
      if (!match) {
          return null;
      }
      return { tonic: match[1], minor: ['m', 'min', 'minor', 'menor', '-'].includes(match[2] ?? '') };
  }
  function formatKey(key) {
      return `${key.tonic}${key.minor ? 'm' : ''}`;
  }
  const DEFINE_KEYWORDS = new Set(['base-fret', 'frets', 'fingers', 'keys', 'copy', 'copyall', 'display', 'format', 'diagram']);
  /** Collects the tokens after `keyword`, up to the next keyword. */
  function defineSection(tokens, keyword) {
      const start = tokens.findIndex((token, index) => index > 0 && token.toLowerCase() === keyword);
      if (start < 0) {
          return null;
      }
      const values = [];
      for (let index = start + 1; index < tokens.length; index += 1) {
          if (DEFINE_KEYWORDS.has(tokens[index].toLowerCase())) {
              break;
          }
          values.push(tokens[index]);
      }
      return { start, values };
  }
  function parseFretValue(value) {
      if (/^(?:-1|n|x)$/i.test(value))
          return null;
      return /^\d+$/.test(value) ? Number(value) : undefined;
  }
  function parseDefine(value) {
      const tokens = value.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) {
          return null;
      }
      tokens[0] = tokens[0].replace(/:$/, '');
      const frets = defineSection(tokens, 'frets')?.values.map(parseFretValue) ?? null;
      const baseFret = Number(defineSection(tokens, 'base-fret')?.values[0] ?? 1);
      return {
          name: tokens[0],
          baseFret: Number.isInteger(baseFret) && baseFret >= 1 ? baseFret : 1,
          frets: frets && frets.every((entry) => entry !== undefined) ? frets : null,
          fingers: defineSection(tokens, 'fingers')?.values ?? null,
          keys: defineSection(tokens, 'keys')?.values ?? null,
          tokens,
          showDiagram: defineSection(tokens, 'diagram')?.values[0]?.toLowerCase() !== 'off',
      };
  }
  function validateDefine(value) {
      const parsed = parseDefine(value);
      if (!parsed)
          return false;
      const hasContent = ['frets', 'keys', 'copy', 'copyall', 'display'].some((keyword) => defineSection(parsed.tokens, keyword));
      if (!hasContent)
          return false;
      const fretSection = defineSection(parsed.tokens, 'frets');
      if (fretSection && (!parsed.frets || parsed.frets.length === 0))
          return false;
      return !defineSection(parsed.tokens, 'fingers') || !parsed.frets || parsed.fingers?.length === parsed.frets.length;
  }
  function validateChordPro(text) {
      const issues = [];
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      let openSection = null;
      let seenChorus = false;
      lines.forEach((line, lineIndex) => {
          const column = Math.max(0, line.search(/\S/));
          const add = (code, severity, detail, at = column) => {
              issues.push({ code, severity, line: lineIndex, column: at, detail });
          };
          if (line.trimStart().startsWith('#')) {
              return;
          }
          const directive = parseDirectiveLine(line);
          if (directive) {
              const startType = sectionStartType(directive.name);
              const endType = sectionEndType(directive.name);
              const effective = unwrapMeta(directive);
              if (startType) {
                  if (openSection) {
                      add('section_nested', 'error', startType);
                  }
                  openSection = { type: startType, line: lineIndex, column };
                  if (startType === 'chorus')
                      seenChorus = true;
              }
              else if (endType) {
                  if (openSection?.type === endType) {
                      openSection = null;
                  }
                  else {
                      add('section_end_without_start', 'error', endType);
                  }
              }
              else if (directive.name === 'chorus' && !seenChorus) {
                  add('chorus_without_section', 'warning', 'chorus');
              }
              else if (effective.name === 'key' && effective.value && !parseKey(effective.value)) {
                  add('key_invalid', 'error', effective.value);
              }
              else if (effective.name === 'capo' && effective.value && !/^\d+$/.test(effective.value)) {
                  add('capo_invalid', 'error', effective.value);
              }
              else if (directive.name === 'define' && !validateDefine(directive.value)) {
                  add('define_invalid', 'error', directive.value);
              }
              else if (!isKnownDirective(directive.name)) {
                  add('directive_unknown', 'warning', directive.writtenName);
              }
              return;
          }
          const openedSection = openSection;
          if (openedSection && isLiteralSection(openedSection.type)) {
              return;
          }
          // Everything below looks at lyric lines. Well-formed inline directives are masked
          // so a bracket inside one is not reported as a chord.
          const masked = line.replace(/\{[^{}]*\}/g, (match) => ' '.repeat(match.length));
          const unclosedBrace = masked.search(/[{}]/);
          if (unclosedBrace >= 0) {
              add('brace_unclosed', 'error', masked[unclosedBrace], unclosedBrace);
          }
          let cursor = 0;
          for (const match of masked.matchAll(/\[([^\[\]]*)\]/g)) {
              const at = match.index ?? 0;
              const stray = masked.slice(cursor, at).search(/[\[\]]/);
              if (stray >= 0) {
                  add('bracket_unclosed', 'error', masked[cursor + stray], cursor + stray);
              }
              cursor = at + match[0].length;
              const chord = match[1].trim();
              if (!chord) {
                  add('chord_empty', 'error', '[]', at);
              }
              else if (isSectionLabelLine(line)) {
                  add('section_label_in_brackets', 'warning', chord, at);
              }
              else if (!parseChord(chord) && !isNonTransposableToken(chord) && !chordSequenceParts(chord)) {
                  add('chord_malformed', 'error', chord, at);
              }
          }
          const trailingStray = masked.slice(cursor).search(/[\[\]]/);
          if (trailingStray >= 0) {
              add('bracket_unclosed', 'error', masked[cursor + trailingStray], cursor + trailingStray);
          }
      });
      const unclosed = openSection;
      if (unclosed) {
          issues.push({
              code: 'section_unclosed',
              severity: 'error',
              line: unclosed.line,
              column: unclosed.column,
              detail: unclosed.type,
          });
      }
      return issues.sort((left, right) => left.line - right.line || left.column - right.column);
  }
  class TransposeError extends Error {
      constructor(code, message) {
          super(message);
          this.name = 'TransposeError';
          this.code = code;
      }
  }
  const MAJOR_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR_KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  const FALLBACK_NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  /** Letter distance from the tonic for each chromatic degree: 1 b2 2 b3 3 4 #4 5 b6 6 b7 7. */
  const DEGREE_LETTER_STEP = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  /** Notes a guitarist would not read in a chord chart; they are written enharmonically. */
  const AWKWARD_NOTES = { 'E#': 'F', 'B#': 'C', Cb: 'B', Fb: 'E' };
  const EASY_SHAPES = new Set(['0:M', '7:M', '2:M', '9:M', '4:M', '9:m', '4:m', '2:m']);
  const MAJOR_DIATONIC = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]];
  const MINOR_DIATONIC = [[0, true], [3, false], [5, true], [7, true], [7, false], [8, false], [10, false]];
  function mod12(value) {
      return ((value % 12) + 12) % 12;
  }
  /** Writes a pitch class in the context of a key, e.g. 10 is Bb in F and 6 is F# in E. */
  function spellNote(pitch, key) {
      if (!key) {
          return FALLBACK_NOTE_NAMES[pitch];
      }
      const degree = mod12(pitch - pitchClass(key.tonic));
      const letter = LETTERS[(LETTERS.indexOf(key.tonic[0]) + DEGREE_LETTER_STEP[degree]) % 7];
      const offset = mod12(pitch - pitchClass(letter));
      const accidental = offset === 0 ? '' : offset === 1 ? '#' : offset === 11 ? 'b' : null;
      if (accidental === null) {
          return FALLBACK_NOTE_NAMES[pitch];
      }
      const note = `${letter}${accidental}`;
      return AWKWARD_NOTES[note] ?? note;
  }
  function preferredKey(pitch, minor) {
      return { tonic: (minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES)[pitch], minor };
  }
  function soundingKeyFor(writtenKey, capo) {
      if (!writtenKey)
          return null;
      return capo === 0 ? writtenKey : preferredKey(mod12(pitchClass(writtenKey.tonic) + capo), writtenKey.minor);
  }
  function writtenKeyFor(soundingKey, capo) {
      if (!soundingKey)
          return null;
      return capo === 0 ? soundingKey : preferredKey(mod12(pitchClass(soundingKey.tonic) - capo), soundingKey.minor);
  }
  /** The key the audience hears for a written key and capo, e.g. G with capo 4 is B. */
  function soundingKey(writtenKey, capo) {
      const sounding = soundingKeyFor(parseKey(writtenKey ?? ''), capo);
      return sounding ? formatKey(sounding) : null;
  }
  function transposeChord(text, semitones, key) {
      const chord = parseChord(text);
      if (!chord)
          return null;
      const root = spellNote(mod12(pitchClass(chord.root) + semitones), key);
      const bass = chord.bass ? `/${spellNote(mod12(pitchClass(chord.bass) + semitones), key)}` : '';
      return `${root}${chord.suffix}${bass}`;
  }
  /** Calls `onLine` for every line whose [ ] contents are real chords. */
  function forEachChordLine(lines, onLine) {
      let literalSection = null;
      lines.forEach((line, index) => {
          const directive = parseDirectiveLine(line);
          if (directive) {
              const start = sectionStartType(directive.name);
              const end = sectionEndType(directive.name);
              if (start && isLiteralSection(start))
                  literalSection = start;
              if (end && end === literalSection)
                  literalSection = null;
              return;
          }
          if (literalSection === null && !line.trimStart().startsWith('#')) {
              onLine(line, index);
          }
      });
  }
  /** Matches an inline directive (left untouched) or a bracketed token (group 1). */
  const INLINE_TOKEN = /\{[^{}]*\}|\[([^\[\]]*)\]/g;
  function collectChords(text) {
      const chords = [];
      forEachChordLine(text.replace(/\r\n?/g, '\n').split('\n'), (line) => {
          for (const match of line.matchAll(INLINE_TOKEN)) {
              if (match[1] === undefined)
                  continue;
              const sequence = chordSequenceParts(match[1]);
              if (sequence) {
                  chords.push(...sequence.filter((_, index) => index % 2 === 0));
              }
              else if (parseChord(match[1])) {
                  chords.push(match[1].trim());
              }
          }
      });
      return chords;
  }
  function chordFingerprint(text) {
      const chord = parseChord(text);
      return chord ? { pitch: pitchClass(chord.root), minor: isChordSymbolMinor(chord.suffix) } : null;
  }
  /** Share of the chords that belong to the key, from 0 to 1. */
  function diatonicFit(chords, key) {
      if (chords.length === 0)
          return 0;
      const tonic = pitchClass(key.tonic);
      const scale = (key.minor ? MINOR_DIATONIC : MAJOR_DIATONIC).map(([degree, minor]) => `${mod12(tonic + degree)}:${minor}`);
      const fitting = chords.filter((chord) => {
          const print = chordFingerprint(chord);
          return print !== null && scale.includes(`${print.pitch}:${print.minor}`);
      });
      return fitting.length / chords.length;
  }
  /** Infers a key from the first and last chords, which usually sit on the tonic. */
  function inferKey(text) {
      const chords = collectChords(text);
      if (chords.length === 0)
          return null;
      const toKey = (chord) => {
          const parsed = parseChord(chord);
          return { tonic: parsed.root, minor: isChordSymbolMinor(parsed.suffix) };
      };
      const first = toKey(chords[0]);
      const last = toKey(chords[chords.length - 1]);
      if (formatKey(first) === formatKey(last)) {
          return { key: formatKey(first), confidence: 'high' };
      }
      // A tie goes to the last chord: songs end on the tonic more often than they start on it.
      const best = diatonicFit(chords, first) > diatonicFit(chords, last) ? first : last;
      return { key: formatKey(best), confidence: 'low' };
  }
  function describeSong(text) {
      let key = null;
      let capo = null;
      for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
          const directive = parseDirectiveLine(line);
          if (!directive)
              continue;
          const effective = unwrapMeta(directive);
          if (effective.name === 'key' && key === null) {
              const parsed = parseKey(effective.value);
              if (parsed)
                  key = formatKey(parsed);
          }
          else if (effective.name === 'capo' && capo === null && /^\d+$/.test(effective.value)) {
              capo = Number(effective.value);
          }
      }
      return { key, soundingKey: soundingKey(key, capo ?? 0), capo: capo ?? 0, inferred: key === null ? inferKey(text) : null };
  }
  /** Rewrites a chord diagram so it sounds `semitones` higher and keeps its fingering where possible. */
  function transposeDefine(value, semitones, key, warnings) {
      const define = parseDefine(value);
      if (!define)
          return value;
      const tokens = [...define.tokens];
      const newName = transposeChord(tokens[0], semitones, key);
      if (newName === null) {
          warnings.push({ code: 'define_not_transposed', detail: tokens[0] });
          return value;
      }
      tokens[0] = newName;
      for (const keyword of ['copy', 'copyall', 'display']) {
          const section = defineSection(tokens, keyword);
          if (section && section.values[0]) {
              tokens[section.start + 1] = transposeChord(section.values[0], semitones, key) ?? section.values[0];
          }
      }
      if (!define.frets) {
          // Keyboard `keys` are relative to the root, so they stay valid as they are.
          return tokens.join(' ');
      }
      const absolute = define.frets.map((fret) => (fret === null ? null : fret === 0 ? 0 : fret + define.baseFret - 1));
      const shift = absolute.some((fret) => fret !== null && fret + semitones < 0) ? semitones + 12 : semitones;
      const moved = absolute.map((fret) => (fret === null ? null : fret + shift));
      const openStringMoved = shift !== 0 && absolute.some((fret) => fret === 0);
      if (openStringMoved) {
          warnings.push({ code: 'define_shape_changed', detail: newName });
      }
      const fretted = moved.filter((fret) => fret !== null && fret > 0);
      const highest = fretted.length > 0 ? Math.max(...fretted) : 0;
      const baseFret = highest > 4 ? Math.min(...fretted) : 1;
      const relative = moved.map((fret) => (fret === null ? 'x' : fret === 0 ? '0' : String(fret - baseFret + 1)));
      const rebuilt = [tokens[0], 'base-fret', String(baseFret), 'frets', ...relative];
      const fingers = defineSection(tokens, 'fingers');
      if (fingers && !openStringMoved) {
          rebuilt.push('fingers', ...fingers.values);
      }
      // Keep every option other than the ones rebuilt above.
      const rebuiltKeywords = ['base-fret', 'frets', 'fingers'];
      for (let index = 1; index < tokens.length; index += 1) {
          const lower = tokens[index].toLowerCase();
          if (rebuiltKeywords.includes(lower)) {
              index += defineSection(tokens.slice(index - 1), lower).values.length;
              continue;
          }
          if (parseFretValue(tokens[index]) === undefined || ['copy', 'copyall', 'display', 'diagram', 'format', 'keys'].includes(lower)) {
              rebuilt.push(tokens[index]);
          }
      }
      return rebuilt.join(' ');
  }
  function validatedCapo(capo) {
      if (!Number.isInteger(capo) || capo < 0 || capo > 12) {
          throw new TransposeError('invalid_capo', 'The capo must be a whole fret number from 0 to 12.');
      }
      return capo;
  }
  function pushUnique(warnings, warning) {
      if (!warnings.some((entry) => entry.code === warning.code && entry.detail === warning.detail)) {
          warnings.push(warning);
      }
  }
  function writeDirective(isMeta, name, value) {
      return isMeta ? `{meta: ${name} ${value}}` : `{${name}: ${value}}`;
  }
  /** Produces new ChordPro text. The input string is never modified. */
  function transposeSong(text, options) {
      const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
      const source = lines.join('\n');
      const info = describeSong(source);
      const warnings = [];
      // Resolve the sounding key of the source.
      let keyOrigin = 'none';
      let sourceKey = null;
      if (info.key) {
          sourceKey = parseKey(info.key);
          keyOrigin = 'directive';
      }
      else if (options.sourceKey) {
          sourceKey = parseKey(options.sourceKey);
          if (!sourceKey) {
              throw new TransposeError('invalid_source_key', `Unknown source key: ${options.sourceKey}`);
          }
          keyOrigin = 'provided';
      }
      else if (info.inferred) {
          sourceKey = parseKey(info.inferred.key);
          keyOrigin = 'inferred';
          warnings.push({ code: 'key_inferred', detail: info.inferred.key });
      }
      // Resolve the chord shift, the resulting key, and the capo.
      let semitones = 0;
      let resultKey = sourceKey;
      let resultCapo = info.capo;
      if (options.mode === 'key') {
          const target = parseKey(options.targetKey);
          if (!target) {
              throw new TransposeError('invalid_target_key', `Unknown target key: ${options.targetKey}`);
          }
          if (!sourceKey) {
              throw new TransposeError('key_required', 'The song has no key and no chords to infer one from.');
          }
          if (target.minor !== sourceKey.minor) {
              throw new TransposeError('mode_mismatch', 'The target key must have the same mode (major or minor) as the song.');
          }
          // The target is the key to be heard. The capo stays, so the shapes absorb the change.
          semitones = mod12(pitchClass(target.tonic) - pitchClass(soundingKeyFor(sourceKey, info.capo).tonic));
          resultKey = writtenKeyFor(target, info.capo);
      }
      else if (options.mode === 'semitones') {
          if (!Number.isInteger(options.semitones)) {
              throw new TransposeError('invalid_semitones', 'Semitones must be a whole number.');
          }
          semitones = options.semitones;
          if (sourceKey) {
              resultKey = preferredKey(mod12(pitchClass(sourceKey.tonic) + semitones), sourceKey.minor);
          }
      }
      else {
          resultCapo = validatedCapo(options.capo);
          // The sounding key stays put, so the shapes and {key:} move by the capo difference.
          semitones = info.capo - resultCapo;
          if (sourceKey && mod12(semitones) !== 0) {
              resultKey = preferredKey(mod12(pitchClass(sourceKey.tonic) + semitones), sourceKey.minor);
          }
      }
      // Prefer the smallest movement: +10 and -2 are the same chords, but only -2 fits a diagram.
      const signedShift = options.mode === 'key' && semitones > 6 ? semitones - 12 : semitones;
      const moved = mod12(signedShift) !== 0;
      if (info.capo > 0 && sourceKey && info.key) {
          const chords = collectChords(source);
          // Chords that fit {key:} minus the capo suggest {key:} was written as the sounding key.
          const shapesKey = writtenKeyFor(sourceKey, info.capo);
          if (diatonicFit(chords, shapesKey) > diatonicFit(chords, sourceKey)) {
              warnings.push({ code: 'capo_convention_mismatch', detail: `${info.key}/${info.capo}/${formatKey(shapesKey)}` });
          }
      }
      let spellingKey = resultKey;
      let firstKeySeen = false;
      let literalSection = null;
      const output = [];
      const rewriteChords = (line) => line.replace(INLINE_TOKEN, (match, token) => {
          if (token === undefined)
              return match;
          const trimmed = token.trim();
          if (!trimmed || isNonTransposableToken(trimmed) || isSectionLabelLine(line))
              return match;
          const sequence = chordSequenceParts(trimmed);
          if (sequence) {
              const rewritten = sequence.map((part, index) => (index % 2 === 0 ? transposeChord(part, signedShift, spellingKey) : part));
              return moved ? `[${rewritten.join('')}]` : match;
          }
          const transposed = transposeChord(trimmed, signedShift, spellingKey);
          if (transposed === null) {
              pushUnique(warnings, { code: 'chord_not_transposed', detail: trimmed });
              return match;
          }
          return moved ? `[${transposed}]` : match;
      });
      for (const line of lines) {
          const directive = parseDirectiveLine(line);
          if (!directive) {
              output.push(literalSection !== null || line.trimStart().startsWith('#') ? line : rewriteChords(line));
              continue;
          }
          const effective = unwrapMeta(directive);
          const start = sectionStartType(directive.name);
          const end = sectionEndType(directive.name);
          if (start && isLiteralSection(start))
              literalSection = start;
          if (end && end === literalSection)
              literalSection = null;
          if (start === 'grid' && moved)
              pushUnique(warnings, { code: 'grid_not_transposed', detail: 'grid' });
          if (effective.name === 'key') {
              const parsed = parseKey(effective.value);
              if (!firstKeySeen) {
                  firstKeySeen = true;
                  if (!parsed && effective.value) {
                      pushUnique(warnings, { code: 'key_invalid', detail: effective.value });
                  }
                  output.push(resultKey && (parsed === null || moved || options.mode !== 'capo')
                      ? writeDirective(effective.isMeta, 'key', formatKey(parsed && !moved ? parsed : resultKey))
                      : line);
              }
              else if (parsed) {
                  // A later {key:} marks a modulation, which moves along with the rest of the song.
                  const modulated = moved ? preferredKey(mod12(pitchClass(parsed.tonic) + semitones), parsed.minor) : parsed;
                  spellingKey = modulated;
                  output.push(writeDirective(effective.isMeta, 'key', formatKey(modulated)));
              }
              else {
                  pushUnique(warnings, { code: 'key_invalid', detail: effective.value });
                  output.push(line);
              }
              continue;
          }
          if (effective.name === 'capo' && options.mode === 'capo') {
              if (resultCapo > 0) {
                  output.push(writeDirective(effective.isMeta, 'capo', String(resultCapo)));
              }
              continue;
          }
          if ((directive.name === 'define' || directive.name === 'chord') && moved) {
              output.push(`{${directive.writtenName}: ${transposeDefine(directive.value, signedShift, spellingKey, warnings)}}`);
              continue;
          }
          if (directive.name === 'transpose') {
              pushUnique(warnings, { code: 'transpose_directive_present', detail: directive.value });
          }
          output.push(line);
      }
      // Add {key:} and {capo:} when the source had none.
      const needsKeyLine = !firstKeySeen && resultKey !== null;
      const hasCapoLine = output.some((line) => {
          const directive = parseDirectiveLine(line);
          return directive !== null && unwrapMeta(directive).name === 'capo';
      });
      const needsCapoLine = options.mode === 'capo' && resultCapo > 0 && !hasCapoLine;
      if (needsKeyLine || needsCapoLine) {
          const keyIndex = output.findIndex((line) => {
              const directive = parseDirectiveLine(line);
              return directive !== null && unwrapMeta(directive).name === 'key';
          });
          const insertAt = keyIndex >= 0 ? keyIndex + 1 : metadataInsertIndex(output);
          const additions = [
              ...(needsKeyLine ? [`{key: ${formatKey(resultKey)}}`] : []),
              ...(needsCapoLine ? [`{capo: ${resultCapo}}`] : []),
          ];
          const following = output[insertAt];
          const needsSpacer = insertAt === 0 && following !== undefined && following.trim() !== '';
          output.splice(insertAt, 0, ...additions, ...(needsSpacer ? [''] : []));
      }
      return {
          content: output.join('\n'),
          sourceKey: sourceKey ? formatKey(sourceKey) : null,
          resultKey: resultKey ? formatKey(resultKey) : null,
          soundingKey: soundingKey(resultKey ? formatKey(resultKey) : null, resultCapo),
          capo: resultCapo,
          semitones: signedShift,
          keyOrigin,
          warnings,
      };
  }
  /** Ranks capo positions by how many chords fall on G, C, D, A, E, Am, Em, and Dm. */
  function suggestCapo(text, options = {}) {
      const chords = collectChords(text);
      if (chords.length === 0)
          return [];
      const info = describeSong(text);
      const sounding = soundingKeyFor(parseKey(info.key ?? options.sourceKey ?? info.inferred?.key ?? ''), info.capo);
      const suggestions = [];
      for (let capo = 0; capo <= 9; capo += 1) {
          const shift = info.capo - capo;
          const key = writtenKeyFor(sounding, capo);
          let easy = 0;
          const shapes = [];
          for (const chord of chords) {
              const parsed = parseChord(chord);
              const isComplex = /dim|aug|°|ø|\+/.test(parsed.suffix);
              const minor = isChordSymbolMinor(parsed.suffix);
              const pitch = mod12(pitchClass(parsed.root) + shift);
              if (!isComplex && EASY_SHAPES.has(`${pitch}:${minor ? 'm' : 'M'}`)) {
                  easy += 1;
              }
              const shape = `${spellNote(pitch, key)}${minor ? 'm' : ''}`;
              if (!shapes.includes(shape)) {
                  shapes.push(shape);
              }
          }
          suggestions.push({ capo, easyRatio: easy / chords.length, shapes });
      }
      return suggestions
          .filter((entry) => entry.easyRatio > 0)
          .sort((left, right) => right.easyRatio - left.easyRatio || left.capo - right.capo)
          .slice(0, options.limit ?? 3);
  }
  /** The common chords of the written key, offered as one-click choices. */
  function diatonicChords(keyText) {
      const key = keyText ? parseKey(keyText) : null;
      if (!key)
          return [];
      const tonic = pitchClass(key.tonic);
      return (key.minor ? MINOR_DIATONIC : MAJOR_DIATONIC).map(([degree, minor]) => `${spellNote(mod12(tonic + degree), key)}${minor ? 'm' : ''}`);
  }
  /** Returns the text to print for a target, e.g. B with capo 4 gives {key: G} with G shapes. */
  function applyRenderTarget(text, target) {
      let output = text;
      if (target.soundingKey) {
          output = transposeSong(output, { mode: 'key', targetKey: target.soundingKey }).content;
      }
      if (target.capo !== undefined && target.capo !== null) {
          output = transposeSong(output, { mode: 'capo', capo: target.capo }).content;
      }
      return output;
  }
  function keyOptions(minor) {
      return (minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES).map((tonic) => `${tonic}${minor ? 'm' : ''}`);
  }
  /**
   * Builds a descriptive name, such as "Cancion (G).cho" or "Cancion (capo 4).cho".
   * A label left by an earlier transposition is replaced, so the original stays recognisable.
   */
  function transposedFilename(sourceFilename, changes) {
      const withoutExtension = sourceFilename.replace(/\.(?:cho|chordpro|txt)$/i, '').trim() || 'cancion';
      const base = withoutExtension.replace(/(?:\s*\((?:capo \d+|sin capo|[A-G][#b]?m?)\))+$/, '').trim() || 'cancion';
      const labels = [];
      if (changes.key)
          labels.push(`(${changes.key})`);
      if (changes.capo !== undefined && changes.capo !== null) {
          labels.push(changes.capo > 0 ? `(capo ${changes.capo})` : '(sin capo)');
      }
      return `${[base, ...labels].join(' ')}.cho`;
  }
  /**
   * Names a file after how `after` differs from `before`: the key that is heard and the capo.
   * A capo change alone keeps the sounding key, so it only adds the capo label.
   */
  function changedFilename(sourceFilename, before, after) {
      const previous = describeSong(before);
      const next = describeSong(after);
      const previousSounding = parseKey(previous.soundingKey ?? soundingKey(previous.inferred?.key, previous.capo) ?? '');
      const nextSounding = parseKey(next.soundingKey ?? '');
      const keyChanged = nextSounding !== null && (previousSounding === null || pitchClass(nextSounding.tonic) !== pitchClass(previousSounding.tonic));
      const capoChanged = next.capo !== previous.capo;
      if (!keyChanged && !capoChanged) {
          return sourceFilename.replace(/\.(?:txt|chordpro)$/i, '.cho');
      }
      return transposedFilename(sourceFilename, {
          key: keyChanged ? next.soundingKey : null,
          capo: capoChanged ? next.capo : null,
      });
  }
  const api = {
    transposeSong, describeSong, inferKey, keyOptions, soundingKey, parseKey, formatKey,
    pitchClass, transposeChord, suggestCapo, applyRenderTarget, transposedFilename, TransposeError,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Transposer = api;
})(typeof window !== 'undefined' ? window : globalThis);
