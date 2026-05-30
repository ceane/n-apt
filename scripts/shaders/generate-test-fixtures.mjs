import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const SOURCE_FILES = [
  {
    input: "src/ts/consts/shaders/spectrum.ts",
    output: "test/ts/shaders/generated/spectrum.wgsl",
    exportName: "SPECTRUM_SHADER",
  },
  {
    input: "src/ts/consts/shaders/waterfall3d.ts",
    output: "test/ts/shaders/generated/waterfall3d_vertex.wgsl",
    exportName: "WATERFALL_3D_VERTEX_SHADER",
  },
  {
    input: "src/ts/consts/shaders/waterfall3d.ts",
    output: "test/ts/shaders/generated/waterfall3d_fragment.wgsl",
    exportName: "WATERFALL_3D_FRAGMENT_SHADER",
  },
  {
    input: "src/ts/consts/shaders/fft_compute.ts",
    output: "test/ts/shaders/generated/fft_compute.wgsl",
    exportName: "FFT_COMPUTE_SHADER",
  },
  {
    input: "src/ts/consts/shaders/waterfall_retune.ts",
    output: "test/ts/shaders/generated/waterfall_retune.wgsl",
    exportName: "WATERFALL_RETUNE_WGSL",
  },
];

for (const spec of SOURCE_FILES) {
  const sourcePath = join(ROOT, spec.input);
  const outputPath = join(ROOT, spec.output);
  const source = readFileSync(sourcePath, "utf8");
  const extracted = extractWgslExport(source, spec.exportName);
  const formatted = formatWgsl(extracted);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${formatted}\n`, "utf8");
  console.log(`wrote ${spec.output}`);
}

function extractWgslExport(source, exportName) {
  const marker = `export const ${exportName} = /* wgsl */ \``;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find ${exportName}`);
  }

  const bodyStart = start + marker.length;
  const end = source.indexOf("`;", bodyStart);
  if (end < 0) {
    throw new Error(`Could not find end of ${exportName}`);
  }

  return source.slice(bodyStart, end);
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
