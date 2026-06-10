import React from 'react';
import { InlineMath } from 'react-katex';
import { sanitizeLatex } from '../../utils/katex-sanitize';

type Props = {
  math: string;
};

export const SafeInlineMath: React.FC<Props> = ({ math }) => {
  const safe = typeof math === 'string' ? sanitizeLatex(math) : math;
  return <InlineMath math={safe} />;
};

export default SafeInlineMath;
