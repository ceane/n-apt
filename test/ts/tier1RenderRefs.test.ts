import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "@typescript/typescript6";

const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(join(process.cwd(), file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const ancestorsOf = (node: ts.Node): ts.Node[] =>
  node.parent ? [node.parent, ...ancestorsOf(node.parent)] : [];

const collect = (root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] => {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
};

const layoutOwner = (node: ts.Node) =>
  ancestorsOf(node).find((parent) =>
    ts.isCallExpression(parent) && parent.expression.getText() === "useLayoutEffect",
  );

describe("Tier 1 commit-phase ref boundaries", () => {
  it.each([
    ["scripts/build/build-orchestrator.tsx", ["updateProcessStatusRef", "executeForegroundCommandRef", "startBackgroundProcessRef", "addLogRef", "writeRebuildStatusRef"]],
    ["src/ts/app/routes/pages/SpectrumRoute.tsx", ["setLiveFrequencyRangeRef", "sendLiveFrequencyRangeRef"]],
    ["src/ts/features/spectrum/hooks/useSpectrumInteraction.ts", ["isPausedRef", "onFrequencyRangeChangeRef", "onDragRepaintRef"]],
  ] as const)("publishes latest mirrors only in layout effects: %s", (file, refs) => {
    const root = parse(file);
    for (const ref of refs) {
      const writes = collect(root, (node) => ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === `${ref}.current`);
      expect(writes).toHaveLength(1);
      expect(layoutOwner(writes[0])).toBeDefined();
    }
  });

  it("commits the complete leaving-source transaction before passive restoration", () => {
    const root = parse("src/ts/features/spectrum/hooks/useSpectrumStore.tsx");
    const snapshots = collect(root, (node) => ts.isCallExpression(node) && node.expression.getText() === "resolveLeavingSourceViewSnapshot");
    expect(snapshots).toHaveLength(1);
    const effect = layoutOwner(snapshots[0]);
    expect(effect).toBeDefined();
    expect(effect?.getText()).toContain("saveStoredJson(");
    expect(effect?.getText()).toContain("previousSelectedSourceIdForViewRef.current = selectedSourceId || null");
    expect(effect?.getText()).toContain("previousSourceViewKey: selectedSourceViewKeyRef.current");
  });

  it("hydrates SDR settings with lazy reactive state instead of render-time refs", () => {
    const root = parse("src/ts/features/spectrum/hooks/useSpectrumStore.tsx");
    expect(root.getText()).not.toContain("cachedSdrSettingsRef");
    expect(root.getText()).not.toContain("cachedSdrSettingsHydratedRef");
    const state = collect(root, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "[cachedSdrSettings, setCachedSdrSettings]")[0] as ts.VariableDeclaration;
    expect(state).toBeDefined();
    const call = state.initializer as ts.CallExpression;
    expect(call.expression.getText()).toBe("useState");
    expect(ts.isArrowFunction(call.arguments[0])).toBe(true);
  });

  it("collapses the sidebar directly without changing listener dependencies", () => {
    const root = parse("src/ts/features/spectrum/sidebar/SpectrumSidebar.tsx");
    expect(root.getText()).not.toContain("sourceListExpandedRef");
    const update = collect(root, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "updateStickyState")[0];
    const setters = collect(update, (node) => ts.isCallExpression(node) && node.expression.getText() === "setSourceListExpanded");
    expect(setters).toHaveLength(1);
    expect(setters[0].getText()).toBe("setSourceListExpanded(false)");
    expect(ancestorsOf(setters[0]).some((node) => ts.isIfStatement(node))).toBe(false);
    const effect = ancestorsOf(update).find((node) => ts.isCallExpression(node) && node.expression.getText() === "useEffect") as ts.CallExpression;
    expect(effect.arguments[1].getText()).toBe("[isSticky]");
  });
});
