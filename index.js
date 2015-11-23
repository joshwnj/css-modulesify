// Some css-modules-loader-code dependencies use Promise so we'll provide it for older node versions
if (!global.Promise) { global.Promise = require('promise-polyfill') }

var fs = require('fs');
var path = require('path');
var through = require('through');
var Core = require('css-modules-loader-core');
var FileSystemLoader = require('css-modules-loader-core/lib/file-system-loader');
var assign = require('object-assign');
var stringHash = require('string-hash');
var ReadableStream = require('stream').Readable;

/*
  Custom `generateScopedName` function for `postcss-modules-scope`.
  Short names consisting of source hash and line number.
*/
function generateShortName (name, filename, css) {
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
function generateLongName (name, filename) {
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

  // if no root directory is specified, assume the cwd
  var rootDir = options.rootDir || options.d;
  if (rootDir) { rootDir = path.resolve(rootDir); }
  if (!rootDir) { rootDir = process.cwd(); }

  var cssOutFilename = options.output || options.o;
  var jsonOutFilename = options.json || options.jsonOutput;

  // PostCSS plugins passed to FileSystemLoader
  var plugins = options.use || options.u;
  if (!plugins) {
    plugins = getDefaultPlugins(options);
  }
  else {
    if (typeof plugins === 'string') {
      plugins = [plugins];
    }
  }

  var postcssAfter = options.postcssAfter || options.after || [];
  plugins = plugins.concat(postcssAfter);

  // load plugins by name (if a string is used)
  plugins = plugins.map(function requirePlugin (name) {
    // assume functions are already required plugins
    if (typeof name === 'function') {
      return name;
    }

    var plugin = require(require.resolve(name));

    // custom scoped name generation
    if (name === 'postcss-modules-scope') {
      options[name] = options[name] || {};
      if (!options[name].generateScopedName) {
        options[name].generateScopedName = generateLongName;
      }
    }

    if (name in options) {
      plugin = plugin(options[name]);
    }
    else {
      plugin = plugin.postcss || plugin();
    }

    return plugin;
  });

  // the compiled CSS stream needs to be avalible to the transform,
  // but re-created on each bundle call.
  var compiledCssStream;

  function transform (filename) {
    // only handle .css files
    if (!cssExt.test(filename)) {
      return through();
    }

    // collect visited filenames
    filenames.push(filename);

    var loader = new FileSystemLoader(rootDir, plugins);
    return through(function noop () {}, function end () {
      var self = this;

      loader.fetch(path.relative(rootDir, filename), '/').then(function (tokens) {
        var output = 'module.exports = ' + JSON.stringify(tokens);

        assign(tokensByFile, loader.tokensByFile);

        // store this file's source to be written out to disk later
        sourceByFile[filename] = loader.finalSource;

        compiledCssStream.push(loader.finalSource);

        self.queue(output);
        self.queue(null);
      }, function (err) {
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
