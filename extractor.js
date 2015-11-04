var postcss = require('postcss');
var genericNames = require('generic-names');
var path = require('path');

var Values = require('postcss-modules-values');
var LocalByDefault = require('postcss-modules-local-by-default');
var ExtractImports = require('postcss-modules-extract-imports');
var Scope = require('postcss-modules-scope');
var Parser = require('postcss-modules-parser');

/**
 * @param  {array}           options.append
 * @param  {array}           options.prepend
 * @param  {array}           options.use
 * @param  {function}        options.createImportedName
 * @param  {function|string} options.generateScopedName
 * @param  {string}          options.mode
 * @param  {string}          options.rootDir
 * @param  {function}        fetch
 * @return {object}
 */
module.exports = function extractor(options, fetch) {
  options = options || {};
  var append = options.append;
  var prepend = options.prepend;
  var createImportedName = options.createImportedName;
  var generateScopedName = options.generateScopedName;
  var mode = options.mode;
  var use = options.use;
  var context = options.rootDir || process.cwd();

  var scopedName;
  if (generateScopedName) {
    scopedName = typeof generateScopedName !== 'function'
      ? genericNames(generateScopedName || '[name]__[local]___[hash:base64:5]', {context: context})
      : function (local, filename, css) {
        // had to wrap that function cause i didn't expected,
        // that generateShortName() and generateLongName() functions
        // use the fake path to file (relative to rootDir)
        // which result in the generated class names
        return generateScopedName(local, filename, css, context);
      };
  } else {
    // small fallback
    scopedName = function (local, filename) {
      return Scope.generateScopedName(local, path.relative(context, filename));
    }
  }

  var plugins;
  if (use) {
    plugins = use;
  } else {
    plugins = (prepend || [])
      .concat([
        Values,
        mode
          ? new LocalByDefault({mode: mode})
          : LocalByDefault,
        createImportedName
          ? new ExtractImports({createImportedName: createImportedName})
          : ExtractImports,
        new Scope({generateScopedName: scopedName}),
      ], append || []);
  }

  plugins = plugins.concat(new Parser({fetch: fetch}));

  return postcss(plugins);
}
