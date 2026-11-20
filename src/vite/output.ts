import type { Plugin, Rolldown } from "vite";
import postcss, { CssSyntaxError } from "postcss";
import verifyVars, {
    type VerifyOptions,
    VERIFY_VARS_PLUGIN_NAME,
} from "../verify-vars.ts";
import { verifyStyles } from "./verify-styles.ts";

const decoder = new TextDecoder();

type OutputAsset = Rolldown.OutputAsset;

function isCssAsset(
    chunk: Rolldown.OutputChunk | OutputAsset,
): chunk is OutputAsset {
    return chunk.type === "asset" && chunk.fileName.endsWith(".css");
}

function readSource(asset: OutputAsset): string {
    return typeof asset.source === "string"
        ? asset.source
        : decoder.decode(asset.source);
}

export function verifyOutput(options: VerifyOptions): Plugin {
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
                const sources = Object.values(bundle)
                    .filter(isCssAsset)
                    .map((asset): [string, string] => [
                        asset.fileName,
                        readSource(asset),
                    ]);

                try {
                    await verifyStyles(postcss([verifyVars(options)]), sources);
                } catch (error) {
                    if (
                        !(error instanceof CssSyntaxError) ||
                        error.plugin !== VERIFY_VARS_PLUGIN_NAME
                    ) {
                        throw error;
                    }
                    this.error({ message: error.message, stack: "" });
                }
            },
        },
    };
}
