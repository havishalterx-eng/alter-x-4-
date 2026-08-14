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
