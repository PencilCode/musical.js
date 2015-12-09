// All further details of audio handling are encapsulated in the Instrument
// class, which knows how to synthesize a basic timbre; how to play and
// schedule a tone; and how to parse and sequence a song written in ABC
// notation.

// The constructor accepts a timbre string or object, specifying
// its default sound.  The main mechanisms in Instrument are for handling
// sequencing of a (potentially large) set of notes over a (potentially
// long) period of time.  The overall strategy:
//
//                       Events:      'noteon'        'noteoff'
//                                      |               |
// tone()-(quick tones)->| _startSet -->| _finishSet -->| _cleanupSet -->|
//   \                   |  /           | Playing tones | Done tones     |
//    \---- _queue ------|-/                                             |
//      of future tones  |3 secs ahead sent to WebAudio, removed when done
//
// The reason for this queuing is to reduce the complexity of the
// node graph sent to WebAudio: at any time, WebAudio is only
// responsible for about 2 seconds of music.  If a graph with too
// too many nodes is sent to WebAudio at once, output distorts badly.

var utils = require('./utils');
var getAudioTop = utils.getAudioTop;
var makeTimbre = utils.makeTimbre;
var isAudioPresent = utils.isAudioPresent;
var defaultTimbre = utils.defaultTimbre;
var pitchToMidi = utils.pitchToMidi;
var midiToFrequency = utils.midiToFrequency;
var audioCurrentStartTime = utils.audioCurrentStartTime;
var makeOscillator = utils.makeOscillator;
var midiToPitch = utils.midiToPitch;
var parseABCFile = require('./parser-abc');

function Instrument(options) {
  this._atop = getAudioTop();    // Audio context.
  this._timbre = makeTimbre(options, this._atop); // The instrument's timbre.
  this._queue = [];              // A queue of future tones to play.
  this._minQueueTime = Infinity; // The earliest time in _queue.
  this._maxScheduledTime = 0;    // The latest time in _queue.
  this._unsortedQueue = false;   // True if _queue is unsorted.
  this._startSet = [];           // Unstarted tones already sent to WebAudio.
  this._finishSet = {};          // Started tones playing in WebAudio.
  this._cleanupSet = [];         // Tones waiting for cleanup.
  this._callbackSet = [];        // A set of scheduled callbacks.
  this._handlers = {};           // 'noteon' and 'noteoff' handlers.
  this._now = null;              // A cached current-time value.
  if (isAudioPresent()) {
    this.silence();              // Initializes top-level audio node.
  }
}

Instrument.timeOffset = 0.0625;// Seconds to delay all audiable timing.
Instrument.dequeueTime = 0.5;  // Seconds before an event to reexamine queue.
Instrument.bufferSecs = 2;     // Seconds ahead to put notes in WebAudio.
Instrument.toneLength = 1;     // Default duration of a tone.
Instrument.cleanupDelay = 0.1; // Silent time before disconnecting nodes.

// Sets the default timbre for the instrument.  See defaultTimbre.
Instrument.prototype.setTimbre = function(t) {
  this._timbre = makeTimbre(t, this._atop);     // Saves a copy.
};

// Returns the default timbre for the instrument as an object.
Instrument.prototype.getTimbre = function(t) {
  return makeTimbre(this._timbre, this._atop);  // Makes a copy.
};

// Sets the overall volume for the instrument immediately.
Instrument.prototype.setVolume = function(v) {
  // Without an audio system, volume cannot be set.
  if (!this._out) { return; }
  if (!isNaN(v)) {
    this._out.gain.value = v;
  }
};

// Sets the overall volume for the instrument.
Instrument.prototype.getVolume = function(v) {
  // Without an audio system, volume is stuck at zero.
  if (!this._out) { return 0.0; }
  return this._out.gain.value;
};

// Silences the instrument immediately by reinitializing the audio
// graph for this instrument and emptying or flushing all queues in the
// scheduler.  Carefully notifies all notes that have started but not
// yet finished, and sequences that are awaiting scheduled callbacks.
// Does not notify notes that have not yet started.
Instrument.prototype.silence = function() {
  var j, finished, callbacks, initvolume = 1;

  // Clear future notes.
  this._queue.length = 0;
  this._minQueueTime = Infinity;
  this._maxScheduledTime = 0;

  // Don't notify notes that haven't started yet.
  this._startSet.length = 0;

  // Flush finish callbacks that are promised.
  finished = this._finishSet;
  this._finishSet = {};

  // Flush one-time callacks that are promised.
  callbacks = this._callbackSet;
  this._callbackSet = [];

  // Disconnect the audio graph for this instrument.
  if (this._out) {
    this._out.disconnect();
    initvolume = this._out.gain.value;
  }

  // Reinitialize the audio graph: all audio for the instrument
  // multiplexes through a single gain node with a master volume.
  this._atop = getAudioTop();
  this._out = this._atop.ac.createGain();
  this._out.gain.value = initvolume;
  this._out.connect(this._atop.out);

  // As a last step, call all promised notifications.
  for (j in finished) { this._trigger('noteoff', finished[j]); }
  for (j = 0; j < callbacks.length; ++j) { callbacks[j].callback(); }
};

