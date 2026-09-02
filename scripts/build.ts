import { rm } from "node:fs/promises";

const OUT_DIR = "dist";
const EXTERNAL = ["@ai-sdk/provider", "@opencode-ai/plugin"];

await rm(OUT_DIR, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/entries/plugin.ts", "src/entries/sdk.ts"],
  outdir: OUT_DIR,
  target: "node",
  format: "esm",
  minify: true,
  splitting: false,
  sourcemap: "none",
  external: EXTERNAL,
  naming: "[name].js",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  console.error("\nBuild failed.");
  process.exit(1);
}

for (const output of result.outputs) {
  const kb = (output.size / 1024).toFixed(1);
  console.log(`  ${output.path.replace(`${process.cwd()}/`, "")}  ${kb} KB`);
}
