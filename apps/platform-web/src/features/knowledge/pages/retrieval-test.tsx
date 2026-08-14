import * as React from "react"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Loader2, AlertCircle } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"

export function RetrievalTestPage() {
  const [query, setQuery] = useState("")
  const [activeQuery, setActiveQuery] = useState("")

  const { data: results, isLoading, error } = useQuery({
    queryKey: queryKeys.knowledge.retrieval(activeQuery),
    queryFn: () => api.testRetrieval(activeQuery),
    enabled: activeQuery.length > 0,
    retry: false
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      setActiveQuery(query.trim())
    }
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <PageHeader 
        title="Retrieval Testing"
        description="Test the semantic search across all indexed knowledge sources."
      />

      <Card className="mt-6 mb-8">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Ask a question or search for concepts..." 
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isLoading || !query.trim()}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Search"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 mb-6 text-sm text-destructive bg-destructive/10 border border-destructive rounded-md flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <div>
            <span className="font-medium">Retrieval Error: </span>
            {(error as Error).message}
          </div>
        </div>
      )}

      {activeQuery && !isLoading && !error && (!results || results.length === 0) && (
        <div className="text-center p-12 border border-dashed rounded-lg text-muted-foreground">
          No relevant chunks found for "{activeQuery}". Try using different keywords.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Top Results ({results.length})
          </h3>
          {results.map((result, idx) => (
            <Card key={result.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      Result #{idx + 1}
                      <Badge variant={
                        result.confidence === 'high' ? 'default' : 
                        result.confidence === 'medium' ? 'secondary' : 'outline'
                      }>
                        {(result.score * 100).toFixed(1)}% Match
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      From: {result.provenance[0]?.sourceName} / {result.provenance[0]?.documentName}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-muted/30 rounded-md text-sm whitespace-pre-wrap">
                  {result.content}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
