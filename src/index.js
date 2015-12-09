var Instrument = require('./instrument');
var parseABCFile = require('./parser-abc');

// backward compability
window.Instrument = Instrument;
window.parseABCFile = parseABCFile;

// The package implementation. Right now, just one class.
module.exports = {
	Instrument: Instrument,
	parseABCFile: parseABCFile
}
