import type { PluginCreator } from "postcss";

// postcss-verify-vars.js
interface VerifyOptions {
    ignore?: string[];
}

const verifyVars: PluginCreator<VerifyOptions> = (opts = {}) => {
    const ignore = new Set(opts.ignore || []);

    return {
        postcssPlugin: "postcss-verify-vars",
        Once(root) {
            const definedVars = new Set();

            // Steg 1: Samla in alla definierade variabler i hela CSS-klumpen
            root.walkDecls((decl) => {
                if (decl.prop.startsWith("--")) {
                    definedVars.add(decl.prop);
                }
            });

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
                            `Odefinierad CSS-variabel: "${varName}" används i "${decl.prop}", men saknas i den byggda CSS-filen.`,
                            { word: varName },
                        );
                    }
                }
            });
        },
    };
};

verifyVars.postcss = true;

export default verifyVars;
