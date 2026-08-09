import type { Parent } from "mdast";

type MdastNode = {
  type?: string;
  children?: unknown[];
};

type Visitor<TNode> = (node: TNode, index: number, parent: Parent) => number | void;

export const visitMdastNodes = <TNode extends MdastNode>(
  node: unknown,
  targetType: string,
  visitor: Visitor<TNode>,
) => {
  if (!node || typeof node !== "object") {
    return;
  }

  const parent = node as Parent & MdastNode;
  const children = parent.children;
  if (!Array.isArray(children)) {
    return;
  }

  for (let index = 0; index < children.length;) {
    const child = children[index] as MdastNode | undefined;
    if (child?.type === targetType) {
      const nextIndex = visitor(child as TNode, index, parent);
      index = typeof nextIndex === "number" ? nextIndex : index + 1;
      continue;
    }

    visitMdastNodes<TNode>(child, targetType, visitor);
    index += 1;
  }
};