// Future notes are scheduled relative to now(), which provides
// access to audioCurrentStartTime(), a time that holds steady
// until the script releases to the event loop.  When _now is
// non-null, it indicates that scheduling is already in progress.
// The timer-driven _doPoll function clears the cached _now.
Instrument.prototype.now = function() {
  if (this._now != null) {
    return this._now;
  }
  this._startPollTimer(true);  // passing (true) sets this._now.
  return this._now;
};

// Register an event handler.  Done without jQuery to reduce dependencies.
Instrument.prototype.on = function(eventname, cb) {
  if (!this._handlers.hasOwnProperty(eventname)) {
    this._handlers[eventname] = [];
  }
  this._handlers[eventname].push(cb);
};

// Unregister an event handler.  Done without jQuery to reduce dependencies.
Instrument.prototype.off = function(eventname, cb) {
  if (this._handlers.hasOwnProperty(eventname)) {
    if (!cb) {
      this._handlers[eventname] = [];
    } else {
      var j, hunt = this._handlers[eventname];
      for (j = 0; j < hunt.length; ++j) {
        if (hunt[j] === cb) {
          hunt.splice(j, 1);
          j -= 1;
        }
      }
    }
  }
};

// Trigger an event, notifying any registered handlers.
Instrument.prototype._trigger = function(eventname, record) {
  var cb = this._handlers[eventname], j;
  if (!cb) { return; }
  if (cb.length == 1) {
    // Special, common case of one handler: no copy needed.
    cb[0](record);
    return;
  }
  // Copy the array of callbacks before iterating, because the
  // main this._handlers copy could be changed by a handler.
  // You get notified if-and-only-if you are registered
  // at the starting moment of _trigger.
  cb = cb.slice();
  for (j = 0; j < cb.length; ++j) {
    cb[j](record);
  }
};

