// Parses an ABC file to an object with the following structure:
// {
//   X: value from the X: lines in header (\n separated for multiple values)
//   V: value from the V:myname lines that appear before K:
//   (etc): for all the one-letter header-names.
//   K: value from the K: lines in header.
//   tempo: Q: line parsed as beatsecs
//   timbre: ... I:timbre line as parsed by makeTimbre
//   voice: {
//     myname: { // voice with id "myname"
//       V: value from the V:myname lines (from the body)
//       stems: [...] as parsed by parseABCstems
//    }
//  }
// }
// ABC files are idiosyncratic to parse: the written specifications
// do not necessarily reflect the defacto standard implemented by
// ABC content on the web.  This implementation is designed to be
// practical, working on content as it appears on the web, and only
// using the written standard as a guideline.

var utils = require('./utils');
var pitchToFrequency = utils.pitchToFrequency;

var ABCheader = /^([A-Za-z]):\s*(.*)$/;
var ABCtoken = /(?:\[[A-Za-z]:[^\]]*\])|\s+|%[^\n]*|![^\s!:|\[\]]*!|\+[^+|!]*\+|[_<>@^]?"[^"]*"|\[|\]|>+|<+|(?:(?:\^+|_+|=|)[A-Ga-g](?:,+|'+|))|\(\d+(?::\d+){0,2}|\d*\/\d+|\d+\/?|\/+|[xzXZ]|\[?\|\]?|:?\|:?|::|./g;

