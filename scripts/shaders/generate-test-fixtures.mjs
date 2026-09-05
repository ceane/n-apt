import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
// Fixtures are generated directly from the canonical WGSL sources that ship
// with the app (src/ts/shaders, loaded at runtime via vite-plugin-glsl), so
// the tests always validate exactly what runs.
const SOURCE_FILES = [
  {
    input: "src/ts/shaders/spectrum.wgsl",
    output: "test/ts/shaders/generated/spectrum.wgsl",
  },
  {
    input: "src/ts/shaders/waterfall3d_vertex.wgsl",
    output: "test/ts/shaders/generated/waterfall3d_vertex.wgsl",
  },
  {
    input: "src/ts/shaders/waterfall3d_fragment.wgsl",
    output: "test/ts/shaders/generated/waterfall3d_fragment.wgsl",
  },
  {
    input: "src/ts/shaders/fft_compute.wgsl",
    output: "test/ts/shaders/generated/fft_compute.wgsl",
  },
  {
    input: "src/ts/shaders/waterfall_retune.wgsl",
    output: "test/ts/shaders/generated/waterfall_retune.wgsl",
  },
];

for (const spec of SOURCE_FILES) {
  const sourcePath = join(ROOT, spec.input);
  const outputPath = join(ROOT, spec.output);
  const extracted = readFileSync(sourcePath, "utf8");
  const formatted = formatWgsl(extracted);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${formatted}\n`, "utf8");
  console.log(`wrote ${spec.output}`);
}

function formatWgsl(input) {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map((line) => line.slice(minIndent).replace(/[ \t]+$/g, ""))
    .join("\n");
}
