// Populates pre-made Habitat Elko objects into MongoDB.

// Usage: node populateModels.js MONGO_HOST FILE_ROOT
// Examples:
//   node populateModels.js 127.0.0.1:27017 all

var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;
var path = require('path');
var process = require('process');
var sleep = require('system-sleep');
var walk = require('walk');

const fileRoots = {
  all: '.',
  book_of_records: './Text/text-bookofrecords.json',
  downtown_regions: './new_Downtown',
  woods: './Woods',
  beach: './Beach',
  back4t: './Back4t',
  streets: "./Streets",
  text: './Text'
};

const replacements = [
  [/UP/g, '"|"'],
  [/DOWN/g, '"}"'],
  [/LEFT/g, '"~"'],
  [/RIGHT/g, '"\u007f"'],
  [/SPACE/g, '" "'],
  [/WEST/g, '0'],
  [/SOUTH/g, '1'],
  [/EAST/g, '2'],
  [/NORTH/g, '3']
];

const joinReplacements = {
  UP: '|',
  DOWN: '}',
  LEFT: '~',
  RIGHT: '\u007f',
  SPACE: ' ',
  WEST: '0',
  SOUTH: '1',
  EAST: '2',
  NORTH: '3'
};

const replacementJoinRegex = /((([A-Z]+\s?\+\s?)+)([A-Z]+\s?)+)/;
const stringJoinRegex = /(("([^"]|\\")*"\s*\+\s*)+"([^"]|\\")*")/g;

// Adds a format() method to String.
String.prototype.format = function() {
  var s = this,
    i = arguments.length;

  while (i--) {
    s = s.replace(new RegExp('\\{' + i + '\\}', 'gm'), arguments[i]);
  }
  return s;
};

// Adapted from mongohelper.js:
var updates_in_flight = 0;

function eget(db, ref) {
  return db.collection('odb').findOne({ ref: ref });
}

function esave(db, obj) {
  db.collection('odb').save(obj, function(err, record) {
    if (err) {
      console.error('Encountered error while saving to MongoDB: ', err);
    }
    updates_in_flight--;
  });
}

function eupdateOne(db, obj) {
  updates_in_flight++;
  var o = eget(db, obj.ref);
  if (o !== null) {
    obj._id = o._id;
  }
  esave(db, obj);
}

function eupdate(db, obj, callback) {
  if (obj instanceof Array) {
    obj.forEach(function (o) { 
      eupdateOne(db, o);
    });
  } else {
    eupdateOne(db, obj);
  }
}

function templateStringJoins(data) {
  if (data.search(/\+/) != -1) {
    return data.replace(/(\n)/g, '').replace(stringJoinRegex,
      function(origText, offset, string) {
        var replacementText = [];
        var splitText = origText.split('+');
        for (var textLineId in splitText) {
          var trimTextLine = splitText[textLineId].trim();
          var quotesRemoved = trimTextLine.replace(/(^")|("$)/g, '');
          replacementText.push(quotesRemoved);
        }
        return '"{0}"'.format(replacementText.join(''));
      }
    );
  }
  return data;
}

function templateConstantJoins(data) {
  return data.replace(replacementJoinRegex, function(origText, offset, string) {
    var replacementText = [];
    var splitText = origText.split('+');
    for (var habConstId in splitText) {
      var trimHabConst = splitText[habConstId].trim();
      if (trimHabConst in joinReplacements) {
        replacementText.push(joinReplacements[trimHabConst]);
      }
    }
    return '"{0}"'.format(replacementText.join(''));
  });
}

function templateHabitatObject(data) {
  var templated = templateConstantJoins(data);
  for (var replacementId in replacements) {
    var replacement = replacements[replacementId];
    var regex = replacement[0];
    var replacementText = replacement[1];
    templated = templated.replace(regex, replacementText);
  }
  return templateStringJoins(templated);
}

function populateModels() {
  if (process.argv.length < 4) {
    console.error('Populates pre-made Habitat Elko objects into MongoDB.');
    console.error('Usage: node populateModels.js MONGO_HOST FILE_ROOT');
    process.exit(-1);
  }

  var mongoHost = process.argv[2];
  var fileRootName = process.argv[3];

  if (!(fileRootName in fileRoots)) {
    console.log('Invalid root: ', fileRootName);
    process.exit(-1);
  }

  MongoClient.connect('mongodb://{0}/elko'.format(mongoHost), function(err, db) {
    if (err) {
      console.error('Could not open Mongo connection:', mongoHost);
      return console.error(err);
    }

    var walker = walk.walk(fileRoots[fileRootName]);

    walker.on('file', function(root, fileStats, next) {
      // If the file we've located ends in .json, tries to parse it after performing
      // templating. If successful, updates its corresponding Document in MongoDB.
      if (fileStats.type == 'file' && fileStats.name.endsWith('.json')) {
        var objectPath = path.join(root, fileStats.name);
        fs.readFile(objectPath, 'utf8', function (err, data) {
          if (err) {
            console.error('Could not read file:', objectPath);
            return console.error(err);
          }
          var templatedJSON = '';
          try {
            templatedJSON = templateHabitatObject(data);
            var mongoObj = JSON.parse(templatedJSON);
            try {
              eupdate(db, mongoObj);
            } catch (e) {
              console.error('Failed to update Habitat object:', mongoObj.ref);
              return console.error(e);
            }
          } catch (e) {
            console.error('Failed to parse file:', objectPath);
            console.log(templatedJSON);
            return console.error(e);
          }
        });
      }

      // Advances the file walk iterator.
      next();
    });

    walker.on('errors', function (root, nodeStatsArray, next) {
      console.error('Encountered error at: ', root);
      next();
    });

    walker.on('end', function () { 
      sleep(1000);
      while (updates_in_flight > 0) {
        console.log('Waiting for in-flight Habitat object updates: ', updates_in_flight);
        sleep(1000);
      }
      console.log('Completed Habitat object population: ', fileRootName);
      process.exit(0);
    });
  });
}

// Starts the model population process on main().
(function () {
  populateModels();
}());
