import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../..");
const legacyField = ["supports", "_raw_iq_stream"].join("");

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(ts|tsx|rs)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("IQ capability contract", () => {
  test("production source does not contain the removed raw-IQ capability flag", () => {
    const productionFiles = [
      ...sourceFiles(path.join(repositoryRoot, "src", "ts")),
      ...sourceFiles(path.join(repositoryRoot, "src", "rs")),
    ];
    const offenders = productionFiles.filter((file) =>
      fs.readFileSync(file, "utf8").includes(legacyField),
    );

    expect(offenders).toEqual([]);
  });
});
