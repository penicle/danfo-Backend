/**
 * Types for the fee calculation pipeline.
 */

/**
 * ISO 4217 currency code (e.g. "USD", "EUR", "JPY").
 * Stored as a string to support all standard and future codes.
 */
export type CurrencyCode = string

/**
 * A monetary amount with its currency.
 * `amount` is a decimal string (e.g. "10.50") to preserve precision
 * across serialisation boundaries; never a raw JavaScript number.
 */
export interface Money {
  /** Decimal string representation of the amount (e.g. "10.50"). */
  amount: string
  /** ISO 4217 currency code. */
  currency: CurrencyCode
}

/**
 * Input for a single fee calculation step.
 */
export interface FeeInput {
  /** Base amount to apply the fee to. */
  base: Money
  /**
   * Fee rate expressed as a percentage string (e.g. "2.5" means 2.5 %).
   * Must be a non-negative decimal string.
   */
  ratePercent: string
}

/**
 * Result of a fee calculation, broken down into its components.
 */
export interface FeeResult {
  /** The original base amount, unchanged. */
  baseAmount: Money
  /** The computed fee amount (rounded to the currency's minor unit). */
  feeAmount: Money
  /** Base amount plus fee amount. */
  totalAmount: Money
}

/**
 * Minor-unit scale (number of decimal places) for common ISO 4217 currencies.
 *
 * - 0 decimal places: JPY, KRW (no minor unit)
 * - 2 decimal places: USD, EUR, GBP, CAD, AUD, CHF, MXN, BRL, SGD, HKD, SEK, NOK, DKK, ZAR, INR
 * - 3 decimal places: KWD, BHD, OMR, JOD (Kuwaiti / Bahraini / Omani / Jordanian)
 *
 * Used to determine the correct rounding scale for each currency.
 */
export const CURRENCY_SCALES: Readonly<Record<string, number>> = {
  // Zero decimal places
  JPY: 0,
  KRW: 0,
  // Two decimal places (default)
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  MXN: 2,
  BRL: 2,
  SGD: 2,
  HKD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  ZAR: 2,
  INR: 2,
  // Three decimal places
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
}

/** Fallback scale for currencies not listed in CURRENCY_SCALES. */
export const DEFAULT_CURRENCY_SCALE = 2

/**
 * Return the minor-unit scale for a currency code.
 * Falls back to DEFAULT_CURRENCY_SCALE for unknown codes.
 */
export function getCurrencyScale(currency: CurrencyCode): number {
  return CURRENCY_SCALES[currency] ?? DEFAULT_CURRENCY_SCALE
}
