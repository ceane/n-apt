import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../..");
const scannedRoots = [
  ".ladle",
  "src/ts",
  "src/app-article",
  "src/app-game",
  "src/app-legal",
  "test",
  "scripts",
];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const featureNamespaces = [
  "spectrum",
  "demodulation",
  "capture",
  "transmit",
  "maps",
  "learn",
  "three-d",
  "draw-signal",
  "classification",
  "settings",
  "sdr-test",
];
const namespaceRoots = [
  "src/ts/app",
  "src/ts/shared/ui",
  "src/ts/shared/math",
  "src/ts/shared/layout",
  ...featureNamespaces.map((feature) => `src/ts/features/${feature}`),
  "src/ts/agents",
  "src/ts/cli",
  "src/ts/consts",
  "src/ts/crypto",
  "src/ts/redux",
  "src/ts/types",
  "src/ts/validation",
  "src/ts/workers",
];

const collectFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".build") return [];
      return collectFiles(absolutePath);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [absolutePath] : [];
  });
};

const resolveSourceImport = (sourceFile: string, specifier: string): string | null => {
  const withoutQuery = specifier.split("?", 1)[0];
  const basePath = path.resolve(path.dirname(sourceFile), withoutQuery);
  const candidates = [
    basePath,
    ...[...sourceExtensions].map((extension) => `${basePath}${extension}`),
    ...[...sourceExtensions].map((extension) =>
      path.join(basePath, `index${extension}`),
    ),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const namespaceRootFor = (file: string): string | null => {
  const relativeFile = path.relative(workspaceRoot, file);
  return (
    namespaceRoots
      .filter(
        (namespaceRoot) =>
          relativeFile === namespaceRoot ||
          relativeFile.startsWith(`${namespaceRoot}/`),
      )
      .sort((left, right) => right.length - left.length)[0] ?? null
  );
};

describe("component architecture", () => {
  it("does not use the retired main component import surface", () => {
    const retiredComponentPrefix = ["@n-apt", "components"].join("/");
    const staleImports: string[] = [];

    for (const relativeRoot of scannedRoots) {
      for (const file of collectFiles(path.join(workspaceRoot, relativeRoot))) {
        const relativeFile = path.relative(workspaceRoot, file);
        const contents = fs.readFileSync(file, "utf8");
        if (contents.includes(retiredComponentPrefix)) {
          staleImports.push(relativeFile);
        }
      }
    }

    expect(staleImports).toEqual([]);
  });

  it("does not retain the retired components directory", () => {
    expect(fs.existsSync(path.join(workspaceRoot, "src/ts/components"))).toBe(false);
  });

  it("does not retain a root utils directory", () => {
    expect(fs.existsSync(path.join(workspaceRoot, "src/ts/utils"))).toBe(false);
  });

  it("keeps shared modules independent from feature modules", () => {
    const featureImport = new RegExp(
      `@n-apt/(?:${featureNamespaces.join("|")})(?:/|[\\"'])`,
    );
    const relativeFeatureImport = /(?:from|import)\s*["'](?:\.\.\/)+features\//;
    const violations: string[] = [];

    for (const relativeRoot of ["src/ts/shared/ui", "src/ts/shared/math", "src/ts/shared/layout"]) {
      for (const file of collectFiles(path.join(workspaceRoot, relativeRoot))) {
        const contents = fs.readFileSync(file, "utf8");
        if (featureImport.test(contents) || relativeFeatureImport.test(contents)) {
          violations.push(path.relative(workspaceRoot, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("requires cross-feature imports to use public feature entrypoints", () => {
    const featureImport = /@n-apt\/(spectrum|demodulation|capture|transmit|maps|learn|three-d|draw-signal|classification|settings|sdr-test)(\/[^"']+)?/g;
    const violations: string[] = [];

    for (const relativeRoot of ["src/ts/app", "src/ts/features"]) {
      for (const file of collectFiles(path.join(workspaceRoot, relativeRoot))) {
        const relativeFile = path.relative(workspaceRoot, file);
        const currentFeature = relativeFile.startsWith("src/ts/features/")
          ? relativeFile.slice("src/ts/features/".length).split("/")[0]
          : "app";
        const contents = fs.readFileSync(file, "utf8");
        for (const match of contents.matchAll(featureImport)) {
          if (
            currentFeature !== "app" &&
            match[2] &&
            match[2] !== "/public" &&
            !match[2]?.startsWith("/public/") &&
            match[1] !== currentFeature
          ) {
            violations.push(`${relativeFile}: ${match[0]}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps standalone applications in app-prefixed top-level roots", () => {
    const expectedApps = ["src/app-article", "src/app-game", "src/app-legal"];
    const legacyApps = [
      "src/md-preview",
      "src/tracked-interactive",
      "src/ts/legal-app",
    ];

    expect(expectedApps.every((app) => fs.existsSync(path.join(workspaceRoot, app)))).toBe(
      true,
    );
    expect(legacyApps.some((app) => fs.existsSync(path.join(workspaceRoot, app)))).toBe(
      false,
    );
  });

  it("keeps the learn interactive implementation inside the learn feature", () => {
    expect(
      fs.existsSync(
        path.join(workspaceRoot, "src/ts/features/learn/RadioWaves.tsx"),
      ),
    ).toBe(true);

    const staleImports: string[] = [];
    const retiredLearnImport = ["@n-apt/md-signals", "/src/app"].join("");
    for (const relativeRoot of ["src/ts", "test", "scripts", ".ladle"]) {
      for (const file of collectFiles(path.join(workspaceRoot, relativeRoot))) {
        const contents = fs.readFileSync(file, "utf8");
        if (contents.includes(retiredLearnImport)) {
          staleImports.push(path.relative(workspaceRoot, file));
        }
      }
    }
    expect(staleImports).toEqual([]);
  });

  it("uses owner-scoped hook imports", () => {
    const staleImports: string[] = [];
    const retiredHookImport = ["@n-apt", "hooks/"].join("/");
    for (const relativeRoot of scannedRoots) {
      for (const file of collectFiles(path.join(workspaceRoot, relativeRoot))) {
        const contents = fs.readFileSync(file, "utf8");
        if (contents.includes(retiredHookImport)) {
          staleImports.push(path.relative(workspaceRoot, file));
        }
      }
    }
    expect(staleImports).toEqual([]);
  });

  it("does not retain the retired root hooks directory", () => {
    expect(fs.existsSync(path.join(workspaceRoot, "src/ts/hooks"))).toBe(false);
  });

  it("does not retain the retired root routes directory", () => {
    expect(fs.existsSync(path.join(workspaceRoot, "src/ts/routes"))).toBe(false);
  });

  it("writes the frontend dist directory at repository top level", () => {
    const viteConfig = fs.readFileSync(
      path.join(workspaceRoot, "vite.config.js"),
      "utf8",
    );
    expect(viteConfig).toContain('outDir: path.resolve(dirname, "dist")');
    expect(viteConfig).not.toContain('outDir: "./dist"');
  });

  it("uses namespace imports across active source boundaries", () => {
    const relativeImport = /(?:from|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g;
    const violations: string[] = [];
    const files = [
      ...collectFiles(path.join(workspaceRoot, ".ladle")),
      ...collectFiles(path.join(workspaceRoot, "src/ts")),
      ...collectFiles(path.join(workspaceRoot, "test")),
      ...collectFiles(path.join(workspaceRoot, "scripts")),
    ];

    for (const file of files) {
      const sourceNamespace = namespaceRootFor(file);
      const contents = fs.readFileSync(file, "utf8");
      for (const match of contents.matchAll(relativeImport)) {
        const importedFile = resolveSourceImport(file, match[1]);
        if (!importedFile || !namespaceRootFor(importedFile)) continue;
        if (sourceNamespace !== namespaceRootFor(importedFile)) {
          violations.push(
            `${path.relative(workspaceRoot, file)}: ${match[1]}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
