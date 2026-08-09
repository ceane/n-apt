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
  if (process.env.NODE_ENV === "development") {
    try {
      const before = typeof math === "string" ? math : String(math);
      const beforeHex = Array.from(before)
        .map((c) => c.codePointAt(0)?.toString(16).padStart(4, "0"))
        .join(" ");
      const afterHex = Array.from(String(safe))
        .map((c) => c.codePointAt(0)?.toString(16).padStart(4, "0"))
        .join(" ");
      // eslint-disable-next-line no-console
      console.debug("[SafeBlockMath] math length", {
        beforeLength: before.length,
        afterLength: String(safe).length,
        beforeHex: beforeHex.slice(0, 400),
        afterHex: afterHex.slice(0, 400),
        before,
        after: safe,
      });
    } catch (e) {
      // ignore
    }
  }
  return <BlockMath math={safe} />;
};

export default SafeBlockMath;
