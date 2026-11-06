/**
 * Numeri natel svizzeri: accetta "079 123 45 67", "+41 79 123 45 67", "0041791234567"…
 * e restituisce il formato internazionale +41791234567. Solo prefissi mobili 075–079.
 */
export function normalizeSwissMobile(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('41')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return /^7[5-9]\d{7}$/.test(digits) ? `+41${digits}` : null;
}

/** +41791234567 → "+41 79 123 45 67" */
export function formatSwissMobile(e164: string): string {
  const d = e164.replace(/^\+?41/, '');
  return `+41 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

/** Mostra solo le ultime due cifre: "+41 79 *** ** 67" */
export function maskSwissMobile(e164: string): string {
  const d = e164.replace(/^\+?41/, '');
  return `+41 ${d.slice(0, 2)} *** ** ${d.slice(7, 9)}`;
}