// Tells the WebAudio API to play a tone (now or soon).  The passed
// record specifies a start time and release time, an ADSR envelope,
// and other timbre parameters.  This function sets up a WebAudio
// node graph for the tone generators and filters for the tone.
Instrument.prototype._makeSound = function(record) {
  var timbre = record.timbre || this._timbre,
      starttime = record.time + Instrument.timeOffset,
      releasetime = starttime + record.duration,
      attacktime = Math.min(releasetime, starttime + timbre.attack),
      decaytime = timbre.decay *
          Math.pow(440 / record.frequency, timbre.decayfollow),
      decaystarttime = attacktime,
      stoptime = releasetime + timbre.release,
      doubled = timbre.detune && timbre.detune != 1.0,
      amp = timbre.gain * record.velocity * (doubled ? 0.5 : 1.0),
      ac = this._atop.ac,
      g, f, o, o2, pwave, k, wf, bwf;
  // Only hook up tone generators if it is an audible sound.
  if (record.duration > 0 && record.velocity > 0) {
    g = ac.createGain();
    g.gain.setValueAtTime(0, starttime);
    g.gain.linearRampToValueAtTime(amp, attacktime);
    // For the beginning of the decay, use linearRampToValue instead
    // of setTargetAtTime, because it avoids http://crbug.com/254942.
    while (decaystarttime < attacktime + 1/32 &&
           decaystarttime + 1/256 < releasetime) {
      // Just trace out the curve in increments of 1/256 sec
      // for up to 1/32 seconds.
      decaystarttime += 1/256;
      g.gain.linearRampToValueAtTime(
          amp * (timbre.sustain + (1 - timbre.sustain) *
              Math.exp((attacktime - decaystarttime) / decaytime)),
          decaystarttime);
    }
    // For the rest of the decay, use setTargetAtTime.
    g.gain.setTargetAtTime(amp * timbre.sustain,
        decaystarttime, decaytime);
    // Then at release time, mark the value and ramp to zero.
    g.gain.setValueAtTime(amp * (timbre.sustain + (1 - timbre.sustain) *
        Math.exp((attacktime - releasetime) / decaytime)), releasetime);
    g.gain.linearRampToValueAtTime(0, stoptime);
    g.connect(this._out);
    // Hook up a low-pass filter if cutoff is specified.
    if ((!timbre.cutoff && !timbre.cutfollow) || timbre.cutoff == Infinity) {
      f = g;
    } else {
      // Apply the cutoff frequency adjusted using cutfollow.
      f = ac.createBiquadFilter();
      f.frequency.value =
          timbre.cutoff + record.frequency * timbre.cutfollow;
      f.Q.value = timbre.resonance;
      f.connect(g);
    }
    // Hook up the main oscillator.
    o = makeOscillator(this._atop, timbre.wave, record.frequency);
    o.connect(f);
    o.start(starttime);
    o.stop(stoptime);
    // Hook up a detuned oscillator.
    if (doubled) {
      o2 = makeOscillator(
          this._atop, timbre.wave, record.frequency * timbre.detune);
      o2.connect(f);
      o2.start(starttime);
      o2.stop(stoptime);
    }
    // Store nodes in the record so that they can be modified
    // in case the tone is truncated later.
    record.gainNode = g;
    record.oscillators = [o];
    if (doubled) { record.oscillators.push(o2); }
    record.cleanuptime = stoptime;
  } else {
    // Inaudible sounds are scheduled: their purpose is to truncate
    // audible tones at the same pitch.  But duration is set to zero
    // so that they are cleaned up quickly.
    record.duration = 0;
  }
  this._startSet.push(record);
};
// Truncates a sound previously scheduled by _makeSound by using
// cancelScheduledValues and directly ramping down to zero.
// Can only be used to shorten a sound.
Instrument.prototype._truncateSound = function(record, truncatetime) {
  if (truncatetime < record.time + record.duration) {
    record.duration = Math.max(0, truncatetime - record.time);
    if (record.gainNode) {
      var timbre = record.timbre || this._timbre,
          starttime = record.time + Instrument.timeOffset,
          releasetime = truncatetime + Instrument.timeOffset,
          attacktime = Math.min(releasetime, starttime + timbre.attack),
          decaytime = timbre.decay *
              Math.pow(440 / record.frequency, timbre.decayfollow),
          stoptime = releasetime + timbre.release,
          cleanuptime = stoptime + Instrument.cleanupDelay,
          doubled = timbre.detune && timbre.detune != 1.0,
          amp = timbre.gain * record.velocity * (doubled ? 0.5 : 1.0),
          j, g = record.gainNode;
      // Cancel any envelope points after the new releasetime.
      g.gain.cancelScheduledValues(releasetime);
      if (releasetime <= starttime) {
        // Release before start?  Totally silence the note.
        g.gain.setValueAtTime(0, releasetime);
      } else if (releasetime <= attacktime) {
        // Release before attack is done?  Interrupt ramp up.
        g.gain.linearRampToValueAtTime(
          amp * (releasetime - starttime) / (attacktime - starttime));
      } else {
        // Release during decay?  Interrupt decay down.
        g.gain.setValueAtTime(amp * (timbre.sustain + (1 - timbre.sustain) *
          Math.exp((attacktime - releasetime) / decaytime)), releasetime);
      }
      // Then ramp down to zero according to record.release.
      g.gain.linearRampToValueAtTime(0, stoptime);
      // After stoptime, stop the oscillators.  This is necessary to
      // eliminate extra work for WebAudio for no-longer-audible notes.
      if (record.oscillators) {
        for (j = 0; j < record.oscillators.length; ++j) {
          record.oscillators[j].stop(stoptime);
        }
      }
      // Schedule disconnect.
      record.cleanuptime = cleanuptime;
    }
  }
};
// The core scheduling loop is managed by Instrument._doPoll.  It reads
// the audiocontext's current time and pushes tone records from one
// stage to the next.
//
// 1. The first stage is the _queue, which has tones that have not
//    yet been given to WebAudio. This loop scans _queue to find
//    notes that need to begin in the next few seconds; then it
//    sends those to WebAduio and moves them to _startSet. Because
//    scheduled songs can be long, _queue can be large.
//
// 2. Second is _startSet, which has tones that have been given to
//    WebAudio, but whose start times have not yet elapsed. When
//    the time advances past the start time of a record, a 'noteon'
//    notification is fired for the tone, and it is moved to
//    _finishSet.
//
// 3. _finishSet represents the notes that are currently sounding.
//    The programming model for Instrument is that only one tone of
//    a specific frequency may be played at once within a Instrument,
//    so only one tone of a given frequency may exist in _finishSet
//    at once.  When there is a conflict, the sooner-to-end-note
//    is truncated.
//
// 4. After a note is released, it may have a litle release time
//    (depending on timbre.release), after which the nodes can
//    be totally disconnected and cleaned up.  _cleanupSet holds
//    notes for which we are awaiting cleanup.
Instrument.prototype._doPoll = function() {
  this._pollTimer = null;
  this._now = null;
  if (window.interrupted) {
    this.silence();
    return;
  }
  // The shortest time we can delay is 1 / 1000 secs, so if an event
  // is within the next 0.5 ms, now is the closest moment, and we go
  // ahead and process it.
  var instant = this._atop.ac.currentTime + (1 / 2000),
      callbacks = [],
      j, work, when, freq, record, conflict, save, cb;
  // Schedule a batch of notes
  if (this._minQueueTime - instant <= Instrument.bufferSecs) {
    if (this._unsortedQueue) {
      this._queue.sort(function(a, b) {
        if (a.time != b.time) { return a.time - b.time; }
        if (a.duration != b.duration) { return a.duration - b.duration; }
        return a.frequency - b.frequency;
      });
      this._unsortedQueue = false;
    }
    for (j = 0; j < this._queue.length; ++j) {
      if (this._queue[j].time - instant > Instrument.bufferSecs) { break; }
    }
    if (j > 0) {
      work = this._queue.splice(0, j);
      for (j = 0; j < work.length; ++j) {
        this._makeSound(work[j]);
      }
      this._minQueueTime =
        (this._queue.length > 0) ? this._queue[0].time : Infinity;
    }
  }
  // Disconnect notes from the cleanup set.
  for (j = 0; j < this._cleanupSet.length; ++j) {
    record = this._cleanupSet[j];
    if (record.cleanuptime < instant) {
      if (record.gainNode) {
        // This explicit disconnect is needed or else Chrome's WebAudio
        // starts getting overloaded after a couple thousand notes.
        record.gainNode.disconnect();
        record.gainNode = null;
      }
      this._cleanupSet.splice(j, 1);
      j -= 1;
    }
  }
  // Notify about any notes finishing.
  for (freq in this._finishSet) {
    record = this._finishSet[freq];
    when = record.time + record.duration;
    if (when <= instant) {
      callbacks.push({
        order: [when, 0],
        f: this._trigger, t: this, a: ['noteoff', record]});
      if (record.cleanuptime != Infinity) {
        this._cleanupSet.push(record);
      }
      delete this._finishSet[freq];
    }
  }
  // Call any specific one-time callbacks that were registered.
  for (j = 0; j < this._callbackSet.length; ++j) {
    cb = this._callbackSet[j];
    when = cb.time;
    if (when <= instant) {
      callbacks.push({
        order: [when, 1],
        f: cb.callback, t: null, a: []});
      this._callbackSet.splice(j, 1);
      j -= 1;
    }
  }
  // Notify about any notes starting.
  for (j = 0; j < this._startSet.length; ++j) {
    if (this._startSet[j].time <= instant) {
      save = record = this._startSet[j];
      freq = record.frequency;
      conflict = null;
      if (this._finishSet.hasOwnProperty(freq)) {
        // If there is already a note at the same frequency playing,
        // then release the one that starts first, immediately.
        conflict = this._finishSet[freq];
        if (conflict.time < record.time || (conflict.time == record.time &&
            conflict.duration < record.duration)) {
          // Our new sound conflicts with an old one: end the old one
          // and notify immediately of its noteoff event.
          this._truncateSound(conflict, record.time);
          callbacks.push({
            order: [record.time, 0],
            f: this._trigger, t: this, a: ['noteoff', conflict]});
          delete this._finishSet[freq];
        } else {
          // A conflict from the future has already scheduled,
          // so our own note shouldn't sound.  Truncate ourselves
          // immediately, and suppress our own noteon and noteoff.
          this._truncateSound(record, conflict.time);
          conflict = record;
        }
      }
      this._startSet.splice(j, 1);
      j -= 1;
      if (record.duration > 0 && record.velocity > 0 &&
          conflict !== record) {
        this._finishSet[freq] = record;
        callbacks.push({
          order: [record.time, 2],
          f: this._trigger, t: this, a: ['noteon', record]});
      }
    }
  }
  // Schedule the next _doPoll.
  this._startPollTimer();

  // Sort callbacks according to the "order" tuple, so earlier events
  // are notified first.
  callbacks.sort(function(a, b) {
    if (a.order[0] != b.order[0]) { return a.order[0] - b.order[0]; }
    // tiebreak by notifying 'noteoff' first and 'noteon' last.
    return a.order[1] - b.order[1];
  });
  // At the end, call all the callbacks without depending on "this" state.
  for (j = 0; j < callbacks.length; ++j) {
    cb = callbacks[j];
    cb.f.apply(cb.t, cb.a);
  }
};
// Schedules the next _doPoll call by examining times in the various
// sets and determining the soonest event that needs _doPoll processing.
Instrument.prototype._startPollTimer = function(setnow) {
  // If we have already done a "setnow", then pollTimer is zero-timeout
  // and cannot be faster.
  if (this._pollTimer && this._now != null) {
    return;
  }
  var self = this,
      poll = function() { self._doPoll(); },
      earliest = Infinity, j, delay;
  if (this._pollTimer) {
    // Clear any old timer
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
  }
  if (setnow) {
    // When scheduling tones, cache _now and keep a zero-timeout poll.
    // _now will be cleared the next time we execute _doPoll.
    this._now = audioCurrentStartTime();
    this._pollTimer = setTimeout(poll, 0);
    return;
  }
  // Timer due to notes starting: wake up for 'noteon' notification.
  for (j = 0; j < this._startSet.length; ++j) {
    earliest = Math.min(earliest, this._startSet[j].time);
  }
  // Timer due to notes finishing: wake up for 'noteoff' notification.
  for (j in this._finishSet) {
    earliest = Math.min(
      earliest, this._finishSet[j].time + this._finishSet[j].duration);
  }
  // Timer due to scheduled callback.
  for (j = 0; j < this._callbackSet.length; ++j) {
    earliest = Math.min(earliest, this._callbackSet[j].time);
  }
  // Timer due to cleanup: add a second to give some time to batch up.
  if (this._cleanupSet.length > 0) {
    earliest = Math.min(earliest, this._cleanupSet[0].cleanuptime + 1);
  }
  // Timer due to sequencer events: subtract a little time to stay ahead.
  earliest = Math.min(
     earliest, this._minQueueTime - Instrument.dequeueTime);

  delay = Math.max(0.001, earliest - this._atop.ac.currentTime);

  // If there are no future events, then we do not need a timer.
  if (isNaN(delay) || delay == Infinity) { return; }

  // Use the Javascript timer to wake up at the right moment.
  this._pollTimer = setTimeout(poll, Math.round(delay * 1000));
};

