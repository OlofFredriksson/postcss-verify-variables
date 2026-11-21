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

function verifyDevelopment(options: VerifyOptions): Plugin {
    const styles = new Map<string, string>();
    let scheduleVerification: (() => void) | undefined;

    return {
        name: "verify-variables:development",
        apply: "serve",
        enforce: "pre",
        configureServer(server) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let lastWarning: string | undefined;

            let processor: ReturnType<typeof postcss>;
            try {
                processor = postcss([verifyVars(options)]);
            } catch (error) {
                if (!(error instanceof Error)) {
                    server.config.logger.error(String(error));
                    return;
                }
                server.config.logger.warn(error.message);
                return;
            }

            const verifyLoadedStyles = async (): Promise<void> => {
                timer = undefined;
                if (styles.size === 0) {
                    return;
                }

                const css = Array.from(styles.values()).join("\n\n");

                try {
                    await processor.process(css, { from: undefined });
                    lastWarning = undefined;
                } catch (error) {
                    if (!(error instanceof Error)) {
                        server.config.logger.error(String(error));
                        return;
                    }

                    const message = error.message;
                    if (message === lastWarning) {
                        return;
                    }

                    server.config.logger.warn(message);
                    server.ws.send({
                        type: "error",
                        err: {
                            message,
                            stack: "",
                            plugin: "verify-variables:development",
                        },
                    });
                    lastWarning = message;
                }
            };

            scheduleVerification = () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                timer = setTimeout(() => {
                    void verifyLoadedStyles();
                }, 75);
            };

            server.watcher.on("unlink", (file) => {
                if (styles.delete(file)) {
                    scheduleVerification?.();
                }
            });
            server.watcher.on("unlinkDir", (directory) => {
                let removed = false;
                for (const id of styles.keys()) {
                    if (id.startsWith(`${directory}/`)) {
                        removed = styles.delete(id) || removed;
                    }
                }
                if (removed) {
                    scheduleVerification?.();
                }
            });
            server.httpServer?.once("close", () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                scheduleVerification = undefined;
            });
        },
        async transform(code, id) {
            const cssId = id.split("?", 1)[0];
            if (
                !/\.(?:css|pcss|postcss|sass|scss|less|styl|stylus)$/i.test(
                    cssId,
                )
            ) {
                return;
            }

            if (styles.get(cssId) === code) {
                return;
            }
            styles.set(cssId, code);
            scheduleVerification?.();
        },
    };
}

/**
 * Verify all generated Vite CSS assets together.
 */
export function verifyVarsVite(options: VerifyOptions = {}): Plugin[] {
    return [verifyOutput(options), verifyDevelopment(options)];
}
