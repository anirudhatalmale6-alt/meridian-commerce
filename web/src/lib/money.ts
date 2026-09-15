/**
 * Money formatting. The API speaks integer cents and so does this app; the
 * conversion to a human string happens here and nowhere else.
 *
 * Nothing in the frontend ever does arithmetic on a formatted string, and
 * nothing multiplies a float price by a quantity — line totals come from the
 * server precisely so the number on the cart cannot disagree with the number
 * on the invoice.
 */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    // Explicit, so a whole-dollar price renders "$69.00" and not "$69" —
    // a price list with inconsistent decimal places looks broken.
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