module.exports = function parseABCFile(str) {
  var lines = str.split('\n'),
      result = {},
      context = result, timbre,
      j, k, header, stems, key = {}, accent = { slurred: 0 }, voiceid, out;
  // ABC files are parsed one line at a time.
  for (j = 0; j < lines.length; ++j) {
    // First, check to see if the line is a header line.
    header = ABCheader.exec(lines[j]);
    if (header) {
      handleInformation(header[1], header[2].trim());
    } else if (/^\s*(?:%.*)?$/.test(lines[j])) {
      // Skip blank and comment lines.
      continue;
    } else {
      // Parse the notes.
      parseABCNotes(lines[j]);
    }
  }
  var infer = ['unitnote', 'unitbeat', 'tempo'];
  if (result.voice) {
    out = [];
    for (j in result.voice) {
      if (result.voice[j].stems && result.voice[j].stems.length) {
        // Calculate times for all the tied notes.  This happens at the end
        // because in principle, the first note of a song could be tied all
        // the way through to the last note.
        processTies(result.voice[j].stems);
        // Bring up inferred tempo values from voices if not specified
        // in the header.
        for (k = 0; k < infer.length; ++k) {
          if (!(infer[k] in result) && (infer[k] in result.voice[j])) {
            result[infer[k]] = result.voice[j][infer[k]];
          }
        }
        // Remove this internal state variable;
        delete result.voice[j].accent;
      } else {
        out.push(j);
      }
    }
    // Delete any voices that had no stems.
    for (j = 0; j < out.length; ++j) {
      delete result.voice[out[j]];
    }
  }
  return result;


  ////////////////////////////////////////////////////////////////////////
  // Parsing helper functions below.
  ////////////////////////////////////////////////////////////////////////


  // Processes header fields such as V: voice, which may appear at the
  // top of the ABC file, or in the ABC body in a [V:voice] directive.
  function handleInformation(field, value) {
    // The following headers are recognized and processed.
    switch(field) {
      case 'V':
        // A V: header switches voices if in the body.
        // If in the header, then it is just advisory.
        if (context !== result) {
          startVoiceContext(value.split(' ')[0]);
        }
        break;
      case 'M':
        parseMeter(value, context);
        break;
      case 'L':
        parseUnitNote(value, context);
        break;
      case 'Q':
        parseTempo(value, context);
        break;
    }
    // All headers (including unrecognized ones) are
    // just accumulated as properties. Repeated header
    // lines are accumulated as multiline properties.
    if (context.hasOwnProperty(field)) {
      context[field] += '\n' + value;
    } else {
      context[field] = value;
    }
    // The K header is special: it should be the last one
    // before the voices and notes begin.
    if (field == 'K') {
      key = keysig(value);
      if (context === result) {
        startVoiceContext(firstVoiceName());
      }
    }
  }

  // Shifts context to a voice with the given id given.  If no id
  // given, then just sticks with the current voice.  If the current
  // voice is unnamed and empty, renames the current voice.
  function startVoiceContext(id) {
    id = id || '';
    if (!id && context !== result) {
      return;
    }
    if (!result.voice) {
      result.voice = {};
    }
    if (result.voice.hasOwnProperty(id)) {
      // Resume a named voice.
      context = result.voice[id];
      accent = context.accent;
    } else {
      // Start a new voice.
      context = { id: id, accent: { slurred: 0 } };
      result.voice[id] = context;
      accent = context.accent;
    }
  }

  // For picking a default voice, looks for the first voice name.
  function firstVoiceName() {
    if (result.V) {
      return result.V.split(/\s+/)[0];
    } else {
      return '';
    }
  }

  // Parses a single line of ABC notes (i.e., not a header line).
  //
  // We process an ABC song stream by dividing it into tokens, each of
  // which is a pitch, duration, or special decoration symbol; then
  // we process each decoration individually, and we process each
  // stem as a group using parseStem.
  // The structure of a single ABC note is something like this:
  //
  // NOTE -> STACCATO? PITCH DURATION? TIE?
  //
  // I.e., it always has a pitch, and it is prefixed by some optional
  // decorations such as a (.) staccato marking, and it is suffixed by
  // an optional duration and an optional tie (-) marking.
  //
  // A stem is either a note or a bracketed series of notes, followed
  // by duration and tie.
  //
  // STEM -> NOTE   OR    '[' NOTE * ']' DURAITON? TIE?
  //
  // Then a song is just a sequence of stems interleaved with other
  // decorations such as dynamics markings and measure delimiters.
  function parseABCNotes(str) {
    var tokens = str.match(ABCtoken), parsed = null,
        index = 0, dotted = 0, beatlet = null, t;
    if (!tokens) {
      return null;
    }
    while (index < tokens.length) {
      // Ignore %comments and !markings!
      if (/^[\s%]/.test(tokens[index])) { index++; continue; }
      // Handle inline [X:...] information fields
      if (/^\[[A-Za-z]:[^\]]*\]$/.test(tokens[index])) {
        handleInformation(
          tokens[index].substring(1, 2),
          tokens[index].substring(3, tokens[index].length - 1).trim()
        );
        index++;
        continue;
      }
      // Handled dotted notation abbreviations.
      if (/</.test(tokens[index])) {
        dotted = -tokens[index++].length;
        continue;
      }
      if (/>/.test(tokens[index])) {
        dotted = tokens[index++].length;
        continue;
      }
      if (/^\(\d+(?::\d+)*/.test(tokens[index])) {
        beatlet = parseBeatlet(tokens[index++]);
        continue;
      }
      if (/^[!+].*[!+]$/.test(tokens[index])) {
        parseDecoration(tokens[index++], accent);
        continue;
      }
      if (/^.?".*"$/.test(tokens[index])) {
        // Ignore double-quoted tokens (chords and general text annotations).
        index++;
        continue;
      }
      if (/^[()]$/.test(tokens[index])) {
        if (tokens[index++] == '(') {
          accent.slurred += 1;
        } else {
          accent.slurred -= 1;
          if (accent.slurred <= 0) {
            accent.slurred = 0;
            if (context.stems && context.stems.length >= 1) {
              // The last notes in a slur are not slurred.
              slurStem(context.stems[context.stems.length - 1], false);
            }
          }
        }
        continue;
      }
      // Handle measure markings by clearing accidentals.
      if (/\|/.test(tokens[index])) {
        for (t in accent) {
          if (t.length == 1) {
            // Single-letter accent properties are note accidentals.
            delete accent[t];
          }
        }
        index++;
        continue;
      }
      parsed = parseStem(tokens, index, key, accent);
      // Skip unparsable bits
      if (parsed === null) {
        index++;
        continue;
      }
      // Process a parsed stem.
      if (beatlet) {
        scaleStem(parsed.stem, beatlet.time);
        beatlet.count -= 1;
        if (!beatlet.count) {
          beatlet = null;
        }
      }
      // If syncopated with > or < notation, shift part of a beat
      // between this stem and the previous one.
      if (dotted && context.stems && context.stems.length) {
        if (dotted > 0) {
          t = (1 - Math.pow(0.5, dotted)) * parsed.stem.time;
        } else {
          t = (Math.pow(0.5, -dotted) - 1) *
              context.stems[context.stems.length - 1].time;
        }
        syncopateStem(context.stems[context.stems.length - 1], t);
        syncopateStem(parsed.stem, -t);
      }
      dotted = 0;
      // Slur all the notes contained within a strem.
      if (accent.slurred) {
        slurStem(parsed.stem, true);
      }
      // Start a default voice if we're not in a voice yet.
      if (context === result) {
        startVoiceContext(firstVoiceName());
      }
      if (!('stems' in context)) { context.stems = []; }
      // Add the stem to the sequence of stems for this voice.
      context.stems.push(parsed.stem);
      // Advance the parsing index since a stem is multiple tokens.
      index = parsed.index;
    }
  }

  // Parse M: lines.  "3/4" is 3/4 time and "C" is 4/4 (common) time.
  function parseMeter(mline, beatinfo) {
    var d = /^C/.test(mline) ? 4/4 : durationToTime(mline);
    if (!d) { return; }
    if (!beatinfo.unitnote) {
      if (d < 0.75) {
        beatinfo.unitnote = 1/16;
      } else {
        beatinfo.unitnote = 1/8;
      }
    }
  }
  // Parse L: lines, e.g., "1/8".
  function parseUnitNote(lline, beatinfo) {
    var d = durationToTime(lline);
    if (!d) { return; }
    beatinfo.unitnote = d;
  }
  // Parse Q: line, e.g., "1/4=66".
  function parseTempo(qline, beatinfo) {
    var parts = qline.split(/\s+|=/), j, unit = null, tempo = null;
    for (j = 0; j < parts.length; ++j) {
      // It could be reversed, like "66=1/4", or just "120", so
      // determine what is going on by looking for a slash etc.
      if (parts[j].indexOf('/') >= 0 || /^[1-4]$/.test(parts[j])) {
        // The note-unit (e.g., 1/4).
        unit = unit || durationToTime(parts[j]);
      } else {
        // The tempo-number (e.g., 120)
        tempo = tempo || Number(parts[j]);
      }
    }
    if (unit) {
      beatinfo.unitbeat = unit;
    }
    if (tempo) {
      beatinfo.tempo = tempo;
    }
  }
  // Run through all the notes, adding up time for tied notes,
  // and marking notes that were held over with holdover = true.
  function processTies(stems) {
    var tied = {}, nextTied, j, k, note, firstNote;
    for (j = 0; j < stems.length; ++j) {
      nextTied = {};
      for (k = 0; k < stems[j].notes.length; ++k) {
        firstNote = note = stems[j].notes[k];
        if (tied.hasOwnProperty(note.pitch)) {  // Pitch was tied from before.
          firstNote = tied[note.pitch];   // Get the earliest note in the tie.
          firstNote.time += note.time;    // Extend its time.
          note.holdover = true;           // Silence this note as a holdover.
        }
        if (note.tie) {                   // This note is tied with the next.
          nextTied[note.pitch] = firstNote;  // Save it away.
        }
      }
      tied = nextTied;
    }
  }
  // Returns a map of A-G -> accidentals, according to the key signature.
  // When n is zero, there are no accidentals (e.g., C major or A minor).
  // When n is positive, there are n sharps (e.g., for G major, n = 1).
  // When n is negative, there are -n flats (e.g., for F major, n = -1).
  function accidentals(n) {
    var sharps = 'FCGDAEB',
        result = {}, j;
    if (!n) {
      return result;
    }
    if (n > 0) {  // Handle sharps.
      for (j = 0; j < n && j < 7; ++j) {
        result[sharps.charAt(j)] = '^';
      }
    } else {  // Flats are in the opposite order.
      for (j = 0; j > n && j > -7; --j) {
        result[sharps.charAt(6 + j)] = '_';
      }
    }
    return result;
  }
  // Decodes the key signature line (e.g., K: C#m) at the front of an ABC tune.
  // Supports the whole range of scale systems listed in the ABC spec.
  function keysig(keyname) {
    if (!keyname) { return {}; }
    var kkey, sigcodes = {
      // Major
      'c#':7, 'f#':6, 'b':5, 'e':4, 'a':3, 'd':2, 'g':1, 'c':0,
      'f':-1, 'bb':-2, 'eb':-3, 'ab':-4, 'db':-5, 'gb':-6, 'cb':-7,
      // Minor
      'a#m':7, 'd#m':6, 'g#m':5, 'c#m':4, 'f#m':3, 'bm':2, 'em':1, 'am':0,
      'dm':-1, 'gm':-2, 'cm':-3, 'fm':-4, 'bbm':-5, 'ebm':-6, 'abm':-7,
      // Mixolydian
      'g#mix':7, 'c#mix':6, 'f#mix':5, 'bmix':4, 'emix':3,
      'amix':2, 'dmix':1, 'gmix':0, 'cmix':-1, 'fmix':-2,
      'bbmix':-3, 'ebmix':-4, 'abmix':-5, 'dbmix':-6, 'gbmix':-7,
      // Dorian
      'd#dor':7, 'g#dor':6, 'c#dor':5, 'f#dor':4, 'bdor':3,
      'edor':2, 'ador':1, 'ddor':0, 'gdor':-1, 'cdor':-2,
      'fdor':-3, 'bbdor':-4, 'ebdor':-5, 'abdor':-6, 'dbdor':-7,
      // Phrygian
      'e#phr':7, 'a#phr':6, 'd#phr':5, 'g#phr':4, 'c#phr':3,
      'f#phr':2, 'bphr':1, 'ephr':0, 'aphr':-1, 'dphr':-2,
      'gphr':-3, 'cphr':-4, 'fphr':-5, 'bbphr':-6, 'ebphr':-7,
      // Lydian
      'f#lyd':7, 'blyd':6, 'elyd':5, 'alyd':4, 'dlyd':3,
      'glyd':2, 'clyd':1, 'flyd':0, 'bblyd':-1, 'eblyd':-2,
      'ablyd':-3, 'dblyd':-4, 'gblyd':-5, 'cblyd':-6, 'fblyd':-7,
      // Locrian
      'b#loc':7, 'e#loc':6, 'a#loc':5, 'd#loc':4, 'g#loc':3,
      'c#loc':2, 'f#loc':1, 'bloc':0, 'eloc':-1, 'aloc':-2,
      'dloc':-3, 'gloc':-4, 'cloc':-5, 'floc':-6, 'bbloc':-7
    };
    var k = keyname.replace(/\s+/g, '').toLowerCase().substr(0, 5);
    var scale = k.match(/maj|min|mix|dor|phr|lyd|loc|m/);
    if (scale) {
      if (scale == 'maj') {
        kkey = k.substr(0, scale.index);
      } else if (scale == 'min') {
        kkey = k.substr(0, scale.index + 1);
      } else {
        kkey = k.substr(0, scale.index + scale[0].length);
      }
    } else {
      kkey = /^[a-g][#b]?/.exec(k) || '';
    }
    var result = accidentals(sigcodes[kkey]);
    var extras = keyname.substr(kkey.length).match(/(_+|=|\^+)[a-g]/ig);
    if (extras) {
      for (var j = 0; j < extras.length; ++j) {
        var note = extras[j].charAt(extras[j].length - 1).toUpperCase();
        if (extras[j].charAt(0) == '=') {
          delete result[note];
        } else {
          result[note] = extras[j].substr(0, extras[j].length - 1);
        }
      }
    }
    return result;
  }
  // Additively adjusts the beats for a stem and the contained notes.
  function syncopateStem(stem, t) {
    var j, note, stemtime = stem.time, newtime = stemtime + t;
    stem.time = newtime;
    syncopateStem
    for (j = 0; j < stem.notes.length; ++j) {
      note = stem.notes[j];
      // Only adjust a note's duration if it matched the stem's duration.
      if (note.time == stemtime) { note.time = newtime; }
    }
  }
  // Marks everything in the stem with the slur attribute (or deletes it).
  function slurStem(stem, addSlur) {
    var j, note;
    for (j = 0; j < stem.notes.length; ++j) {
      note = stem.notes[j];
      if (addSlur) {
        note.slurred = true;
      } else if (note.slurred) {
        delete note.slurred;
      }
    }
  }
  // Scales the beats for a stem and the contained notes.
  function scaleStem(stem, s) {
    var j;
    stem.time *= s;
    for (j = 0; j < stem.notes.length; ++j) {
      stem.notes[j].time *= s;;
    }
  }
  // Parses notation of the form (3 or (5:2:10, which means to do
  // the following 3 notes in the space of 2 notes, or to do the following
  // 10 notes at the rate of 5 notes per 2 beats.
  function parseBeatlet(token) {
    var m = /^\((\d+)(?::(\d+)(?::(\d+))?)?$/.exec(token);
    if (!m) { return null; }
    var count = Number(m[1]),
        beats = Number(m[2]) || 2,
        duration = Number(m[3]) || count;
    return {
      time: beats / count,
      count: duration
    };
  }
  // Parse !ppp! markings.
  function parseDecoration(token, accent) {
    if (token.length < 2) { return; }
    token = token.substring(1, token.length - 1);
    switch (token) {
      case 'pppp': case 'ppp':
        accent.dynamics = 0.2; break;
      case 'pp':
        accent.dynamics = 0.4; break;
      case 'p':
        accent.dynamics = 0.6; break;
      case 'mp':
        accent.dynamics = 0.8; break;
      case 'mf':
        accent.dynamics = 1.0; break;
      case 'f':
        accent.dynamics = 1.2; break;
      case 'ff':
        accent.dynamics = 1.4; break;
      case 'fff': case 'ffff':
        accent.dynamics = 1.5; break;
    }
  }
  // Parses a stem, which may be a single note, or which may be
  // a chorded note.
  function parseStem(tokens, index, key, accent) {
    var notes = [],
        duration = '', staccato = false,
        noteDuration, noteTime, velocity,
        lastNote = null, minStemTime = Infinity, j;
    // A single staccato marking applies to the entire stem.
    if (index < tokens.length && '.' == tokens[index]) {
      staccato = true;
      index++;
    }
    if (index < tokens.length && tokens[index] == '[') {
      // Deal with [CEG] chorded notation.
      index++;
      // Scan notes within the chord.
      while (index < tokens.length) {
        // Ignore and space and %comments.
        if (/^[\s%]/.test(tokens[index])) {
          index++;
          continue;
        }
        if (/[A-Ga-g]/.test(tokens[index])) {
          // Grab a pitch.
          lastNote = {
            pitch: applyAccent(tokens[index++], key, accent),
            tie: false
          }
          lastNote.frequency = pitchToFrequency(lastNote.pitch);
          notes.push(lastNote);
        } else if (/[xzXZ]/.test(tokens[index])) {
          // Grab a rest.
          lastNote = null;
          index++;
        } else if ('.' == tokens[index]) {
          // A staccato mark applies to the entire stem.
          staccato = true;
          index++;
          continue;
        } else {
          // Stop parsing the stem if something is unrecognized.
          break;
        }
        // After a pitch or rest, look for a duration.
        if (index < tokens.length &&
            /^(?![\s%!]).*[\d\/]/.test(tokens[index])) {
          noteDuration = tokens[index++];
          noteTime = durationToTime(noteDuration);
        } else {
          noteDuration = '';
          noteTime = 1;
        }
        // If it's a note (not a rest), store the duration
        if (lastNote) {
          lastNote.duration = noteDuration;
          lastNote.time = noteTime;
        }
        // When a stem has more than one duration, use the shortest
        // one for timing. The standard says to pick the first one,
        // but in practice, transcribed music online seems to
        // follow the rule that the stem's duration is determined
        // by the shortest contained duration.
        if (noteTime && noteTime < minStemTime) {
          duration = noteDuration;
          minStemTime = noteTime;
        }
        // After a duration, look for a tie mark.  Individual notes
        // within a stem can be tied.
        if (index < tokens.length && '-' == tokens[index]) {
          if (lastNote) {
            notes[notes.length - 1].tie = true;
          }
          index++;
        }
      }
      // The last thing in a chord should be a ].  If it isn't, then
      // this doesn't look like a stem after all, and return null.
      if (tokens[index] != ']') {
        return null;
      }
      index++;
    } else if (index < tokens.length && /[A-Ga-g]/.test(tokens[index])) {
      // Grab a single note.
      lastNote = {
        pitch: applyAccent(tokens[index++], key, accent),
        tie: false,
        duration: '',
        time: 1
      }
      lastNote.frequency = pitchToFrequency(lastNote.pitch);
      notes.push(lastNote);
    } else if (index < tokens.length && /^[xzXZ]$/.test(tokens[index])) {
      // Grab a rest - no pitch.
      index++;
    } else {
      // Something we don't recognize - not a stem.
      return null;
    }
    // Right after a [chord], note, or rest, look for a duration marking.
    if (index < tokens.length && /^(?![\s%!]).*[\d\/]/.test(tokens[index])) {
      duration = tokens[index++];
      noteTime = durationToTime(duration);
      // Apply the duration to all the ntoes in the stem.
      // NOTE: spec suggests multiplying this duration, but that
      // idiom is not seen (so far) in practice.
      for (j = 0; j < notes.length; ++j) {
        notes[j].duration = duration;
        notes[j].time = noteTime;
      }
    }
    // Then look for a trailing tie marking.  Will tie every note in a chord.
    if (index < tokens.length && '-' == tokens[index]) {
      index++;
      for (j = 0; j < notes.length; ++j) {
        notes[j].tie = true;
      }
    }
    if (accent.dynamics) {
      velocity = accent.dynamics;
      for (j = 0; j < notes.length; ++j) {
        notes[j].velocity = velocity;
      }
    }
    return {
      index: index,
      stem: {
        notes: notes,
        duration: duration,
        staccato: staccato,
        time: durationToTime(duration)
      }
    };
  }
  // Normalizes pitch markings by stripping leading = if present.
  function stripNatural(pitch) {
    if (pitch.length > 0 && pitch.charAt(0) == '=') {
      return pitch.substr(1);
    }
    return pitch;
  }
  // Processes an accented pitch, automatically applying accidentals
  // that have accumulated within the measure, and also saving
  // explicit accidentals to continue to apply in the measure.
  function applyAccent(pitch, key, accent) {
    var m = /^(\^+|_+|=|)([A-Ga-g])(.*)$/.exec(pitch), letter;
    if (!m) { return pitch; }
    // Note that an accidental in one octave applies in other octaves.
    letter = m[2].toUpperCase();
    if (m[1].length > 0) {
      // When there is an explicit accidental, then remember it for
      // the rest of the measure.
      accent[letter] = m[1];
      return stripNatural(pitch);
    }
    if (accent.hasOwnProperty(letter)) {
      // Accidentals from this measure apply to unaccented notes.
      return stripNatural(accent[letter] + m[2] + m[3]);
    }
    if (key.hasOwnProperty(letter)) {
      // Key signatures apply by default.
      return stripNatural(key[letter] + m[2] + m[3]);
    }
    return stripNatural(pitch);
  }
  // Converts an ABC duration to a number (e.g., "/3"->0.333 or "11/2"->1.5).
  function durationToTime(duration) {
    var m = /^(\d*)(?:\/(\d*))?$|^(\/+)$/.exec(duration), n, d, i = 0, ilen;
    if (!m) return;
    if (m[3]) return Math.pow(0.5, m[3].length);
    d = (m[2] ? parseFloat(m[2]) : /\//.test(duration) ? 2 : 1);
    // Handle mixed frations:
    ilen = 0;
    n = (m[1] ? parseFloat(m[1]) : 1);
    if (m[2]) {
      while (ilen + 1 < m[1].length && n > d) {
        ilen += 1
        i = parseFloat(m[1].substring(0, ilen))
        n = parseFloat(m[1].substring(ilen))
      }
    }
    return i + (n / d);
  }
}
