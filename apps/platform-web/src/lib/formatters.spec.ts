import { describe, expect, it } from "vitest"
import { formatListingPrice } from "./formatters"
import { usePreferencesStore } from "@/features/settings/stores/usePreferencesStore"

describe("What a listing costs", () => {
  it("shows an API price exactly as the API states it", () => {
    // 49900 paise is 499 rupees. The demo currency switcher multiplies by a
    // mock rate, which turned this into 41,666.50 on every listing screen.
    usePreferencesStore.setState({ currency: "INR" })

    expect(formatListingPrice({ type: "paid", price: 499, currency: "INR", priceMinor: "49900" })).toBe(
      "₹499.00",
    )
  })

  it("does not convert an API price when the display currency differs", () => {
    usePreferencesStore.setState({ currency: "USD" })

    expect(formatListingPrice({ type: "paid", price: 499, currency: "INR", priceMinor: "49900" })).toBe(
      "₹499.00",
    )
  })

  it("keeps the mock-money behaviour for demo listings, which carry no minor amount", () => {
    usePreferencesStore.setState({ currency: "USD" })

    expect(formatListingPrice({ type: "paid", price: 29, currency: "USD" })).toBe("$29.00")
  })

  it("says Free rather than an amount", () => {
    expect(formatListingPrice({ type: "free" })).toBe("Free")
  })
})
