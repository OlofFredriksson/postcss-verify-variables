import { build } from "tsdown";

await build({
    entry: ["src/index.ts", "src/vite.ts"],
    format: "esm",
    target: "node22",
    platform: "node",
    deps: { neverBundle: ["vite"] },
    dts: true,
    clean: true,
});
