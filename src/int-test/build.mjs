import postcss from "postcss";
import { compileAsync } from "sass";

// eslint-disable-next-line import-x/no-unresolved, import-x/order -- The package is built before integration tests.
import { verifyVars } from "post-css-verify";

const input = process.argv[2];
if (!input) {
    throw new Error("Provide a Sass entry file.");
}

const sass = await compileAsync(input);
const result = await postcss([verifyVars()]).process(sass.css, { from: input });
process.stdout.write(`${result.css}\n`);
