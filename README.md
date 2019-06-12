# css-modulesify

[![Build Status](https://travis-ci.org/css-modules/css-modulesify.svg?branch=master)](https://travis-ci.org/css-modules/css-modulesify)

A browserify plugin to load [CSS Modules].

[CSS Modules]: https://github.com/css-modules/css-modules

**Please note that this is still highly experimental.**

## Why CSS Modules?

Normally you need to use a strict naming convention like BEM to ensure that one component's CSS doesn't collide with another's. CSS Modules are locally scoped, which allows you to use names that are meaningful within the context of the component, without any danger of name collision.

Read Mark Dalgleish's excellent ["End of Global CSS"](https://medium.com/seek-blog/the-end-of-global-css-90d2a4a06284) and check out [css-modules](https://github.com/css-modules/css-modules) for more context.

## Getting started

First install the package: `npm install --save css-modulesify`

Then you can use it as a browserify plugin, eg: `browserify -p [ css-modulesify -o dist/main.css ] example/index.js`

Inside `example/index.js` you can now load css into your scripts.  When you do `var box1 = require('./box1.css')`, `box1` will be an object to lookup the localized classname for one of the selectors in that file.

So to apply a class to an element you can do something like:

```js
var styles = require('./styles.css');
var div = `<div class="${styles.inner}">...</div>`;
```

The generated css will contain locally-scoped versions of any css you have `require`'d, and will be written out to the file you specify in the `--output` or `-o` option.

## API Usage

```js
var b = require('browserify')();

b.add('./main.js');
b.plugin(require('css-modulesify'), {
  rootDir: __dirname,
  output: './path/to/my.css'
});

b.bundle();
```

```js
// or, get the output as a stream
var b = require('browserify')();
var fs = require('fs');

b.add('./main.js');
b.plugin(require('css-modulesify'), {
  rootDir: __dirname
});

var bundle = b.bundle()
b.on('css stream', function (css) {
  css.pipe(fs.createWriteStream('mycss.css'));
});
```

### Options:

- `rootDir`: absolute path to your project's root directory. This is optional but providing it will result in better generated classnames. css-modulesify will try to use the browserify `basedir` if `rootDir` is not specified, if both are not specified it will use the location from which the command was executed. 
- `output`: path to write the generated css. If not provided, you'll need to listen to the `'css stream'` event on the bundle to get the output.
- `jsonOutput`: optional path to write a json manifest of classnames.
- `use`: optional array of postcss plugins (by default we use the css-modules core plugins). NOTE: it's safer to use `after`
- `before`:  optional array of postcss plugins to run before the required css-modules core plugins are run.
- `after`:  optional array of postcss plugins to run after the required css-modules core plugins are run.
- `generateScopedName`: (API only) a function to override the default behaviour of creating locally scoped classnames.
- `global`: optional boolean. Set to `true` if you want `css-modulesify` to apply to `node_modules` as well as local files. You can read more about it in the [browserify docs](https://github.com/substack/node-browserify/#btransformtr-opts).
- `filePattern`: optional regular expression string to specify css file names. (default: `\.css$`)
- `cache`: optional object to persist cache between runs.

### Events
- `b.on('css stream', callback)` The callback is called with a readable stream containing the compiled CSS. You can write this to a file.

## Using CSS Modules on the backend

If you want to use CSS Modules in server-generated templates there are a couple of options:

- Option A (nodejs only): register the [require-hook](https://github.com/css-modules/css-modules-require-hook) so that `var styles = require('./foo.css')` operates the same way as on the frontend. Make sure that the `rootDir` option matches to guarantee that the classnames are the same.

- Option B: configure the `jsonOutput` option with a file path and `css-modulesify` will generate a JSON manifest of classnames.


## PostCSS Plugins

The following PostCSS plugins are enabled by default:

  * [postcss-modules-local-by-default]
  * [postcss-modules-extract-imports]
  * [postcss-modules-scope]
  * [postcss-modules-values]

(i.e. the [CSS Modules] specification).

You can override the default PostCSS Plugins (and add your own) by passing `--use|-u` to `css-modulesify`.

Or if you just want to add some extra plugins to run after the default, add them to the `postcssAfter` array option (API only at this time). In the same way, add extra plugins to `postcssBefore` to run the before the defaults.

In addition you may also wish to configure defined PostCSS plugins by passing `--plugin.option true`.

An example of this would be:

```
browserify -p [css-modulesify \
  --after autoprefixer --autoprefixer.browsers '> 5%' \
  -o dist/main.css] -o dist/index.js src/index.js
```

[postcss-modules-local-by-default]: https://github.com/css-modules/postcss-modules-local-by-default
[postcss-modules-extract-imports]: https://github.com/css-modules/postcss-modules-extract-imports
[postcss-modules-scope]: https://github.com/css-modules/postcss-modules-scope
[postcss-modules-values]: https://github.com/css-modules/postcss-modules-values

## Building for production

If you set `NODE_ENV=production` then `css-modulesify` will generate shorter (though less useful) classnames.

You can also manually switch to short names by setting the `generateScopedName` option. Eg:

```
browserify.plugin(cssModulesify, {
  rootDir: __dirname,
  output: './dist/main.css',
  generateScopedName: cssModulesify.generateShortName
})
```

## Example

An example implementation can be found [here](https://github.com/css-modules/browserify-demo).

## Licence

MIT

## With thanks

 - Tobias Koppers
 - Mark Dalgleish
 - Glen Maddern

----
Josh Johnston, 2015.