// The low-level tone function.
Instrument.prototype.tone = function(pitch, duration, velocity, delay, timbre, origin) {
  // If audio is not present, this is a no-op.
  if (!this._atop) { return; }

  // Called with an object instead of listed args.
  if (typeof(pitch) == 'object') {
    if (velocity == null) velocity = pitch.velocity;
    if (duration == null) duration = pitch.duration;
    if (delay == null) delay = pitch.delay;
    if (timbre == null) timbre = pitch.timbre;
    if (origin == null) origin = pitch.origin;
    pitch = pitch.pitch;
  }

  // Convert pitch from various formats to Hz frequency and a midi num.
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

  if (!timbre) {
    timbre = this._timbre;
  }
  // If there is a custom timbre, validate and copy it.
  if (timbre !== this._timbre) {
    var given = timbre, key;
    timbre = {}
    for (key in defaultTimbre) {
      if (key in given) {
        timbre[key] = given[key];
      } else {
        timbre[key] = defaulTimbre[key];
      }
    }
  }

  // Create the record for a tone.
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
        gainNode: null,
        oscillators: null,
        cleanuptime: Infinity,
        origin: origin             // save the origin of the tone for visible feedback
      };

  if (time < now + Instrument.bufferSecs) {
    // The tone starts soon!  Give it directly to WebAudio.
    this._makeSound(record);
  } else {
    // The tone is later: queue it.
    if (!this._unsortedQueue && this._queue.length &&
        time < this._queue[this._queue.length -1].time) {
      this._unsortedQueue = true;
    }
    this._queue.push(record);
    this._minQueueTime = Math.min(this._minQueueTime, record.time);
  }
};
// The low-level callback scheduling method.
Instrument.prototype.schedule = function(delay, callback) {
  this._callbackSet.push({ time: this.now() + delay, callback: callback });
};
// The high-level sequencing method.
Instrument.prototype.play = function(abcstring) {
  var args = Array.prototype.slice.call(arguments),
      done = null,
      opts = {}, subfile,
      abcfile, argindex, tempo, timbre, k, delay, maxdelay = 0, attenuate,
      voicename, stems, ni, vn, j, stem, note, beatsecs, secs, v, files = [];
  // Look for continuation as last argument.
  if (args.length && 'function' == typeof(args[args.length - 1])) {
    done = args.pop();
  }
  if (!this._atop) {
    if (done) { done(); }
    return;
  }
  // Look for options as first object.
  argindex = 0;
  if ('object' == typeof(args[0])) {
    // Copy own properties into an options object.
    for (k in args[0]) if (args[0].hasOwnProperty(k)) {
      opts[k] = args[0][k];
    }
    argindex = 1;
    // If a song is supplied by options object, process it.
    if (opts.song) {
      args.push(opts.song);
    }
  }
  // Parse any number of ABC files as input.
  for (; argindex < args.length; ++argindex) {
    // Handle splitting of ABC subfiles at X: lines.
    subfile = args[argindex].split(/\n(?=X:)/);
    for (k = 0; k < subfile.length; ++k) {
      abcfile = parseABCFile(subfile[k]);
      if (!abcfile) continue;
      // Take tempo markings from the first file, and share them.
      if (!opts.tempo && abcfile.tempo) {
        opts.tempo = abcfile.tempo;
        if (abcfile.unitbeat) {
          opts.tempo *= abcfile.unitbeat / (abcfile.unitnote || 1);
        }
      }
      // Ignore files without songs.
      if (!abcfile.voice) continue;
      files.push(abcfile);
    }
  }
  // Default tempo to 120 if nothing else is specified.
  if (!opts.tempo) { opts.tempo = 120; }
  // Default volume to 1 if nothing is specified.
  if (opts.volume == null) { opts.volume = 1; }
  beatsecs = 60.0 / opts.tempo;
  // Schedule all notes from all the files.
  for (k = 0; k < files.length; ++k) {
    abcfile = files[k];
    // Each file can have multiple voices (e.g., left and right hands)
    for (vn in abcfile.voice) {
      // Each voice could have a separate timbre.
      timbre = makeTimbre(opts.timbre || abcfile.voice[vn].timbre ||
         abcfile.timbre || this._timbre, this._atop);
      // Each voice has a series of stems (notes or chords).
      stems = abcfile.voice[vn].stems;
      if (!stems) continue;
      // Starting at delay zero (now), schedule all tones.
      delay = 0;
      for (ni = 0; ni < stems.length; ++ni) {
        stem = stems[ni];
        // Attenuate chords to reduce clipping.
        attenuate = 1 / Math.sqrt(stem.notes.length);
        // Schedule every note inside a stem.
        for (j = 0; j < stem.notes.length; ++j) {
          note = stem.notes[j];
          if (note.holdover) {
            // Skip holdover notes from ties.
            continue;
          }
          secs = (note.time || stem.time) * beatsecs;
          if (stem.staccato) {
            // Shorten staccato notes.
            secs = Math.min(Math.min(secs, beatsecs / 16),
                timbre.attack + timbre.decay);
          } else if (!note.slurred && secs >= 1/8) {
            // Separate unslurred notes by about a 30th of a second.
            secs -= 1/32;
          }
          v = (note.velocity || 1) * attenuate * opts.volume;
          // This is innsermost part of the inner loop!
          this.tone(                     // Play the tone:
            note.pitch,                  // at the given pitch
            secs,                        // for the given duration
            v,                           // with the given volume
            delay,                       // starting at the proper time
            timbre,                      // with the selected timbre
            note                         // the origin object for visual feedback
            );
        }
        delay += stem.time * beatsecs;   // Advance the sequenced time.
      }
      maxdelay = Math.max(delay, maxdelay);
    }
  }
  this._maxScheduledTime =
      Math.max(this._maxScheduledTime, this.now() + maxdelay);
  if (done) {
    // Schedule a "done" callback after all sequencing is complete.
    this.schedule(maxdelay, done);
  }
};

// Accepts either an ABC pitch or a midi number and converts to midi.
Instrument.pitchToMidi = function(n) {
  if (typeof(n) == 'string') { return pitchToMidi(n); }
  return n;
}

// Accepts either an ABC pitch or a midi number and converts to ABC pitch.
Instrument.midiToPitch = function(n) {
  if (typeof(n) == 'number') { return midiToPitch(n); }
  return n;
}

module.exports = Instrument;
