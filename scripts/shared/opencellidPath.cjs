const path = require('node:path');

const US_MCC_CODES = new Set([310, 311, 312, 313, 314, 316, 330, 334]);

function resolveSafeMccCsvPath(baseDir, mcc, prefix = '') {
  const value = typeof mcc === 'string' && /^\d+$/.test(mcc) ? Number(mcc) : mcc;
  if (!Number.isInteger(value) || !US_MCC_CODES.has(value)) {
    throw new Error(`Unsupported MCC: ${String(mcc)}`);
  }

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, `${prefix}${value}.csv`);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('MCC path resolves outside its data directory');
  }
  return resolved;
}

module.exports = { resolveSafeMccCsvPath };
