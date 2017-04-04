// Some css-modules-loader-code dependencies use Promise so we'll provide it for older node versions
if (!global.Promise) { global.Promise = require('promise-polyfill'); }

var fs = require('fs');
var path = require('path');
var Cmify = require('./cmify');
var Core = require('css-modules-loader-core');
var FileSystemLoader = require('./file-system-loader');
var assign = require('object-assign');
var stringHash = require('string-hash');
var ReadableStream = require('stream').Readable;
var through = require('through2');

/*
  Custom `generateScopedName` function for `postcss-modules-scope`.
  Short names consisting of source hash and line number.
*/
function generateShortName (name, filename, css) {
  // first occurrence of the name
  // TODO: better match with regex
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

// caches
//
// persist these for as long as the process is running. #32

// keep track of all tokens so we can avoid duplicates
var tokensByFile = {};

// we need a separate loader for each entry point
var loadersByFile = {};

module.exports = function (browserify, options) {
  options = options || {};

  // if no root directory is specified, assume the cwd
  var rootDir = options.rootDir || options.d || browserify._options.basedir;
  if (rootDir) { rootDir = path.resolve(rootDir); }
  if (!rootDir) { rootDir = process.cwd(); }

  var transformOpts = {};
  if (options.global || options.g) {
    transformOpts.global = true;
  }

  var cssOutFilename = options.output || options.o;
  var jsonOutFilename = options.json || options.jsonOutput;
  transformOpts.cssOutFilename = cssOutFilename;
  transformOpts.cssFilePattern = options.filePattern;

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

  var postcssBefore = options.postcssBefore || options.before || [];
  var postcssAfter = options.postcssAfter || options.after || [];
  plugins = (Array.isArray(postcssBefore) ? postcssBefore : [postcssBefore]).concat(plugins).concat(postcssAfter);

  // load plugins by name (if a string is used)
  plugins = plugins.map(function requirePlugin (name) {
    // assume not strings are already required plugins
    if (typeof name !== 'string') {
      return name;
    }

    var plugin = module.parent.require(name);

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

  // create a loader for this entry file
  var loader = loadersByFile[cssOutFilename];
  if (!loader) {
    loader = loadersByFile[cssOutFilename] = new FileSystemLoader(rootDir, plugins);
  }

  function createCssModuleSource (filename, cb) {
    // reset the `tokensByFile` cache
    var relFilename = path.relative(rootDir, filename);
    tokensByFile[filename] = loader.tokensByFile[filename] = null;

    loader.fetch(relFilename, '/').then(function (tokens) {
      var deps = loader.deps.dependenciesOf(filename);
      var output = deps.map(function (f) {
        return 'require("' + f + '")';
      });
      output.push('module.exports = ' + JSON.stringify(tokens));

      var isValid = true;
      var isUndefined = /\bundefined\b/;
      Object.keys(tokens).forEach(function (k) {
        if (isUndefined.test(tokens[k])) {
          isValid = false;
        }
      });

      if (!isValid) {
        var err = 'Composition in ' + filename + ' contains an undefined reference';
        console.error(err);
        output.push('console.error("' + err + '");');
      }

      assign(tokensByFile, loader.tokensByFile);

      return cb(null, output.join('\n'));
    }).catch(function (err) {
      return cb(err);
    });
  }

  // TODO: clean this up so there's less scope crossing
  Cmify.prototype._flush = function (callback) {
    var self = this;
    var filename = this._filename;

    // only handle .css files
    if (!this.isCssFile(filename)) { return callback(); }

    createCssModuleSource(filename, function (err, source) {
      if (err) {
        self.push('console.error("' + err + '");');
        self.emit('error', err);
        return callback();
      }

      self.push(source);
      return callback();
    });
  };

  browserify.transform(Cmify, transformOpts);

  // ----

  function invalidateFile (filename) {
    Object.keys(loadersByFile).forEach(function (loaderKey) {
      var loader = loadersByFile[loaderKey];

      // clear the token cache for the changed file
      tokensByFile[filename] = loader.tokensByFile[filename] = null;

      // also clear the cache for any modules depending on this one
      try {
        var deps = loader.deps.dependantsOf(filename);
        deps.forEach(function (dep) {
          tokensByFile[dep] = loader.tokensByFile[dep] = null;
        });
      }
      catch (err) {}
    });
  }

  function addHooks () {
    browserify.pipeline.get('deps').push(through.obj(function write (row, enc, next) {
      // css modules need to be regenerated at this point
      // (so that imported @value updates are carried through hmr)
      var self = this;
      if (!/\.css$/.test(row.id)) {
        return next(null, row)
      }

      invalidateFile(row.id)
      return createCssModuleSource(row.id, function (err, source) {
        if (err) {
          row.source = 'console.error("' + err + '");';
          self.emit('error', err);
          return next(null, row)
        }

        row.source = source
        next(null, row)
      })
    }, function end (done) {
      done();
    }));

    browserify.pipeline.get('pack').push(through(function write (row, enc, next) {
      next(null, row);
    }, function end (cb) {
      // on each bundle, create a new stream b/c the old one might have ended
      var compiledCssStream = new ReadableStream();
      compiledCssStream._read = function () {};

      browserify.emit('css stream', compiledCssStream);

      // Combine the collected sources for a single bundle into a single CSS file
      var self = this;
      var loader = loadersByFile[cssOutFilename];
      var css = loader.finalSource;

      // end the output stream
      compiledCssStream.push(css);
      compiledCssStream.push(null);

      var writes = [];

      // write the css file
      if (cssOutFilename) {
        writes.push(writeFile(cssOutFilename, css));
      }

      // write the classname manifest
      if (jsonOutFilename) {
        writes.push(writeFile(jsonOutFilename, JSON.stringify(normalizeManifestPaths(tokensByFile, rootDir))));
      }
      Promise.all(writes)
        .then(function () { cb(); })
        .catch(function (err) { self.emit('error', err); cb(); });
    }));
  }

  browserify.on('reset', addHooks);
  addHooks();

  browserify.on('update', function (files) {
    // invalidate cache of any changed css modules
    files.forEach(invalidateFile);
  })

  return browserify;
};

function writeFile (filename, content) {
  return new Promise(function (resolve, reject) {
    fs.writeFile(filename, content, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports.generateShortName = generateShortName;
module.exports.generateLongName = generateLongName;
