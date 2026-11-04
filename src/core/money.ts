/**
 * The game's currency is fictional: the sigil (§). Every price, budget and reward
 * is shown through money(), so it can be renamed here in one place.
 */
export const CURRENCY = { name: 'sigil', plural: 'sigils', symbol: '§' } as const;

/** Formats an amount, e.g. money(12000) → "§12,000". */
export function money(amount: number): string {
  return `${CURRENCY.symbol}${Math.round(amount).toLocaleString()}`;
}
