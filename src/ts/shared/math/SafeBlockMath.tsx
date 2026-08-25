import React from "react";
import { BlockMath } from "react-katex";
import { sanitizeLatex } from "@n-apt/math/katex-sanitize";

type Props = {
  math: string;
  displayMode?: boolean;
};

// Lightweight production-safe wrapper: strip invisible/combining characters
// before passing to KaTeX. No debug logging.
export const SafeBlockMath: React.FC<Props> = ({
  math,
  displayMode = true,
}) => {
  const safe = typeof math === "string" ? sanitizeLatex(math) : math;
  return <BlockMath math={safe} />;
};

export default SafeBlockMath;
