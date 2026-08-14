import { type SellerProfile, type MarketplaceListing, type MarketplacePayout } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mockProfile: SellerProfile = {
  id: "me",
  displayName: "My Workspace",
  status: "verified",
  joinedAt: "2026-07-01T00:00:00Z",
  rating: 4.8,
  listingCount: 2
}

const mockSellerListings: MarketplaceListing[] = [
  {
    id: "mkt_1",
    slug: "customer-support-triage",
    title: "AI Customer Support Triage",
    shortDescription: "Automatically categorizes, tags, and drafts replies for incoming support tickets.",
    description: "This workflow integrates with Zendesk or Intercom to process new tickets.",
    assetType: "workflow_template",
    category: "Customer Support",
    seller: { id: "me", displayName: "My Workspace", rating: 4.8 },
    pricing: { type: "free" },
    rating: 4.8,
    reviewCount: 128,
    installCount: 5430,
    tags: ["support", "zendesk", "triage"],
    status: "published",
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z"
  }
]

export const sellerService = {
  getProfile: async (): Promise<SellerProfile> => {
    await delay(300)
    return mockProfile
  },
  updateProfile: async (data: any): Promise<SellerProfile> => {
    await delay(500)
    return { ...mockProfile, ...data }
  },
  listings: {
    list: async (): Promise<MarketplaceListing[]> => {
      await delay(400)
      return mockSellerListings
    },
    create: async (data: any): Promise<MarketplaceListing> => {
      await delay(600)
      return {
        id: "mkt_new_" + Date.now(),
        slug: data.title.toLowerCase().replace(/ /g, '-'),
        title: data.title,
        shortDescription: data.shortDescription,
        description: data.description,
        assetType: data.assetType,
        category: data.category,
        seller: { id: "me", displayName: "My Workspace" },
        pricing: data.pricing || { type: "free" },
        tags: data.tags || [],
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    },
    update: async (_id: string, data: any) => {
      await delay(500)
      return { ...mockSellerListings[0], ...data }
    },
    submit: async (_id: string) => {
      await delay(800)
      return { success: true }
    },
    unpublish: async (_id: string) => {
      await delay(500)
      return { success: true }
    },
    delete: async (_id: string) => {
      await delay(500)
      return { success: true }
    }
  },
  earnings: {
    get: async () => {
      await delay(300)
      return {
        lifetime: 1450.00,
        currentPeriod: 320.00,
        pending: 120.00,
        paidOut: 1010.00,
        breakdown: [
          { listingId: "mkt_2", title: "Invoice Approval Automation", sales: 15, gross: 435.00, platformFee: 87.00, net: 348.00 }
        ]
      }
    }
  },
  payouts: {
    list: async (): Promise<MarketplacePayout[]> => {
      await delay(400)
      return [
        { id: "po_1", amount: 1010.00, currency: "USD", status: "paid", createdAt: "2026-07-01T00:00:00Z", paidAt: "2026-07-05T00:00:00Z" }
      ]
    },
    request: async (amount: number): Promise<MarketplacePayout> => {
      await delay(800)
      return { id: "po_" + Date.now(), amount, currency: "USD", status: "pending", createdAt: new Date().toISOString() }
    }
  }
}
