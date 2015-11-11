var Instrument = require('./instrument');
var parseABCFile = require('./parser-abc');

// The package implementation. Right now, just one class.
module.exports = {
  Instrument: Instrument,
  parseABCFile: parseABCFile
}
