import type { UseCase } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mockUseCases: UseCase[] = [
  {
    id: "uc_1",
    title: "Customer Support Triage",
    description: "Automatically analyze incoming support emails, categorize them, extract key entities, and route to the correct human agent.",
    category: "Customer Support",
    audience: ["Support Leads", "Operations"],
    outcome: ["Reduce initial response time", "Automate manual tagging"],
    difficulty: "starter",
    estimatedSetupMinutes: 15,
    workflowTemplateId: "wf_tpl_support_triage",
    starterPrompt: "I want to automate customer support triage for my Zendesk inbox."
  },
  {
    id: "uc_2",
    title: "Sales Lead Qualification",
    description: "Enrich inbound leads using web research, score their intent based on form submissions, and alert the sales team in Slack.",
    category: "Sales",
    audience: ["Sales Ops", "SDRs"],
    outcome: ["Increase conversion rate", "Save SDR research time"],
    difficulty: "intermediate",
    estimatedSetupMinutes: 30,
    projectTemplateId: "proj_tpl_lead_qual"
  },
  {
    id: "uc_3",
    title: "Competitor Landscape Analysis",
    description: "Periodically crawl competitor websites and press releases to generate a weekly intelligence digest.",
    category: "Marketing",
    audience: ["Product Marketing", "Strategy"],
    outcome: ["Stay ahead of market trends", "Automate research"],
    difficulty: "advanced",
    estimatedSetupMinutes: 45,
    starterPrompt: "Build a workflow to monitor competitor websites and summarize changes."
  },
  {
    id: "uc_4",
    title: "Invoice Processing Pipeline",
    description: "Extract line items from PDF invoices sent to finance, match them against purchase orders, and sync to the ERP.",
    category: "Finance",
    difficulty: "intermediate",
    estimatedSetupMinutes: 30,
    workflowTemplateId: "wf_tpl_invoice"
  },
  {
    id: "uc_5",
    title: "Employee Onboarding Assistant",
    description: "Create an interactive Slack bot that answers new hire questions using company HR policies and knowledge base.",
    category: "HR",
    difficulty: "starter",
    estimatedSetupMinutes: 10,
    starterPrompt: "I need an HR onboarding bot connected to our Notion wiki."
  }
]

export const discoveryService = {
  listUseCases: async (): Promise<UseCase[]> => {
    await delay(400)
    return mockUseCases
  },
  getRecommendations: async (): Promise<UseCase[]> => {
    await delay(300)
    // Mock recommendations, return top 3
    return mockUseCases.slice(0, 3)
  }
}
