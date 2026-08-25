// Pure display and export helpers, kept out of app.js so they can be unit tested.

/** Format a number for a results table: 4 significant figures, exponent outside a readable range. */
export function fmt(v) {
  if (v == null || !isFinite(v)) return '—';
  if (v === 0) return '0';
  const mag = Math.abs(v);
  if (mag >= 1e-3 && mag < 1e5) {
    const s = v.toPrecision(4);
    // Only trim zeros that sit after a decimal point — never digits of an integer.
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }
  return v.toExponential(3);
}

/** Escape one CSV field, doubling embedded quotes per RFC 4180. */
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}
