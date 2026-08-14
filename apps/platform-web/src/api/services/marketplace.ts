import { type MarketplaceListing, type MarketplaceAssetInstallation, type MarketplaceReview } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mockListings: MarketplaceListing[] = [
  {
    id: "mkt_1",
    slug: "customer-support-triage",
    title: "AI Customer Support Triage",
    shortDescription: "Automatically categorizes, tags, and drafts replies for incoming support tickets.",
    description: "This workflow integrates with Zendesk or Intercom to process new tickets. It uses advanced reasoning to classify the issue, extract key entities, and draft a response based on your knowledge base.",
    assetType: "workflow_template",
    category: "Customer Support",
    seller: { id: "sel_1", displayName: "AlterX Labs", rating: 4.9 },
    pricing: { type: "free" },
    rating: 4.8,
    reviewCount: 128,
    installCount: 5430,
    tags: ["support", "zendesk", "triage"],
    status: "published",
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z"
  },
  {
    id: "mkt_2",
    slug: "invoice-approval-automation",
    title: "Invoice Approval Automation",
    shortDescription: "Extracts invoice data and routes for approval in Slack.",
    description: "Reads incoming PDF invoices, uses OCR to extract line items, and sends an approval request via Slack. Once approved, it can log the entry in an ERP.",
    assetType: "workflow_template",
    category: "Finance",
    seller: { id: "sel_2", displayName: "Acme Automation", rating: 4.5 },
    pricing: { type: "paid", price: 29, currency: "USD" },
    rating: 4.6,
    reviewCount: 45,
    installCount: 890,
    tags: ["finance", "ocr", "slack"],
    status: "published",
    createdAt: "2026-03-10T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z"
  },
  {
    id: "mkt_3",
    slug: "lead-research-pipeline",
    title: "Lead Research Pipeline",
    shortDescription: "Enriches leads from CRM by scraping public data and synthesizing account profiles.",
    description: "Takes a company name from HubSpot/Salesforce, searches the web, analyzes their recent news, and generates a comprehensive sales brief.",
    assetType: "workflow_template",
    category: "Sales",
    seller: { id: "sel_3", displayName: "FlowForge Studio", rating: 4.7 },
    pricing: { type: "paid", price: 49, currency: "USD" },
    rating: 4.9,
    reviewCount: 210,
    installCount: 1200,
    tags: ["sales", "research", "enrichment"],
    status: "published",
    createdAt: "2026-02-05T00:00:00Z",
    updatedAt: "2026-08-05T00:00:00Z"
  },
  {
    id: "mkt_4",
    slug: "competitor-research-project",
    title: "Competitor Research Project",
    shortDescription: "A complete project template for continuous competitor monitoring.",
    description: "Sets up phases for identifying competitors, tracking their social media, scraping pricing changes, and compiling weekly intelligence reports.",
    assetType: "project_template",
    category: "Research",
    seller: { id: "sel_1", displayName: "AlterX Labs", rating: 4.9 },
    pricing: { type: "free" },
    rating: 4.7,
    reviewCount: 88,
    installCount: 3400,
    tags: ["research", "competitor", "monitoring"],
    status: "published",
    createdAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-05-30T00:00:00Z"
  }
]

const mockMyAssets: MarketplaceAssetInstallation[] = [
  {
    id: "inst_1",
    listingId: "mkt_1",
    workspaceId: "ws_default",
    installedAt: "2026-07-15T10:00:00Z",
    installedVersion: "1.2.0",
    createdWorkflowId: "wf_1"
  }
]

const mockReviews: MarketplaceReview[] = [
  {
    id: "rev_1",
    listingId: "mkt_1",
    author: { id: "u_1", name: "Sarah Connor" },
    rating: 5,
    title: "Game changer for our support team",
    body: "This template saved us hours of manual triage every week. Highly recommended!",
    createdAt: "2026-07-20T00:00:00Z"
  },
  {
    id: "rev_2",
    listingId: "mkt_1",
    author: { id: "u_2", name: "John Smith" },
    rating: 4,
    title: "Good, but needed tweaks",
    body: "Works well out of the box but we had to adjust the prompt for our specific product terminology.",
    createdAt: "2026-06-15T00:00:00Z"
  }
]

export const marketplaceService = {
  listings: {
    list: async (filters?: any): Promise<MarketplaceListing[]> => {
      await delay(400)
      if (filters?.q) {
        const q = filters.q.toLowerCase()
        return mockListings.filter(l => l.title.toLowerCase().includes(q) || l.shortDescription.toLowerCase().includes(q) || l.tags.includes(q))
      }
      return mockListings
    },
    get: async (id: string): Promise<MarketplaceListing> => {
      await delay(300)
      const listing = mockListings.find(l => l.id === id || l.slug === id)
      if (!listing) throw new Error("Listing not found")
      return listing
    }
  },
  search: async (query: string): Promise<MarketplaceListing[]> => {
    await delay(300)
    const q = query.toLowerCase()
    return mockListings.filter(l => l.title.toLowerCase().includes(q) || l.tags.includes(q))
  },
  install: async (_id: string) => {
    await delay(1200)
    return { success: true }
  },
  purchase: async (_id: string) => {
    await delay(1500)
    return { success: true }
  },
  myAssets: {
    list: async (): Promise<MarketplaceAssetInstallation[]> => {
      await delay(400)
      return mockMyAssets
    }
  },
  reviews: {
    list: async (listingId: string): Promise<MarketplaceReview[]> => {
      await delay(300)
      return mockReviews.filter(r => r.listingId === listingId)
    },
    create: async (listingId: string, data: any): Promise<MarketplaceReview> => {
      await delay(600)
      return {
        id: "rev_" + Date.now(),
        listingId,
        author: { id: "u_me", name: "You" },
        rating: data.rating,
        title: data.title,
        body: data.body,
        createdAt: new Date().toISOString()
      }
    }
  }
}
