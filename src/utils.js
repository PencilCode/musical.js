var makeWavetable = require('./wavetable-builder');

// Tests for the presence of HTML5 Web Audio (or webkit's version).
module.exports.isAudioPresent = isAudioPresent = function() {
  return !!(global.AudioContext || global.webkitAudioContext);
}

// All our audio funnels through the same AudioContext with a
// DynamicsCompressorNode used as the main output, to compress the
// dynamic range of all audio.  getAudioTop sets this up.
module.exports.getAudioTop = getAudioTop = function() {
  if (getAudioTop.audioTop) { return getAudioTop.audioTop; }
  if (!isAudioPresent()) {
    return null;
  }
  var ac = new (global.AudioContext || global.webkitAudioContext);
  getAudioTop.audioTop = {
    ac: ac,
    wavetable: makeWavetable(ac),
    out: null,
    currentStart: null
  };
  resetAudio();
  return getAudioTop.audioTop;
}

// When audio needs to be interrupted globally (e.g., when you press the
// stop button in the IDE), resetAudio does the job.
function resetAudio() {
  if (getAudioTop.audioTop) {
    var atop = getAudioTop.audioTop;
    // Disconnect the top-level node and make a new one.
    if (atop.out) {
      atop.out.disconnect();
      atop.out = null;
      atop.currentStart = null;
    }
    var dcn = atop.ac.createDynamicsCompressor();
    dcn.ratio = 16;
    dcn.attack = 0.0005;
    dcn.connect(atop.ac.destination);
    atop.out = dcn;
  }
}

// For precise scheduling of future notes, the AudioContext currentTime is
// cached and is held constant until the script releases to the event loop.
module.exports.audioCurrentStartTime = audioCurrentStartTime = function() {
  var atop = getAudioTop();
  if (atop.currentStart != null) {
    return atop.currentStart;
  }
  // A delay could be added below to introduce a universal delay in
  // all beginning sounds (without skewing durations for scheduled
  // sequences).
  atop.currentStart = Math.max(0.25, atop.ac.currentTime /* + 0.0 delay */);
  setTimeout(function() { atop.currentStart = null; }, 0);
  return atop.currentStart;
}

