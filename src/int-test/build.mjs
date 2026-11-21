import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { compileAsync } from "sass";

// eslint-disable-next-line import-x/no-unresolved, import-x/order -- The package is built before integration tests.
import { verifyVars } from "post-css-verify";

const input = process.argv[2];
if (!input) {
    throw new Error("Provide a Sass entry file.");
}

const globalFile = process.argv[3];
const globalCss = globalFile ? await readFile(globalFile, "utf8") : undefined;

const sass = await compileAsync(input);
const result = await postcss([verifyVars({ global: globalCss })]).process(
    sass.css,
    { from: input },
);
process.stdout.write(`${result.css}\n`);
