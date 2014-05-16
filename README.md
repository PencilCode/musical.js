sequencer.js
============

sequencer.js: a sequencing WebAudio synthesizer that supports ABC notation.

Designed for use by jQuery-turtle.

API:

<pre>
piano = new Instrument();

// Play a single note.
r = piano.tone('C')

// Whenever we like, release the note.
setTimeout(function() { r.release(); }, Math.random() * 1000);

// Play "Mary Had a Little Lamb"
piano.play("AGFG|AAA2|GGG2|AAA2|AGFG|AAAA|GGAG|F4|", whendone)

function whendone() {
  // Do this after Mary is done.
  // Play "Stairway", which picks out a few chords.
  g = new Instrument();
  g.play("F^Gcf|[gE]c^G|g[^g^D]c|^G^g[dD]|" +
         "^AFd|[^C=c]^GF|^G21/3c^GF|[G^DG,][F,F^G][^GFF,]2");

}
</pre>