// Converts a midi note number to a frequency in Hz.
module.exports.midiToFrequency = midiToFrequency = function(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
// Some constants.
var noteNum =
    {C:0,D:2,E:4,F:5,G:7,A:9,B:11,c:12,d:14,e:16,f:17,g:19,a:21,b:23};
var accSym =
    { '^':1, '': 0, '=':0, '_':-1 };
var noteName =
    ['C', '^C', 'D', '_E', 'E', 'F', '^F', 'G', '_A', 'A', '_B', 'B',
     'c', '^c', 'd', '_e', 'e', 'f', '^f', 'g', '_a', 'a', '_b', 'b'];
// Converts a frequency in Hz to the closest midi number.
function frequencyToMidi(freq) {
  return Math.round(69 + Math.log(freq / 440) * 12 / Math.LN2);
}
// Converts an ABC pitch (such as "^G,,") to a midi note number.
module.exports.pitchToMidi = pitchToMidi = function(pitch) {
  var m = /^(\^+|_+|=|)([A-Ga-g])([,']*)$/.exec(pitch);
  if (!m) { return null; }
  var octave = m[3].replace(/,/g, '').length - m[3].replace(/'/g, '').length;
  var semitone =
      noteNum[m[2]] + accSym[m[1].charAt(0)] * m[1].length + 12 * octave;
  return semitone + 60; // 60 = midi code middle "C".
}
// Converts a midi number to an ABC notation pitch.
module.exports.midiToPitch = function(midi) {
  var index = ((midi - 72) % 12);
  if (midi > 60 || index != 0) { index += 12; }
  var octaves = Math.round((midi - index - 60) / 12),
      result = noteName[index];
  while (octaves != 0) {
    result += octaves > 0 ? "'" : ",";
    octaves += octaves > 0 ? -1 : 1;
  }
  return result;
}
// Converts an ABC pitch to a frequency in Hz.
module.exports.pitchToFrequency = pitchToFrequency = function(pitch) {
  return midiToFrequency(pitchToMidi(pitch));
}

// The default sound is a square wave with a pretty quick decay to zero.
module.exports.defaultTimbre = defaultTimbre= {
  wave: 'square',   // Oscillator type.
  gain: 0.1,        // Overall gain at maximum attack.
  attack: 0.002,    // Attack time at the beginning of a tone.
  decay: 0.4,       // Rate of exponential decay after attack.
  decayfollow: 0,   // Amount of decay shortening for higher notes.
  sustain: 0,       // Portion of gain to sustain indefinitely.
  release: 0.1,     // Release time after a tone is done.
  cutoff: 0,        // Low-pass filter cutoff frequency.
  cutfollow: 0,     // Cutoff adjustment, a multiple of oscillator freq.
  resonance: 0,     // Low-pass filter resonance.
  detune: 0         // Detune factor for a second oscillator.
};

// Norrmalizes a timbre object by making a copy that has exactly
// the right set of timbre fields, defaulting when needed.
// A timbre can specify any of the fields of defaultTimbre; any
// unspecified fields are treated as they are set in defaultTimbre.
module.exports.makeTimbre = function(options, atop) {
  if (!options) {
    options = {};
  }
  if (typeof(options) == 'string') {
    // Abbreviation: name a wave to get a default timbre for that wave.
    options = { wave: options };
  }
  var result = {}, key,
      wt = atop && atop.wavetable && atop.wavetable[options.wave];
  for (key in defaultTimbre) {
    if (options.hasOwnProperty(key)) {
      result[key] = options[key];
    } else if (wt && wt.defs && wt.defs.hasOwnProperty(key)) {
      result[key] = wt.defs[key];
    } else{
      result[key] = defaultTimbre[key];
    }
  }
  return result;
}

var whiteNoiseBuf = null; // cache
function getWhiteNoiseBuf() {
  if (whiteNoiseBuf == null) {
    var ac = getAudioTop().ac,
        bufferSize = 2 * ac.sampleRate,
        whiteNoiseBuf = ac.createBuffer(1, bufferSize, ac.sampleRate),
        output = whiteNoiseBuf.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
  }
  return whiteNoiseBuf;
}

// This utility function creates an oscillator at the given frequency
// and the given wavename.  It supports lookups in a static wavetable,
// defined right below.
module.exports.makeOscillator = makeOscillator = function(atop, wavename, freq) {
  if (wavename == 'noise') {
    var whiteNoise = atop.ac.createBufferSource();
    whiteNoise.buffer = getWhiteNoiseBuf();
    whiteNoise.loop = true;
    return whiteNoise;
  }
  var wavetable = atop.wavetable, o = atop.ac.createOscillator(),
      k, pwave, bwf, wf;
  try {
    if (wavetable.hasOwnProperty(wavename)) {
      // Use a customized wavetable.
      pwave = wavetable[wavename].wave;
      if (wavetable[wavename].freq) {
        bwf = 0;
        // Look for a higher-frequency variant.
        for (k in wavetable[wavename].freq) {
          wf = Number(k);
          if (freq > wf && wf > bwf) {
            bwf = wf;
            pwave = wavetable[wavename].freq[bwf];
          }
        }
      }
      if (!o.setPeriodicWave && o.setWaveTable) {
        // The old API name: Safari 7 still uses this.
        o.setWaveTable(pwave);
      } else {
        // The new API name.
        o.setPeriodicWave(pwave);
      }
    } else {
      o.type = wavename;
    }
  } catch(e) {
    if (window.console) { window.console.log(e); }
    // If unrecognized, just use square.
    // TODO: support "noise" or other wave shapes.
    o.type = 'square';
  }
  o.frequency.value = freq;
  return o;
}
