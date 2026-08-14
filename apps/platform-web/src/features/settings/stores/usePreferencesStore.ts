import { create } from "zustand"
import { persist } from "zustand/middleware"
import { type DisplayCurrency } from "@/api/types"

interface PreferencesState {
  currency: DisplayCurrency
  setCurrency: (currency: DisplayCurrency) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      currency: "USD",
      setCurrency: (currency) => set({ currency }),
    }),
    {
      name: "ax-preferences",
    }
  )
)
