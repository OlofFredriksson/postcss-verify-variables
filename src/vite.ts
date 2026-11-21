import type { Plugin } from "vite";
import postcss from "postcss";
import verifyVars, { type VerifyOptions } from "./verify-vars.ts";

function verifyOutput(options: VerifyOptions): Plugin {
    return {
        name: "verify-variables:output",
        apply: "build",
        enforce: "post",
        configResolved(config) {
            const output = config.build.rolldownOptions.output;
            if (Array.isArray(output) && output.length > 1) {
                throw new Error(
                    "verifyVarsVite does not support builds with multiple output configurations.",
                );
            }
        },
        generateBundle: {
            order: "post",
            async handler(_outputOptions, bundle) {
                const css: string[] = [];
                for (const asset of Object.values(bundle)) {
                    if (
                        asset.type === "asset" &&
                        asset.fileName.endsWith(".css")
                    ) {
                        css.push(
                            typeof asset.source === "string"
                                ? asset.source
                                : new TextDecoder().decode(asset.source),
                        );
                    }
                }

                await postcss([verifyVars(options)]).process(css.join("\n"), {
                    from: undefined,
                });
            },
        },
    };
}

/**
 * Verify all generated Vite CSS assets together.
 */
export function verifyVarsVite(options: VerifyOptions = {}): Plugin[] {
    return [verifyOutput(options)];
}
