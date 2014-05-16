(function($) {

var interrupted = false;

function parseOptionString(str, defaultProp) {
  var token = str.match(/\w+(?:\s*\([^()]*(?:\([^()]*\)[^()]*)?\)|\b)/g),
      pat = /(\w+)(?:\s*\(([^()]*(?:\([^()]*\)[^()]*)?)\)|\b)/,
      result = {}, j, match, key, arg, value;
  for (j = 0; j < token.length; ++j) {
    match = pat.exec(token[j]);
    if (match) {
      key = match[1];
      arg = match[2];
      if (j == 0 && defaultProp && arg == null) {
        arg = key;
        key = defaultProp;
      }
      if (arg == null) {
        value = null;
      } else if (isNaN(arg)) {
        value = arg;
      } else {
        value = Number(arg);
      }
      result[key] = value;
    }
  }
  return result;
}

//////////////////////////////////////////////////////////////////////////
// WEB AUDIO SUPPORT
// Definition of play("ABC") - uses ABC music note syntax.
//////////////////////////////////////////////////////////////////////////

var ABCtoken = /(?:^\[V:\S*\])|\s+|\[|\]|>+|<+|(?:(?:\^\^|\^|__|_|=|)[A-Ga-g](?:,+|'+|))|\d*\/\d+|\d+|\/+|[xzXZ]|\||%[^\n]*$|./g;
var ABCheader = /^([A-Za-z]):\s*(.*)$/;
var audioTop = null;

function isAudioPresent() {
  return !!(window.AudioContext || window.webkitAudioContext);
}
function getAudioTop() {
  if (!audioTop) {
    var ac = new (window.AudioContext || window.webkitAudioContext),
        firstTime = null;
    audioTop = {
      ac: ac,
      out: null
    }
    resetAudio();
  }
  return audioTop;
}
function resetAudio() {
  if (audioTop) {
    // Disconnect the top-level node and make a new one.
    if (audioTop.out) {
      audioTop.out.disconnect();
      audioTop.out = null;
    }
    var dcn = audioTop.ac.createDynamicsCompressor();
    dcn.ratio = 16;
    dcn.attack = 0.0005;
    dcn.connect(audioTop.ac.destination);
    audioTop.out = dcn;
  }
}
// Returns a map of A-G -> accidentals, according to the key signature.
function accidentals(n) {
  var flats =  'BEADGCF',
      sharps = 'FCGDEAB',
      result = {}, j;
  if (!n) {
    return result;
  }
  if (n < 0) {
    for (j = 0; j < -n && j < 7; ++j) {
      result[flats.charAt(j)] = '_';
    }
  } else {
    for (j = 0; j < n && j < 7; ++j) {
      result[sharps.charAt(j)] = '^';
    }
  }
  return result;
}
// Decodes the key signature line (e.g., K: C#m) at the front of an ABC tune.
function keysig(k) {
  if (!k) { return {}; }
  var key, sigcodes = {
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
  k = k.replace(/\s+/g, '').toLowerCase().substr(0, 5);
  var scale = k.match(/maj|min|mix|dor|phr|lyd|loc|m/);
  if (scale) {
    if (scale == 'maj') {
      key = k.substr(0, scale.index);
    } else if (scale == 'min') {
      key = k.substr(0, scale.index + 1);
    } else {
      key = k.substr(0, scale.index + scale.length);
    }
  } else {
    key = /^[a-g][#b]?/.exec(k) || '';
  }
  var result = accidentals(sigcodes[key]);
  var extras = k.substr(key.length).match(/(__|_|=|\^\^|\^)[a-g]/g);
  if (extras) {
    for (j = 0; j < extras.length; ++j) {
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
// Parses an ABC file to an object with the following structure:
// {
//   X: value from the X: lines in header (\n separated for multiple values)
//   K: value from the K: lines in header, etc.
//   tempo: Q: line as beatsecs
//   timbre: ... I:timbre line as parsed by parseTimbre
//   voice: {
//     myname: { // voice with id "myname"
//       V: value from the V:myname lines
//       stems: [...] as parsed by parseABCstems
//       timbre: ... I:timbre line as parsed by parseTimbre
//    }
//  }
// }
function parseABCFile(str) {
  var lines = str.split('\n'),
      result = {
        voice: {}
      },
      context = result, timbre,
      j, header, stems, key = {}, accent = {}, out;
  // Shifts context to a voice with the given id given.  If no id
  // given, then just sticks with the current voice.  If the current
  // voice is unnamed and empty, renames the current voice.
  function startVoiceContext(id) {
    id = id || '';
    if (!id && context !== result) {
      return;
    }
    if (id && !context.id && (!context.stems || !context.stems.length)) {
      delete result.voice[context.id];
      context.id = id;
      result.voice[id] = context;
    } else if (result.voice.hasOwnProperty(id)) {
      context = result.voice[id];
      accent = {};
    } else {
      context = { id: id };
      result.voice[id] = context;
      accent = {};
    }
  }
  for (j = 0; j < lines.length; ++j) {
    header = ABCheader.exec(lines[j]);
    if (header) {
      switch(header[1]) {
        case 'V':
          startVoiceContext(header[2].split(' ')[0]);
          break;
        case 'M':
          parseMeter(header[2], context);
          break;
        case 'L':
          parseUnitNote(header[2], context);
          break;
        case 'Q':
          parseTempo(header[2], context);
          break;
        case 'I':
          timbre = /^timbre\s+(.*)$/.exec(header[2]);
          if (timbre) {
            context.timbre = parseTimbre(timbre);
          }
          break;
      }
      if (context.hasOwnProperty(header[1])) {
        context[header[1]] += '\n' + header[2];
      } else {
        context[header[1]] = header[2];
      }
      if (header[1] == 'K' && context === result) {
        key = keysig(header[2]);
        startVoiceContext();
      }
    } else {
      out = {};
      stems = parseABCNotes(lines[j], key, accent, out);
      if (stems && stems.length) {
        startVoiceContext(out.voiceid);
        if (!('stems' in context)) { context.stems = []; }
        context.stems.push.apply(context.stems, stems);
      }
    }
  }
  if (result.voice) {
    // Calculate times for all the tied stems.
    for (j = 0; j < result.voice.length; ++j) {
      if (result.voice[j].stems) {
        processTies(result.voice[j].stems);
      }
    }
  }
  return result;
}
function parseMeter(mline, beatinfo) {
  var d = durationToTime(mline);
  if (!d) { return; }
  if (!beatinfo.unitnote) {
    if (d < 0.75) {
      beatinfo.unitnote = 1/16;
    } else {
      beatinfo.unitnote = 1/8;
    }
  }
}
function parseUnitNote(lline, beatinfo) {
  var d = durationToTime(lline);
  if (!d) { return; }
  beatinfo.unitnote = d;
}
function parseTempo(qline, beatinfo) {
  var parts = qline.split(/\s*=\s*/), j, unit = null, tempo = null;
  for (j = 0; j < parts.length; ++j) {
    if (parts[j].indexOf('/') >= 0 || /^[1-4]$/.test(parts[j])) {
      unit = unit || durationToTime(parts[j]);
    } else {
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
function processTies(stems) {
  var tied = {}, nextTied, j, k, note, firstNote;
  // Run through all the notes, adding up time for tied stems,
  // and marking notes that were held over with holdover = true.
  for (j = 0; j < stems.length; ++j) {
    nextTied = {};
    for (k = 0; k < stems[j].note.length; ++k) {
      firstNote = note = stems[j].note[k];
      if (tied.hasOwnProperty(note.pitch)) {
        firstNote = tied[note.pitch];
        firstNote.time += note.time;
        note.holdover = true;
      }
      if (note.tie) {
        nextTied[note.pitch] = firstNote;
      }
    }
    tied = nextTied;
  }
}
function parseABCNotes(str, key, accent, out) {
  var tokens = str.match(ABCtoken), result = [], stem = null,
      index = 0, dotted = 0, t;
  if (!tokens) {
    return null;
  }
  while (index < tokens.length) {
    if (/^s+$/.test(tokens[index])) { index++; continue; }
    if (/^\[V:\S*\]$/.test(tokens[index])) {
      // Grab the voice id out of [V:id]
      if (out) {
        out.voiceid = tokens[index].substring(3, tokens[index].length - 1);
      }
      index++;
      continue;
    }
    if (/</.test(tokens[index])) { dotted = -tokens[index++].length; continue; }
    if (/>/.test(tokens[index])) { dotted = tokens[index++].length; continue; }
    if (/\|/.test(tokens[index])) {
      // Clear accidentals at the end of a measure.
      for (t in accent) if (accent.hasOwnProperty(t)) {
        delete accent[t];
      }
      index++;
      continue;
    }
    stem = parseStem(tokens, index, key, accent);
    if (stem === null) {
      // Skip unparsable bits
      index++;
      continue;
    }
    if (stem !== null) {
      if (dotted && result.length) {
        if (dotted > 0) {
          t = (1 - Math.pow(0.5, dotted)) * stem.value.time;
        } else {
          t = (Math.pow(0.5, -dotted) - 1) * result[result.length - 1].time;
        }
        result[result.length - 1].time += t;
        stem.value.time -= t;
        dotted = 0;
      }
      result.push(stem.value);
      index = stem.index;
    }
  }
  return result;
}
function stripNatural(pitch) {
  if (pitch.length > 0 && pitch.charAt(0) == '=') {
    return pitch.substr(1);
  }
  return pitch;
}
function applyAccent(pitch, key, accent) {
  var m = /^(\^\^|\^|__|_|=|)([A-Ga-g])(.*)$/.exec(pitch), letter;
  if (!m) { return pitch; }
  letter = m[2].toUpperCase();
  if (m[1].length > 0) {
    // When there is an explicit accidental, then remember it for
    // the rest of the measure.
    accent[letter] = m[1];
    return stripNatural(pitch);
  }
  if (accent.hasOwnProperty(letter)) {
    // Accidentals from this measure apply to unaccented stems.
    return stripNatural(accent[letter] + m[2] + m[3]);
  }
  if (key.hasOwnProperty(letter)) {
    // Key signatures apply by default.
    return stripNatural(key[letter] + m[2] + m[3]);
  }
  return stripNatural(pitch);
}
function parseStem(tokens, index, key, accent) {
  var note = [],
      duration = '', staccato = false;
  var lastNote = null, minStemTime = Infinity, j;
  if (index < tokens.length && '.' == tokens[index]) {
    staccato = true;
    index++;
  }
  if (index < tokens.length && tokens[index] == '[') {
    index++;
    while (index < tokens.length) {
      if (/[A-Ga-g]/.test(tokens[index])) {
        lastNote = {
          pitch: applyAccent(tokens[index++], key, accent),
          tie: false
        }
        lastNote.frequency = pitchToFrequency(lastNote.pitch);
        note.push(lastNote);
      } else if (/[xzXZ]/.test(tokens[index])) {
        lastNote = null;
        index++;
      } else if ('.' == tokens[index]) {
        staccato = true;
        index++;
        continue;
      } else {
        break;
      }
      if (index < tokens.length && /\d|\//.test(tokens[index])) {
        noteDuration = tokens[index++];
        noteTime = durationToTime(noteDuration);
      } else {
        noteDuration = '';
        noteTime = 1;
      }
      if (lastNote) {
        // If it's a note (not a rest), store the duration
        lastNote.duration = noteDuration;
        lastNote.time = noteTime;
      }
      // When a stem has more than one duration, select the
      // shortest one. The standard says to pick the first one,
      // but in practice, transcribed music online seems to
      // follow the rule that the stem's duration is determined
      // by the shortest contained duration.
      if (noteTime && noteTime < minStemTime) {
        duration = noteDuration;
        minStemTime = noteTime;
      }
      if (index < tokens.length && '-' == tokens[index]) {
        if (lastNote) {
          note[note.length - 1].tie = true;
        }
        index++;
      }
    }
    if (tokens[index] != ']') {
      return null;
    }
    index++;
  } else if (index < tokens.length && /[A-Ga-g]/.test(tokens[index])) {
    lastNote = {
      pitch: applyAccent(tokens[index++], key, accent),
      tie: false,
      duration: '',
      time: 1
    }
    lastNote.frequency = pitchToFrequency(lastNote.pitch);
    note.push(lastNote);
  } else if (/^[xzXZ]$/.test(tokens[index])) {
    // Rest - no pitch.
    index++;
  } else {
    return null;
  }
  if (index < tokens.length && /\d|\//.test(tokens[index])) {
    duration = tokens[index++];
    noteTime = durationToTime(duration);
    for (j = 0; j < note.length; ++j) {
      note[j].duration = duration;
      note[j].time = noteTime;
    }
  }
  if (index < tokens.length && '-' == tokens[index]) {
    index++;
    for (j = 0; j < note.length; ++j) {
      note[j].tie = true;
    }
  }
  return {
    index: index,
    value: {
      note: note,
      duration: duration,
      staccato: staccato,
      time: durationToTime(duration)
    }
  };
}
function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function frequencyToMidi(freq) {
  // Approximate by getting the closest midi number.
  return Math.round(69 + Math.log(freq / 440) * 12 / Math.LN2);
}
function pitchToMidi(pitch) {
  var m = /^(\^\^|\^|__|_|=|)([A-Ga-g])(,+|'+|)$/.exec(pitch);
  if (!m) { return null; }
  var n = {C:-9,D:-7,E:-5,F:-4,G:-2,A:0,B:2,c:3,d:5,e:7,f:8,g:10,a:12,b:14};
  var a = { '^^':2, '^':1, '': 0, '=':0, '_':-1, '__':-2 };
  var semitone = n[m[2]] + a[m[1]] + (/,/.test(m[3]) ? -12 : 12) * m[3].length;
  return semitone + 69; // 69 = midi code for "A", which is A4.
}
function pitchToFrequency(pitch) {
  return midiToFrequency(pitchToMidi(pitch));
}
function durationToTime(duration) {
  var m = /^(\d*)(?:\/(\d*))?$|^(\/+)$/.exec(duration), n, d, i = 0, ilen;
  if (!m) return;
  if (m[3]) return Math.pow(0.5, m[3].length);
  d = (m[2] ? parseFloat(m[2]) : /\//.test(duration) ? 2 : 1);
  // Handle mixed frations:
  ilen = 0;
  n = (m[1] ? parseFloat(m[1]) : 1);
  while (ilen + 1 < m[1].length && n > d) {
    ilen += 1
    i = parseFloat(m[1].substring(0, ilen))
    n = parseFloat(m[1].substring(ilen))
  }
  return i + (n / d);
}
var pianoTimbre = parseOptionString(
  "wave(sawtooth) gain(0.25) " +
  "attack(0.001) decay(0.3) sustain(0.01) release(0.1) " +
  "cutoff(1) resonance(5) detune(1.001)");

function parseTimbre(options) {
  if (!options) {
    options = {};
  } else if (typeof(options) == 'string') {
    options = parseOptionString(options, 'wave');
  }
  return $.extend({}, pianoTimbre, options);
}

function Instrument(options) {
  this._timbre = parseTimbre(options);
  this._atop = getAudioTop();
  this._out = this._atop.ac.createGain();
  this._out.gain.value = this.gain;
  this._out.connect(this._atop.out);
  this._queue = [];
  this._minQueueTime = Infinity;
  this._maxScheduledTime = 0;
  this._unsortedQueue = false;
  this._startSet = [];
  this._finishSet = [];
  this._cleanupSet = [];
  this._callbackSet = [];
  this._handlers = {};
  this._now = null;
}

Instrument.bufferSecs = 3;     // Seconds ahead to buffer notes.
Instrument.toneLength = 60;    // Default duration of a tone.
Instrument.cleanupDelay = 0.1; // Time before disconnecting gain nodes.
Instrument.nowDelay = 0.02;    // Hack to avoid bug http://crbug.com/254942.

Instrument.getAudioTop = getAudioTop;

Instrument.prototype.silence = function() {
  var j;
  // Clear future notes.
  this._queue.length = 0;
  this._minQueueTime = Infinity;
  // Don't notify notes that haven't started yet.
  this._startSet.length = 0;
  // Flush finish callbacks that are promised.
  for (j = 0; j < this._finishSet.length; ++j) {
    this._trigger('notefinish', this._finishSet[j]);
  }
  this._finishSet.length = 0;
  // Flush one-time callacks that are promised.
  for (j = 0; j < this._callbackSet.length; ++j) {
    this._callbackSet[j].callback();
  }
  this._callbackSet.length = 0;
  this._out.disconnect();
  this._out = this._atop.ac.createGain();
  this._out.gain.value = this.gain;
  this._out.connect(this._atop.out);
}
Instrument.prototype.now = function() {
  if (this._now != null) {
    return this._now;
  }
  this._startPollTimer(true);
  this._now = this._atop.ac.currentTime + Instrument.nowDelay;
  return this._now;
}
Instrument.prototype.on = function(ev, cb) {
  if (!this._handlers.hasOwnProperty(ev)) {
    this._handlers[ev] = [];
  }
  this._handlers[ev].push(cb);
}
Instrument.prototype.off = function(ev, cb) {
  if (this._handlers.hasOwnProperty(ev)) {
    if (!cb) {
      this._handlers[ev] = [];
    } else {
      var j, hunt = this._handlers[ev];
      for (j = 0; j < hunt.length; ++j) {
        if (hunt[j] === cb) {
          hunt.splice(j, 1);
          j -= 1;
        }
      }
    }
  }
}
Instrument.prototype._trigger = function(ev, record) {
  var cb = this._handlers[ev], j;
  if (!cb) {
    return;
  }
  for (j = 0; j < cb.length; ++j) {
    cb[j](record);
  }
}
function makeRecordRelease(instrument, record) {
  return (function() {
    var now = instrument.now();
    if (now < record.time + record.duration) {
      record.duration = Math.max(0, now - record.time);
      if (record.g) {
        var timbre = record.timbre || instrument._timbre,
            cleanuptime = now + timbre.release + Instrument.cleanupDelay;
        record.g.gain.cancelScheduledValues(now);
        record.g.gain.linearRampToValueAtTime(0, cleanuptime);
        record.cleanuptime = cleanuptime;
      }
    }
  });
}
Instrument.prototype._makeNoteSound = function(record) {
  if (record.duration <= 0) {
    return;
  }
  var timbre = record.timbre || this._timbre,
      starttime = record.time,
      releasetime = starttime + record.duration,
      attacktime = Math.min(releasetime, starttime + timbre.attack),
      stoptime = releasetime + timbre.release,
      doubled = timbre.detune && timbre.detune != 1.0,
      amp = timbre.gain * record.velocity * (doubled ? 0.5 : 1.0),
      ac = this._atop.ac,
      g, f, o;
  g = ac.createGain();
  g.gain.setValueAtTime(0, starttime);
  g.gain.linearRampToValueAtTime(amp, attacktime);
  g.gain.setTargetAtTime(amp * timbre.sustain, attacktime, timbre.decay);
  g.gain.setValueAtTime(amp * (timbre.sustain + (1 - timbre.sustain) *
      Math.exp((attacktime - releasetime) / timbre.decay)), releasetime);
  g.gain.linearRampToValueAtTime(0, stoptime);
  g.connect(this._out);
  if (!timbre.cutoff || timbre.cutoff == Infinity) {
    f = g;
  } else {
    f = ac.createBiquadFilter();
    f.frequency.value = record.frequency * timbre.cutoff;
    f.Q.value = timbre.resonance;
    f.connect(g);
  }
  o = ac.createOscillator();
  o.type = timbre.wave;
  o.frequency.value = record.frequency;
  o.connect(f);
  o.start(starttime);
  o.stop(stoptime);
  if (doubled) {
    o2 = ac.createOscillator();
    o2.type = timbre.wave;
    o2.frequency.value = record.frequency * timbre.detune;
    o2.connect(f);
    o2.start(starttime);
    o2.stop(stoptime);
  }
  record.g = g;
  record.cleanuptime = stoptime;
  this._startSet.push(record);
}
Instrument.prototype._doPoll = function() {
  this._pollTimer = null;
  this._now = null;
  if (interrupted) {
    this.silence();
    return;
  }
  var instrument = this,
      now = this._atop.ac.currentTime,
      j, work, when;
  // Schedule a batch of stems
  if (this._minQueueTime - now <= Instrument.bufferSecs) {
    if (this._unsortedQueue) {
      this._queue.sort(function(a, b) {
        if (a.time != b.time) { return a.time - b.time; }
        if (a.duration != b.duration) { return a.duration - b.duration; }
        return a.frequency - b.frequency;
      });
      this._unsortedQueue = false;
    }
    for (j = 0; j < this._queue.length; ++j) {
      if (this._queue[j].time - now > Instrument.bufferSecs) { break; }
    }
    if (j > 0) {
      work = this._queue.splice(0, j);
      for (j = 0; j < work.length; ++j) {
        this._makeNoteSound(work[j]);
      }
      this._minQueueTime =
        (this._queue.length > 0) ? this._queue[0].time : Infinity;
    }
  }
  if (this._queue.length > 0) {
    this._nextQueueTime = this._queue[0].time;
  } else {
    this._nextQueueTime = Infinity;
  }
  // Disconnect notes from the cleanup set.
  for (j = 0; j < this._cleanupSet.length; ++j) {
    if (this._cleanupSet[j].cleanuptime < now) {
      if (this._cleanupSet[j].g) {
        // This explicit disconnect is needed or else Chrome's WebAudio
        // starts getting overloaded after a couple thousand notes.
        this._cleanupSet[j].g.disconnect();
        this._cleanupSet[j].g = null;
      }
      this._cleanupSet.splice(j, 1);
      j -= 1;
    }
  }
  // Notify about any stems finishing.
  for (j = 0; j < this._finishSet.length; ++j) {
    when = this._finishSet[j].time + this._finishSet[j].duration;
    if (when <= now) {
      this._trigger('notefinish', this._finishSet[j]);
      this._cleanupSet.push(this._finishSet[j]);
      this._finishSet.splice(j, 1);
      j -= 1;
    }
  }
  // Call any specific one-time callbacks that were registered.
  for (j = 0; j < this._callbackSet.length; ++j) {
    if (this._callbackSet[j].time <= now) {
      this._callbackSet[j].callback();
      this._callbackSet.splice(j, 1);
      j -= 1;
    }
  }
  // Notify about any stems starting.
  for (j = 0; j < this._startSet.length; ++j) {
    if (this._startSet[j].time <= now) {
      this._trigger('notestart', this._startSet[j]);
      this._finishSet.push(this._startSet[j]);
      this._startSet.splice(j, 1);
      j -= 1;
    }
  }
  this._startPollTimer();
}
Instrument.prototype._startPollTimer = function(soon) {
  var instrument = this,
      earliest = Infinity, j, delay;
  if (this._pollTimer) {
    if (this._now != null) {
      // We have already set the poll timer to come back instantly.
      return;
    }
    // We might have updated information: clear the timer and look again.
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
  }
  if (soon) {
    // Timer due to now() call: schedule immediately.
    earliest = 0;
  } else {
    // Timer due to _doPoll complete: compute schedule.
    for (j = 0; j < this._startSet.length; ++j) {
      earliest = Math.min(earliest, this._startSet[j].time);
    }
    for (j = 0; j < this._finishSet.length; ++j) {
      earliest = Math.min(
        earliest, this._finishSet[j].time + this._finishSet[j].duration);
    }
    // subtract a little time.
    earliest = Math.min(earliest, this._minQueueTime - 1);
  }
  delay = Math.max(0, earliest - this._atop.ac.currentTime);
  if (isNaN(delay)) {
    return;
  }
  if (delay == Infinity) { return; }
  this._pollTimer = setTimeout(
      function() { instrument._doPoll(); }, delay * 1000);
}
Instrument.prototype.tone = function(pitch, velocity, duration, delay, timbre) {
  var midi, frequency;
  if (!pitch) { pitch = 'C'; }
  if (isNaN(pitch)) {
    midi = pitchToMidi(pitch);
    frequency = midiToFrequency(midi);
  } else {
    frequency = Number(pitch);
    if (frequency < 0) {
      midi = -frequency;
      frequency = midiToFrequency(midi);
    } else {
      midi = frequencyToMidi(frequency);
    }
  }
  var ac = this._atop.ac,
      now = this.now(),
      time = now + (delay || 0),
      record = {
        time: time,
        on: false,
        frequency: frequency,
        midi: midi,
        velocity: (velocity == null ? 1 : velocity),
        duration: (duration == null ? Instrument.toneLength : duration),
        timbre: timbre,
        instrument: this,
        g: null,
        cleanuptime: Infinity
      };
  if (time < now + Instrument.bufferSecs) {
    this._makeNoteSound(record);
  } else {
    if (!this._unsortedQueue && this._queue.length &&
        time < this._queue[this._queue.length -1].time) {
      this._unsortedQueue = true;
    }
    this._queue.push(record);
    this._minQueueTime = Math.min(this._minQueueTime, record.time);

  }
  return { release: makeRecordRelease(this, record) };
}
Instrument.prototype.schedule = function(delay, callback) {
  this._callbackSet.push({ time: this.now() + delay, callback: callback });
}
Instrument.prototype.play = function(abcstring) {
  var args = Array.prototype.slice.call(arguments),
      done = null,
      opts = {},
      abcfile, argindex, tempo, timbre, k, delay, maxdelay = 0, attenuate,
      voicename, stems, ni, j, stem, note, beatsecs, secs, files = [];
  if (args.length && $.isFunction(args[args.length - 1])) {
    done = args.pop();
  }
  argindex = 0;
  if ($.isPlainObject(args[0])) {
    $.extend(opts, args[0]);
    argindex = 1;
  }
  for (; argindex < args.length; ++argindex) {
    abcfile = parseABCFile(args[argindex]);
    console.log(abcfile);
    if (!abcfile) continue;
    if (!opts.tempo && abcfile.tempo) {
      opts.tempo = abcfile.tempo;
      if (abcfile.unitbeat) {
        opts.tempo *= abcfile.unitbeat / (abcfile.unitnote || 1);
      }
    }
    if (!abcfile.voice) continue;
    files.push(abcfile);
  }
  if (!opts.tempo) { opts.tempo = 120; }
  beatsecs = 60.0 / opts.tempo;
  for (k = 0; k < files.length; ++k) {
    abcfile = files[k];
    for (vn in abcfile.voice) if (abcfile.voice.hasOwnProperty(vn)) {
      timbre = opts.timbre || abcfile.voice[vn].timbre ||
         abcfile.timbre || this._timbre;
      stems = abcfile.voice[vn].stems;
      delay = 0;
      for (ni = 0; ni < stems.length; ++ni) {
        stem = stems[ni];
        // Attenuate chords to reduce clipping.
        attenuate = 1 / Math.sqrt(stem.note.length);
        attenuate = 1 / stem.note.length;
        for (j = 0; j < stem.note.length; ++j) {
          note = stem.note[j];
          if (note.holdover) {
            // Skip holdover stems.
            continue;
          }
          secs = (note.time || stem.time) * beatsecs;
          if (stem.staccato) {
            secs = Math.min(Math.min(secs, beatsecs / 16), timbre.a + timbre.d);
          }
          this.tone(
            note.pitch,
            note.velocity || attenuate,
            secs,
            delay,
            timbre);
        }
        delay += stem.time * beatsecs;
      }
      maxdelay = Math.max(delay, maxdelay);
    }
  }
  this._maxScheduledTime =
      Math.max(this._maxScheduledTime, this.now() + maxdelay);
  if (done) {
    this.schedule(maxdelay, done);
  }
}

window.Instrument = Instrument;
})(jQuery);
