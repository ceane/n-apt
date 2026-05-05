import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" fill="red">
    <animate attributeName="opacity" values="0;1;0" dur="1s" repeatCount="indefinite" />
  </rect>
  <script>alert(1)</script>
</svg>
`;

const sanitized = purify.sanitize(svg, {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['animate', 'animateMotion', 'animateTransform', 'mpath', 'set'],
  ADD_ATTR: ['attributeName', 'values', 'dur', 'repeatCount', 'begin', 'from', 'to', 'keyTimes', 'keySplines', 'calcMode'],
  RETURN_TRUSTED_TYPE: false,
});

console.log('--- Original ---');
console.log(svg);
console.log('--- Sanitized ---');
console.log(sanitized);
