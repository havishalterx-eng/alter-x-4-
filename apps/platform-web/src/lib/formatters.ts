import { usePreferencesStore } from "@/features/settings/stores/usePreferencesStore"

const MOCK_DISPLAY_FX: Record<string, number> = {
  USD: 1,
  INR: 83.5,
}

export function formatCurrency(amount: number, forceCurrency?: string): string {
  // Try to get currency from store outside of React context safely
  let currency = "USD"
  try {
    currency = usePreferencesStore.getState().currency
  } catch (e) {
    // fallback if store not initialized
  }
  
  if (forceCurrency) {
    currency = forceCurrency
  }

  const convertedAmount = amount * (MOCK_DISPLAY_FX[currency] || 1)

  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(convertedAmount)
}

/**
 * What a listing costs.
 *
 * A price that came from the API is already in its own currency, so it is
 * formatted from its minor units and never touched by the demo currency
 * switcher's mock rate -- which was turning a 499 rupee listing into 41,666.50.
 * Demo listings carry no minor amount and keep the mock-money behaviour.
 */
export function formatListingPrice(pricing: {
  type: "free" | "paid"
  price?: number
  currency?: string
  priceMinor?: string
}): string {
  if (pricing.type === "free") return "Free"
  if (pricing.priceMinor !== undefined) {
    return formatMinorCurrency(pricing.priceMinor, pricing.currency ?? "INR")
  }
  return formatCurrency(pricing.price ?? 0, pricing.currency)
}

/** Format the provider's minor-unit amount without applying the mock display FX rate. */
export function formatMinorCurrency(amountMinor: string, currency: string): string {
  if (!/^\d+$/.test(amountMinor)) throw new Error("Invalid minor-unit amount")
  const minor = BigInt(amountMinor)
  const whole = minor / 100n
  const fraction = (minor % 100n).toString().padStart(2, "0")
  const formatter = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return formatter.formatToParts(whole).map(part => part.type === "fraction" ? fraction : part.value).join("")
}

export function formatCompactNumber(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount)
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat("en-US").format(amount)
}

export function formatPercentage(amount: number, total: number): string {
  if (total === 0) return "0%"
  const ratio = amount / total
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(ratio)
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}
