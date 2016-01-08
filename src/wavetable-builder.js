// wavetable is a table of names for nonstandard waveforms.
// The table maps names to objects that have wave: and freq:
// properties. The wave: property is a PeriodicWave to use
// for the oscillator.  The freq: property, if present,
// is a map from higher frequencies to more PeriodicWave
// objects; when a frequency higher than the given threshold
// is requested, the alternate PeriodicWave is used.

module.exports = function(ac) {
  return (function(wavedata) {
    function makePeriodicWave(data) {
      var n = data.real.length,
          real = new Float32Array(n),
          imag = new Float32Array(n),
          j;
      for (j = 0; j < n; ++j) {
        real[j] = data.real[j];
        imag[j] = data.imag[j];
      }
      try {
        // Latest API naming.
        return ac.createPeriodicWave(real, imag);
      } catch (e) { }
      try {
        // Earlier API naming.
        return ac.createWaveTable(real, imag);
      } catch (e) { }
      return null;
    }
    function makeMultiple(data, mult, amt) {
      var result = { real: [], imag: [] }, j, n = data.real.length, m;
      for (j = 0; j < n; ++j) {
        m = Math.log(mult[Math.min(j, mult.length - 1)]);
        result.real.push(data.real[j] * Math.exp(amt * m));
        result.imag.push(data.imag[j] * Math.exp(amt * m));
      }
      return result;
    }
    var result = {}, k, d, n, j, ff, record, wave, pw;
    for (k in wavedata) {
      d = wavedata[k];
      wave = makePeriodicWave(d);
      if (!wave) { continue; }
      record = { wave: wave };
      // A strategy for computing higher frequency waveforms: apply
      // multipliers to each harmonic according to d.mult.  These
      // multipliers can be interpolated and applied at any number
      // of transition frequencies.
      if (d.mult) {
        ff = wavedata[k].freq;
        record.freq = {};
        for (j = 0; j < ff.length; ++j) {
          wave =
            makePeriodicWave(makeMultiple(d, d.mult, (j + 1) / ff.length));
          if (wave) { record.freq[ff[j]] = wave; }
        }
      }
      // This wave has some default filter settings.
      if (d.defs) {
        record.defs = d.defs;
      }
      result[k] = record;
    }
    return result;
  })({
    // Currently the only nonstandard waveform is "piano".
    // It is based on the first 32 harmonics from the example:
    // https://github.com/GoogleChrome/web-audio-samples
    // /blob/gh-pages/samples/audio/wave-tables/Piano
    // That is a terrific sound for the lowest piano tones.
    // For higher tones, interpolate to a customzed wave
    // shape created by hand, and apply a lowpass filter.
    piano: {
      real: [0, 0, -0.203569, 0.5, -0.401676, 0.137128, -0.104117, 0.115965,
             -0.004413, 0.067884, -0.00888, 0.0793, -0.038756, 0.011882,
             -0.030883, 0.027608, -0.013429, 0.00393, -0.014029, 0.00972,
             -0.007653, 0.007866, -0.032029, 0.046127, -0.024155, 0.023095,
             -0.005522, 0.004511, -0.003593, 0.011248, -0.004919, 0.008505],
      imag: [0, 0.147621, 0, 0.000007, -0.00001, 0.000005, -0.000006, 0.000009,
             0, 0.000008, -0.000001, 0.000014, -0.000008, 0.000003,
             -0.000009, 0.000009, -0.000005, 0.000002, -0.000007, 0.000005,
             -0.000005, 0.000005, -0.000023, 0.000037, -0.000021, 0.000022,
             -0.000006, 0.000005, -0.000004, 0.000014, -0.000007, 0.000012],
      // How to adjust the harmonics for the higest notes.
      mult: [1, 1, 0.18, 0.016, 0.01, 0.01, 0.01, 0.004,
                0.014, 0.02, 0.014, 0.004, 0.002, 0.00001],
      // The frequencies at which to interpolate the harmonics.
      freq: [65, 80, 100, 135, 180, 240, 620, 1360],
      // The default filter settings to use for the piano wave.
      // TODO: this approach attenuates low notes too much -
      // this should be fixed.
      defs: { wave: 'piano', gain: 0.5,
              attack: 0.002, decay: 0.25, sustain: 0.03, release: 0.1,
              decayfollow: 0.7,
              cutoff: 800, cutfollow: 0.1, resonance: 1, detune: 0.9994 }
    }
  });
}
