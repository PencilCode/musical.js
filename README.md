music.js
============

music.js: a sequencing WebAudio synthesizer that supports ABC notation.

Designed for use by jQuery-turtle.

API:

* instrument = new Instrument([timbre]) makes an instrument. Timbre
  is optional and defaults to a boring square wave sound.  Timbre
  may be a WebAudio oscillator wave type ("square", "sine", etc),
  and it may also specify (as object properties or in a CSS-like
  string) gain, attack, decay, sustain, release, cutoff, cutfollow,
  and detune; these allow basic subtractive analog synthesis.
  Timbre can be changed later using instrument.setTimbre.  See an
  example below.

* instrument.tone(frequency [,volume, duration, delay, timbre])
  plays a single tone for a little while.  Frequency may be specified
  as a positive number (in Hz) or a negative integer (a midi note
  number), or a pitch string like '^C,' (ABC notation for a pitch).
  Other arguments are optional: volume defaults to 1, duration
  defaults to 10 seconds, delay defaults to zero (play right now),
  and timbre defaults to null, which applies the instrument's default
  timbre.

* instrument.play(abcnotation) plays a song as expressed in ABC
  notation, as can be found on the web.  See examples below.

<pre>
piano = new Instrument();

// Play a single tone immediately.  Tones may be also specified
// numerically (in Hz), or with midi numbers (as negative integers).
piano.tone('C')

// Whenever we like, release the note.
setTimeout(function() {
  piano.tone('C', false);
  firstsong();
}, Math.random() * 1000);

function firstsong() {
  // Play "Mary Had a Little Lamb"
  piano.play("AGFG|AAA2|GGG2|AAA2|AGFG|AAAA|GGAG|F4|", whendone)
}

// Do this after Mary is done.
function whendone() {
  // Play "Stairway", which picks out a few chords.
  piano.play("F^Gcf|[gE]c^G|g[^g^D]c|^G^g[dD]|" +
             "^AFd|[^C=c]^GF|^G21/3c^GF|[G^DG,][F,F^G][^GFF,]2", whendone2);


// Do this after Stairway is done.
function whendone2() {
  // Change the piano to sound more like a piano.
  piano.setTimbre("wave:sawtooth;gain:2;" +
      "attack:0.001;decay:0.4;sustain:0.005;release:0.1;" +
      "cutoff:100;cutfollow:0.1;detune:1.0013;");
  // Then play a couple bars of a Beethoven Sonata, using ABC notation
  // clipped from the web.  Note support for chords, beats, accidentals,
  // key signatures, meter and tempo markings, ties, and so on.
  piano.play(
    "X:2\n" +
    "T:8th Sonata for piano\n" +
    "%%staves {1 2}\n" +
    "C:L. van Beethoven\n" +
    "M:C\n" +
    "L:1/16\n" +
    "Q:1/8=66\n" +
    "F:http://richardrobinson.tunebook.org.uk/tune/6525\n" +
    "K:Cm\n" +
    "V:1\n" +
    "!fp![E,4G,4C4]- [E,3/G,3/C3/]!3![G,/C/]!4![G,3/=B,3/D3/]!5![G,/C/E/] " +
    "([=A,4C4E4]!4![=B,2D2])z2|\\n" +
    "!fp!!3![=B,4D4F4]- [B,3/D3/F3/][B,/D/F/][B,3/D3/G3/][B,/D/A/] " +
    "([B,4D4A4]!3![C2E2G2])z2|\n" +
    "V:2\n" +
    "[C,,4E,,4G,,4C,4]- [C,,3/E,,3/G,,3/C,3/]!2!E,/!3!D,3/!4!C,/ " +
    "(!2!^F,4G,2)z _A,,|\\n" +
    "_A,4-A,3/!2!A,/!1!G,3/=F,/ E,4-E,2z2|\n"
  );
}
</pre>

