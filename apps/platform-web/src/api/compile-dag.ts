import type { CompiledDag } from "@alterx/contracts"

export function compileDag(nodes: any[], edges: any[]): CompiledDag {
  const compiledNodes = nodes.map((node) => {
    // Basic mapping from UI node to backend node format
    const type = node.type === "humanApproval" ? "HumanApproval" : node.type

    let config: Record<string, unknown> = { ...node.data?.config }
    
    if (type === "HumanApproval") {
      // Ensure requested_action is nested properly or flattened based on what handler expects
      // The handler checks config["requested_action"] or falls back to entire config
      config = {
        requested_action: {
          title: node.data?.title ?? "Pending Approval",
          description: node.data?.description ?? "Please review this action",
          ...config,
        },
        expiry_seconds: node.data?.expirySeconds ?? 86400,
      }
    }

    return {
      key: node.id,
      type: type,
      config: config,
      metadata: {
        ui: {
          position: node.position,
          label: node.data?.label,
        },
      },
    }
  })

  const compiledEdges = edges.map((edge) => {
    return {
      key: edge.id,
      from: edge.source,
      to: edge.target,
      kind: edge.label === "conditional" ? ("conditional" as const) : ("sequential" as const),
      ...(edge.label === "conditional"
        ? { condition: { expression: edge.data?.condition || "true", language: "cel" as const } }
        : {}),
    }
  })

  // Determine entry nodes (nodes without incoming edges)
  const targets = new Set(edges.map((e) => e.target))
  const entryNodes = nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)

  // Determine waves (simple topological sort for a DAG)
  const waves: any[] = []
  let currentWave = [...entryNodes]
  let currentOrder = 0
  let unassignedNodes = new Set(nodes.map(n => n.id))

  while (currentWave.length > 0 && unassignedNodes.size > 0) {
    const waveKey = `wave_${currentOrder}`
    waves.push({
      key: waveKey,
      order: currentOrder,
      node_keys: [...currentWave],
      depends_on: currentOrder > 0 ? [`wave_${currentOrder - 1}`] : [],
    })

    currentWave.forEach(k => unassignedNodes.delete(k))
    currentOrder++

    // Find next wave
    const nextWave = new Set<string>()
    for (const edge of compiledEdges) {
      if (waves[waves.length - 1].node_keys.includes(edge.from) && unassignedNodes.has(edge.to)) {
        nextWave.add(edge.to)
      }
    }
    currentWave = Array.from(nextWave)
  }

  if (unassignedNodes.size > 0) {
    waves.push({
      key: `wave_${currentOrder}`,
      order: currentOrder,
      node_keys: Array.from(unassignedNodes),
      depends_on: currentOrder > 0 ? [`wave_${currentOrder - 1}`] : [],
    })
  }

  return {
    schema_version: "v1",
    entry_node_keys: entryNodes.length > 0 ? entryNodes : [nodes[0]?.id].filter(Boolean),
    nodes: compiledNodes,
    edges: compiledEdges,
    waves: waves.length > 0 ? waves : [
      { key: "wave_0", order: 0, node_keys: nodes.map(n => n.id), depends_on: [] }
    ],
  }
}
