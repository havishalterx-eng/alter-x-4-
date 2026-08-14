import { type GlobalSearchResult } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mockGlobalResults: GlobalSearchResult[] = [
  { id: "wf_1", type: "workflow", title: "Customer Support Triage", description: "Categorize incoming tickets", url: "/app/workflows/wf_1" },
  { id: "wf_2", type: "workflow", title: "Invoice Processing", description: "Extract data from invoices", url: "/app/workflows/wf_2" },
  { id: "proj_1", type: "project", title: "Competitor Analysis", description: "Q3 Competitor tracking", url: "/app/projects/proj_1" },
  { id: "ks_1", type: "knowledge_source", title: "Company Wiki", description: "Internal confluence docs", url: "/app/knowledge/sources/ks_1" },
  { id: "conn_1", type: "connection", title: "Zendesk Prod", description: "Main Zendesk integration", url: "/app/connections/conn_1" },
  { id: "mkt_1", type: "marketplace_listing", title: "AI Customer Support Triage", description: "Template from AlterX Labs", url: "/app/marketplace/listings/mkt_1" },
]

export const globalSearchService = async (query: string): Promise<GlobalSearchResult[]> => {
  await delay(300)
  if (!query) return []
  const q = query.toLowerCase()
  return mockGlobalResults.filter(r => r.title.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
}
