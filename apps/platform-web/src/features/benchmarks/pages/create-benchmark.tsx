import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { toast } from "sonner"

export function CreateBenchmarkPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: workflows = [] } = useQuery({
    queryKey: queryKeys.workflows.all,
    queryFn: () => api.getWorkflows(),
  })

  const { data: datasets = [] } = useQuery({
    queryKey: ["benchmarkDatasets"],
    queryFn: () => api.benchmarks.getDatasets(),
  })

  const { data: metrics = [] } = useQuery({
    queryKey: ["benchmarkMetrics"],
    queryFn: () => api.benchmarks.getMetrics(),
  })

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [targetId, setTargetId] = useState("")
  const [datasetId, setDatasetId] = useState("")
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([])

  const createBenchmark = useMutation({
    mutationFn: async () => {
      const selectedMetricDefs = metrics.filter(m => selectedMetrics.includes(m.id))
      return api.benchmarks.create({
        name,
        description,
        targetType: "workflow",
        targetId,
        datasetId,
        metrics: selectedMetricDefs
      })
    },
    onSuccess: (newBm) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.benchmarks.list })
      toast.success("Benchmark created successfully")
      navigate(`/app/benchmarks/${newBm.id}`)
    },
    onError: () => {
      toast.error("Failed to create benchmark")
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !targetId || !datasetId || selectedMetrics.length === 0) {
      toast.error("Please fill all required fields")
      return
    }
    createBenchmark.mutate()
  }

  const toggleMetric = (id: string) => {
    setSelectedMetrics(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader 
        title="Create Benchmark" 
        description="Define a new evaluation suite for a workflow or project."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <div className="space-y-2">
            <Label htmlFor="name">Benchmark Name <span className="text-danger">*</span></Label>
            <Input 
              id="name" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="e.g. Support Classification Quality" 
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea 
              id="description" 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              placeholder="What is being evaluated?"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target">Target Workflow <span className="text-danger">*</span></Label>
            <select 
              id="target"
              className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              required
            >
              <option value="" disabled>Select a workflow</option>
              {workflows.map(wf => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dataset">Test Dataset <span className="text-danger">*</span></Label>
            <select 
              id="dataset"
              className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              value={datasetId}
              onChange={e => setDatasetId(e.target.value)}
              required
            >
              <option value="" disabled>Select an evaluation dataset</option>
              {datasets.map(ds => (
                <option key={ds.id} value={ds.id}>{ds.name} ({ds.caseCount} cases)</option>
              ))}
            </select>
          </div>

          <div className="space-y-3 pt-2">
            <Label>Metrics to Evaluate <span className="text-danger">*</span></Label>
            <div className="grid grid-cols-2 gap-3">
              {metrics.map(metric => (
                <div key={metric.id} className="flex items-center space-x-2">
                  <Checkbox 
                    id={metric.id} 
                    checked={selectedMetrics.includes(metric.id)}
                    onCheckedChange={() => toggleMetric(metric.id)}
                  />
                  <Label htmlFor={metric.id} className="font-normal cursor-pointer text-sm">
                    {metric.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => navigate("/app/benchmarks")}>
            Cancel
          </Button>
          <Button type="submit" loading={createBenchmark.isPending}>
            Create Benchmark
          </Button>
        </div>
      </form>
    </div>
  )
}
