# post-css-verify

A PostCSS plugin that checks whether referenced CSS custom properties are defined in the CSS being processed. It is useful for detecting misspelled or missing `var(--name)` references during a build.

## Installation

Install the plugin and PostCSS in your project:

```sh
npm install --save-dev post-css-verify postcss
```

## Usage

Add the plugin to a PostCSS pipeline:

```js
import postcss from "postcss";
import { verifyVars } from "post-css-verify";

const css = `
    :root {
        --brand-color: #005ea8;
    }

    .button {
        color: var(--brand-color);
    }
`;

const result = await postcss([verifyVars()]).process(css, {
    from: "src/styles.css",
});

console.log(result.css);
```

When the plugin finds a reference that is neither defined nor ignored, PostCSS processing rejects with an error. For example, `color: var(--missing);` fails with an error identifying `--missing` and the `color` declaration.

## What is checked

The plugin scans declaration values for `var(--name)` references and collects custom property declarations (properties beginning with `--`) across the entire PostCSS root. A variable can therefore be declared before or after its use, and its selector does not affect this check.

This is a presence check, not a CSS cascade or scope analysis: a definition anywhere in the processed root counts as defined. The plugin also checks references inside `var()` fallbacks. For example, `var(--primary, var(--fallback))` still requires `--fallback` to be defined or ignored.

To validate variables spread across multiple source files, make sure those files have been combined into the same PostCSS root before this plugin runs. In a PostCSS pipeline, place it after plugins that import or combine CSS.

## Ignoring variables

Variables provided at runtime or by CSS outside the processed root can be allowlisted with the `ignore` option. Supply exact names, including the `--` prefix:

```js
import { verifyVars } from "post-css-verify";

export default {
    plugins: [
        verifyVars({
            ignore: ["--runtime-color", "--host-theme"],
        }),
    ],
};
```

`ignore` is optional and defaults to an empty list. A variable in this list is allowed even if it is not declared in the processed CSS. All other undefined references cause the build to fail with a PostCSS error that includes the source location when available.

## Development

Run `npm test` for lint and unit tests. Run `npm run integration-test` to build the plugin and run the Sass and PostCSS integration tests. Add future Vitest integration tests as `*.test.ts` files in `src/int-test`; they can reuse `src/int-test/build.mjs` and use their own Sass fixtures.

CI checks the build on Linux and runs the tests on Linux and Windows. The integration tests build the package on each test runner.
