import path from "node:path";

export function isRustSourceChange(root: string, filename?: string | Buffer): boolean {
  if (!filename) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedFilename = path.resolve(resolvedRoot, filename.toString());
  const relative = path.relative(resolvedRoot, resolvedFilename);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;

  return path.extname(resolvedFilename) === ".rs" || path.basename(resolvedFilename) === "Cargo.toml";
}
