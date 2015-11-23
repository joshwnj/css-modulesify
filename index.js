// Some css-modules-loader-code dependencies use Promise so we'll provide it for older node versions
if (!global.Promise) { global.Promise = require('promise-polyfill') }

var fs = require('fs');
var path = require('path');
var through = require('through');
var extractor = require('./extractor');
var FileSystemLoader = require('css-modules-loader-core/lib/file-system-loader');
var assign = require('object-assign');
var stringHash = require('string-hash');
var ReadableStream = require('stream').Readable;

/*
  Custom `generateScopedName` function for `postcss-modules-scope`.
  Short names consisting of source hash and line number.
*/
function generateShortName (name, filename, css, context) {
  filename = path.relative(context, filename);
  // first occurrence of the name
  // TOOD: better match with regex
  var i = css.indexOf('.' + name);
  var numLines = css.substr(0, i).split(/[\r\n]/).length;

  var hash = stringHash(css).toString(36).substr(0, 5);
  return '_' + name + '_' + hash + '_' + numLines;
}

/*
  Custom `generateScopedName` function for `postcss-modules-scope`.
  Appends a hash of the css source.
*/
function generateLongName (name, filename, css, context) {
  filename = path.relative(context, filename);
  var sanitisedPath = filename.replace(/\.[^\.\/\\]+$/, '')
      .replace(/[\W_]+/g, '_')
      .replace(/^_|_$/g, '');

  return '_' + sanitisedPath + '__' + name;
}

/*
  Get the default plugins and apply options.
*/
function getDefaultPlugins (options) {
  var scope = Core.scope;
  var customNameFunc = options.generateScopedName;
  var defaultNameFunc = process.env.NODE_ENV === 'production' ?
      generateShortName :
      generateLongName;

  scope.generateScopedName = customNameFunc || defaultNameFunc;

  return [
    Core.values
    , Core.localByDefault
    , Core.extractImports
    , scope
  ];
}

/*

  Normalize the manifest paths so that they are always relative
  to the project root directory.

*/
function normalizeManifestPaths (tokensByFile, rootDir) {
  var output = {};
  var rootDirLength = rootDir.length + 1;

  Object.keys(tokensByFile).forEach(function (filename) {
    var normalizedFilename = filename.substr(rootDirLength);
    output[normalizedFilename] = tokensByFile[filename];
  });

  return output;
}

var cssExt = /\.css$/;

// caches
//
// persist these for as long as the process is running. #32

// keep track of css files visited
var filenames = [];

// keep track of all tokens so we can avoid duplicates
var tokensByFile = {};

// keep track of all source files for later builds: when
// using watchify, not all files will be caught on subsequent
// bundles
var sourceByFile = {};

module.exports = function (browserify, options) {
  options = options || {};
  options.rootDir = options.rootDir || options.d || undefined;
  options.append = options.postcssAfter || options.after || [];
  options.use = options.use || options.u || undefined;

  var cssOutFilename = options.output || options.o;
  var jsonOutFilename = options.json || options.jsonOutput;

  // the compiled CSS stream needs to be avalible to the transform,
  // but re-created on each bundle call.
  var compiledCssStream;
  var instance = extractor(options, fetch);

  function fetch(_to, from) {
    var to = _to.replace(/^["']|["']$/g, '');

    return new Promise(function (resolve, reject) {
      try {
        var filename = /\w/i.test(to[0])
          ? require.resolve(to)
          : path.resolve(path.dirname(from), to);
      } catch (e) {
        return void reject(e);
      }

      fs.readFile(filename, 'utf8', function (err, css) {
        if (err) {
          return void reject(err);
        }

        instance.process(css, {from: filename})
          .then(function (result) {
            var css = result.css;
            var tokens = result.root.tokens;

            assign(tokensByFile, tokens);
            sourceByFile[filename] = css;
            compiledCssStream.push(css);

            resolve(tokens);
          })
          .catch(reject);
      });
    });
  }

  function transform (filename) {
    // only handle .css files
    if (!cssExt.test(filename)) {
      return through();
    }

    // collect visited filenames
    filenames.push(filename);

    return through(function noop () {}, function end () {
      var self = this;

      fetch(filename, filename)
        .then(function (tokens) {
          var output = 'module.exports = ' + JSON.stringify(tokens);

          self.queue(output);
          self.queue(null);
        })
        .catch(function (err) {
          self.emit('error', err);
        });
    });
  }

  browserify.transform(transform, {
    global: true
  });

  browserify.on('bundle', function (bundle) {
    // on each bundle, create a new stream b/c the old one might have ended
    compiledCssStream = new ReadableStream();
    compiledCssStream._read = function () {};

    bundle.emit('css stream', compiledCssStream);

    bundle.on('end', function () {
      // Combine the collected sources into a single CSS file
      var files = Object.keys(sourceByFile);
      var css;

      // end the output stream
      compiledCssStream.push(null);

      // write the css file
      if (cssOutFilename) {
        css = files.map(function (file) {
          return sourceByFile[file];
        }).join('\n');

        fs.writeFile(cssOutFilename, css, function (err) {
          if (err) {
            browserify.emit('error', err);
          }
        });
      }

      // write the classname manifest
      if (jsonOutFilename) {
        fs.writeFile(jsonOutFilename, JSON.stringify(normalizeManifestPaths(tokensByFile, rootDir)), function (err) {
          if (err) {
            browserify.emit('error', err);
          }
        });
      }

      // reset the `tokensByFile` cache
      tokensByFile = {};
    });
  });

  return browserify;
};

module.exports.generateShortName = generateShortName;
module.exports.generateLongName = generateLongName;
