import { type Plugin, type Root, parse } from "postcss";

export const VERIFY_VARS_PLUGIN_NAME = "postcss-verify-variables-vars";

/**
 * Configuration options for postcss-verify-variables-vars.
 */
export interface VerifyOptions {
    /**
     * Variable names that are allowed without being defined in the processed CSS.
     * Specify each name exactly, including the `--` prefix.
     *
     * @defaultValue `[]`
     */
    ignore?: string[];

    /**
     * Already compiled global CSS containing variables that are provided at the
     * final build stage. Variables declared in this string are allowed in the
     * processed CSS even if they are not declared in the PostCSS root.
     * The string must be valid CSS.
     *
     * @defaultValue `""`
     */
    global?: string;

    /**
     * Text displayed before an undefined variable error message.
     */
    errorBanner?: string;
}

function collectDefinedVars(root: Root, definedVars: Set<string>): void {
    root.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) {
            definedVars.add(decl.prop);
        }
    });
}

function verifyVars(opts: VerifyOptions = {}): Plugin {
    const ignore = new Set(opts.ignore || []);
    const globalDefinedVars = new Set<string>();
    if (opts.global !== undefined) {
        collectDefinedVars(
            parse(opts.global, { from: undefined }),
            globalDefinedVars,
        );
    }

    return {
        postcssPlugin: VERIFY_VARS_PLUGIN_NAME,
        Once(root) {
            const definedVars = new Set(globalDefinedVars);
            collectDefinedVars(root, definedVars);

            // Steg 2: Kontrollera alla var(--namn)
            root.walkDecls((decl) => {
                if (!decl.value.toLowerCase().includes("var(")) {
                    return;
                }

                const matches = decl.value.matchAll(/var\(\s*(--[\w-]+)/gi);
                for (const match of matches) {
                    const varName = match[1];

                    if (!definedVars.has(varName) && !ignore.has(varName)) {
                        throw decl.error(
                            [
                                ...(opts.errorBanner ? [opts.errorBanner] : []),
                                `CSS variable "${varName}" referenced in "${decl.prop}" could not be verified.`,
                                'It is not declared in the processed CSS or "global" and is not listed in "ignore".',
                                "Declare the variable in the processed CSS.",
                                'If it is defined elsewhere, provide its CSS via "global" or add its name to "ignore".',
                            ].join("\n"),
                            { word: varName },
                        );
                    }
                }
            });
        },
    };
}

verifyVars.postcss = true;

export default verifyVars;
