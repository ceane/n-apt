import React from "react";
import { InlineMath } from "react-katex";
import { sanitizeLatex } from "../../utils/katex-sanitize";

type Props = {
  math: string;
};

export const SafeInlineMath: React.FC<Props> = ({ math }) => {
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
      console.debug("[SafeInlineMath] math", {
        beforeHex: beforeHex.slice(0, 200),
        afterHex: afterHex.slice(0, 200),
        before,
        after: safe,
      });
    } catch (e) {
      // ignore
    }
  }
  return <InlineMath math={safe} />;
};

export default SafeInlineMath;
