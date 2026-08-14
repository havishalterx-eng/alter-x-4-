import type { Benchmark, BenchmarkResult, BenchmarkDataset, BenchmarkMetricDefinition } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mockMetrics: BenchmarkMetricDefinition[] = [
  { id: "m_acc", name: "Accuracy", type: "accuracy", higherIsBetter: true },
  { id: "m_lat", name: "Latency", type: "latency", higherIsBetter: false },
  { id: "m_cost", name: "Cost", type: "cost", higherIsBetter: false },
  { id: "m_succ", name: "Success Rate", type: "success_rate", higherIsBetter: true }
]

const mockDatasets: BenchmarkDataset[] = [
  { id: "ds_1", name: "Support Evaluation Set Q3", caseCount: 150, description: "150 verified support emails with known categories and priority." },
  { id: "ds_2", name: "Invoice Extraction Samples", caseCount: 50, description: "50 diverse PDF invoices in multiple languages." }
]

const mockBenchmarks: Benchmark[] = [
  {
    id: "bm_1",
    name: "Support Classification Quality",
    description: "Evaluates the accuracy and cost of the core support triage workflow against our internal Q3 benchmark dataset.",
    targetType: "workflow",
    targetId: "wf_1",
    datasetId: "ds_1",
    metrics: [mockMetrics[0], mockMetrics[1], mockMetrics[2], mockMetrics[3]],
    createdAt: new Date(Date.now() - 10000000).toISOString(),
    updatedAt: new Date(Date.now() - 1000000).toISOString()
  }
]

const mockResults: Record<string, BenchmarkResult[]> = {
  "bm_1": [
    {
      id: "res_2",
      benchmarkId: "bm_1",
      targetId: "wf_1",
      version: "v4",
      status: "completed",
      caseCount: 150,
      passedCases: 142,
      failedCases: 8,
      metrics: [
        { metricId: "m_acc", value: 94.6 },
        { metricId: "m_lat", value: 1.8 },
        { metricId: "m_cost", value: 0.11 },
        { metricId: "m_succ", value: 98.2 }
      ],
      startedAt: new Date(Date.now() - 5000000).toISOString(),
      completedAt: new Date(Date.now() - 4900000).toISOString()
    },
    {
      id: "res_1",
      benchmarkId: "bm_1",
      targetId: "wf_1",
      version: "v3",
      status: "completed",
      caseCount: 150,
      passedCases: 132,
      failedCases: 18,
      metrics: [
        { metricId: "m_acc", value: 88.0 },
        { metricId: "m_lat", value: 2.1 },
        { metricId: "m_cost", value: 0.08 },
        { metricId: "m_succ", value: 92.1 }
      ],
      startedAt: new Date(Date.now() - 9000000).toISOString(),
      completedAt: new Date(Date.now() - 8900000).toISOString()
    }
  ]
}

export const benchmarksService = {
  list: async (): Promise<Benchmark[]> => {
    await delay(400)
    return mockBenchmarks
  },
  get: async (id: string): Promise<Benchmark> => {
    await delay(300)
    const bm = mockBenchmarks.find(b => b.id === id)
    if (!bm) throw new Error("Not found")
    return bm
  },
  create: async (data: Partial<Benchmark>): Promise<Benchmark> => {
    await delay(800)
    const newBm: Benchmark = {
      ...data,
      id: "bm_" + Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as Benchmark
    mockBenchmarks.unshift(newBm)
    mockResults[newBm.id] = []
    return newBm
  },
  run: async (id: string, _version?: string): Promise<BenchmarkResult> => {
    await delay(1200)
    const newRes: BenchmarkResult = {
      id: "res_" + Date.now(),
      benchmarkId: id,
      targetId: "wf_1",
      status: "completed",
      caseCount: 150,
      passedCases: 145,
      failedCases: 5,
      metrics: [
        { metricId: "m_acc", value: 96.6 },
        { metricId: "m_lat", value: 1.5 },
        { metricId: "m_cost", value: 0.12 },
        { metricId: "m_succ", value: 99.0 }
      ],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    }
    if (!mockResults[id]) mockResults[id] = []
    mockResults[id].unshift(newRes)
    return newRes
  },
  getResults: async (id: string): Promise<BenchmarkResult[]> => {
    await delay(400)
    return mockResults[id] || []
  },
  getDatasets: async (): Promise<BenchmarkDataset[]> => {
    await delay(300)
    return mockDatasets
  },
  getMetrics: async (): Promise<BenchmarkMetricDefinition[]> => {
    await delay(200)
    return mockMetrics
  }
}
