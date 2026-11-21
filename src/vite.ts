import type { ErrorPayload, Plugin } from "vite";
import postcss, { CssSyntaxError } from "postcss";
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

function sourceLocation(
    error: CssSyntaxError,
    styles: Array<[string, string]>,
): ErrorPayload["err"]["loc"] {
    if (!error.input) {
        return;
    }

    let line = error.input.line;
    for (const [file, css] of styles) {
        const lines = (css.match(/\n/g)?.length ?? 0) + 1;
        if (line <= lines) {
            return { file, line, column: error.input.column };
        }
        line -= lines + 1;
    }
}

function verifyDevelopment(options: VerifyOptions): Plugin {
    const styles = new Map<string, string>();
    let scheduleVerification: (() => void) | undefined;

    return {
        name: "verify-variables:development",
        apply: "serve",
        configureServer(server) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let activeError: ErrorPayload | undefined;

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
                    activeError = undefined;
                    return;
                }

                const sources = Array.from(styles);
                const css = sources.map(([, code]) => code).join("\n\n");

                try {
                    await processor.process(css, { from: undefined });
                    activeError = undefined;
                } catch (error) {
                    if (!(error instanceof Error)) {
                        server.config.logger.error(String(error));
                        return;
                    }

                    const location =
                        error instanceof CssSyntaxError
                            ? sourceLocation(error, sources)
                            : undefined;
                    const reason =
                        error instanceof CssSyntaxError
                            ? error.reason
                            : error.message;
                    const preprocessed =
                        location?.file &&
                        /\.(?:sass|scss|less|styl|stylus)$/i.test(
                            location.file,
                        );
                    let message = error.message;
                    if (location) {
                        const position = `${location.line}:${location.column}`;
                        const source = preprocessed
                            ? `${location.file} (processed CSS:${position})`
                            : `${location.file}:${position}`;
                        message = `${source}: ${reason}`;
                    }
                    if (message === activeError?.err.message) {
                        return;
                    }

                    server.config.logger.warn(message);
                    activeError = {
                        type: "error",
                        err: {
                            message,
                            stack: "",
                            plugin: "verify-variables:development",
                            id: location?.file,
                            loc: preprocessed ? undefined : location,
                        },
                    };
                    if (server.ws.clients.size > 0) {
                        server.ws.send(activeError);
                    }
                }
            };

            server.ws.on("vite:client:connect", (_data, client) => {
                if (activeError) {
                    client.send(activeError);
                }
            });

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
                ) ||
                /[?&](?:worker|sharedworker|raw|url)\b/.test(id)
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
