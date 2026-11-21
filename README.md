# postcss-verify-variables

A PostCSS plugin that detects missing or misspelled CSS custom property references during a build.

## Installation

Install the plugin and PostCSS in your project:

```sh
npm install --save-dev postcss-verify-variables postcss
```

## Usage

Add the plugin to a PostCSS pipeline:

```js
import postcss from "postcss";
import { verifyVars } from "postcss-verify-variables";

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

An undefined reference causes PostCSS processing to fail with an error identifying the variable and declaration. For example, `color: var(--missing)` fails unless `--missing` is declared or ignored.

### Vite

Add the plugin to `css.postcss.plugins` in your Vite configuration:

```js
import { defineConfig } from "vite";
import { verifyVars } from "postcss-verify-variables";

export default defineConfig({
    css: {
        postcss: {
            plugins: [verifyVars()],
        },
    },
});
```

## What is checked

The plugin checks `var(--name)` references in declaration values against custom properties declared anywhere in the processed PostCSS root or in the [`global`](#global-compiled-css) option. Variables listed in [`ignore`](#ignoring-variables) are also allowed.

This is a presence check, not a cascade or scope analysis. A declaration counts regardless of its selector or position, even if it would not apply to the element using the variable.

References in fallbacks are checked too. For example, `var(--primary, var(--fallback))` requires both variables to be declared or ignored, even if `--primary` is declared.

References are detected with a regular expression, not a CSS value parser. It recognizes ASCII letters, digits, underscores, and hyphens in names; escaped or non-ASCII names may be missed or matched only partially. Text resembling a reference inside a string may also be checked.

To check variables across files, place this plugin after plugins that import or combine CSS into the same PostCSS root.

## Ignoring variables

Use `ignore` for variables supplied at runtime or by CSS outside the processed root. Provide exact names, including the `--` prefix:

```diff
verifyVars({
+   ignore: ["--runtime-color", "--host-theme"],
})
```

`ignore` is optional and defaults to an empty list.

## Global compiled CSS

Use `global` to provide compiled CSS whose variables will be available in the final build:

```diff
verifyVars({
+   global: ":root { --runtime-color: black; --host-theme: white; }",
}),
```

`global` is optional and defaults to an empty string. It must contain valid CSS. Its custom property declarations count as defined, but text in comments or strings does not. References inside `global` itself are not checked.
