import katex from 'katex';

function lintKatex(expr: string) {
  try {
    katex.renderToString(expr, { 
      throwOnError: true, 
      displayMode: true, 
      strict: "error" // Throw on warnings too!
    });
    return [];
  } catch (e: any) {
    return [e.message];
  }
}

const EQ1 = "s(t) = A \\cos(2\\pi f_c t + k_f \\int m(t) dt)";
const EQ2 = "m(t) = \\frac{1}{k_f} \\frac{d}{dt} [\\text{phase}(s(t))]";
const EQ3 = "m_f(t) = \\text{BPF}\\{m(t)\\}";
const EQ_WHERE = "a(t) = |m_f(t)|";
const EQ_MULTI = "I(x,y) = \\int_{-\\infty}^{\\infty} a(t) \\cdot \\delta(t - \\tau(x,y)) \\, dt";
const EQ_DB = "F";
const EQ_BEAT = "B";

const expressions = {
  EQ1,
  EQ2,
  EQ3,
  EQ_WHERE,
  EQ_MULTI,
  EQ_DB,
  EQ_BEAT
};

let hasErrors = false;

for (const [name, expr] of Object.entries(expressions)) {
  const errors = lintKatex(expr);
  if (errors.length > 0) {
    console.error(`❌ ${name} failed:`);
    errors.forEach(err => console.error(`  - ${err}`));
    hasErrors = true;
  } else {
    console.log(`✅ ${name} passed.`);
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log('All KaTeX expressions are valid.');
}
