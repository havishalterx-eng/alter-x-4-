const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'OneDrive', 'Desktop', 'Alter Engine frontend 1.0', 'src', 'api', 'client.ts');
let content = fs.readFileSync(clientPath, 'utf8');

const methods = `
  // Phase 7: Knowledge API
  async getKnowledgeSources(): Promise<KnowledgeSource[]> {
    await delay(MOCK_DELAY)
    return mockKnowledgeSources.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async getKnowledgeSource(id: string): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY)
    const s = mockKnowledgeSources.find(s => s.id === id)
    if (!s) throw new Error("Knowledge source not found")
    return s
  }

  async createKnowledgeSource(data: Partial<KnowledgeSource>): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY * 2)
    const s: KnowledgeSource = {
      id: \`ks_\${Date.now()}\`,
      name: data.name || "New Source",
      type: data.type || "file_upload",
      status: "processing",
      documentCount: data.documentCount || 0,
      chunkCount: data.chunkCount || 0,
      connectionId: data.connectionId,
      config: data.config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockKnowledgeSources.push(s)
    return s
  }

  async syncKnowledgeSource(id: string): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY * 2)
    const s = mockKnowledgeSources.find(s => s.id === id)
    if (!s) throw new Error("Source not found")
    s.status = "syncing"
    s.updatedAt = new Date().toISOString()
    return s
  }

  async reindexKnowledgeSource(id: string): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY * 2)
    const s = mockKnowledgeSources.find(s => s.id === id)
    if (!s) throw new Error("Source not found")
    s.status = "processing"
    s.updatedAt = new Date().toISOString()
    return s
  }

  async deleteKnowledgeSource(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockKnowledgeSources.findIndex(s => s.id === id)
    if (idx > -1) mockKnowledgeSources.splice(idx, 1)
  }

  async getKnowledgeDocuments(sourceId: string): Promise<KnowledgeDocument[]> {
    await delay(MOCK_DELAY)
    return mockKnowledgeDocuments.filter(d => d.sourceId === sourceId)
  }

  async retryKnowledgeDocument(id: string): Promise<KnowledgeDocument> {
    await delay(MOCK_DELAY)
    const d = mockKnowledgeDocuments.find(d => d.id === id)
    if (!d) throw new Error("Document not found")
    d.status = "processing"
    d.error = undefined
    return d
  }

  async getKnowledgeChunks(sourceId: string, documentId: string): Promise<KnowledgeChunk[]> {
    await delay(MOCK_DELAY)
    return mockKnowledgeChunks.filter(c => c.sourceId === sourceId && c.documentId === documentId)
  }

  async testRetrieval(query: string, filters?: any): Promise<RetrievalResult[]> {
    await delay(MOCK_DELAY * 2)
    
    if (filters?.sources?.includes("ks_03")) { // Mock syncing source
       throw new Error("One selected source is still indexing.")
    }
    
    if (query.toLowerCase().includes("empty") || query.toLowerCase().includes("none")) {
       return []
    }
    
    // Return mock results
    return [
      {
        id: \`res_\${Date.now()}_1\`,
        chunkId: "chunk_018",
        sourceId: "ks_02",
        documentId: "doc_01",
        content: "Annual subscriptions may receive a prorated refund if cancelled within the first 30 days of the billing cycle. After 30 days, no refunds will be issued for annual plans.",
        score: 0.92,
        confidence: "high",
        provenance: [
          {
            id: "prov_1",
            sourceId: "ks_02",
            sourceName: "Support Policies",
            documentId: "doc_01",
            documentName: "refund-policy.pdf",
            chunkId: "chunk_018",
          }
        ]
      },
      {
        id: \`res_\${Date.now()}_2\`,
        chunkId: "chunk_019",
        sourceId: "ks_02",
        documentId: "doc_01",
        content: "Monthly subscriptions are non-refundable. If you cancel a monthly subscription, you will retain access to the platform until the end of your current billing period.",
        score: 0.78,
        confidence: "medium",
        provenance: [
          {
            id: "prov_2",
            sourceId: "ks_02",
            sourceName: "Support Policies",
            documentId: "doc_01",
            documentName: "refund-policy.pdf",
            chunkId: "chunk_019",
          }
        ]
      }
    ]
  }

  async getMemoryConfiguration(): Promise<MemoryConfiguration> {
    await delay(MOCK_DELAY)
    return mockMemoryConfig
  }

  async updateMemoryConfiguration(data: Partial<MemoryConfiguration>): Promise<MemoryConfiguration> {
    await delay(MOCK_DELAY)
    Object.assign(mockMemoryConfig, data)
    return mockMemoryConfig
  }

  async requestDataExport(): Promise<{ status: string }> {
    await delay(MOCK_DELAY * 2)
    return { status: "ready" } // Mock direct readiness
  }
  
  async deleteWorkspaceData(scope: string): Promise<void> {
    await delay(MOCK_DELAY * 3)
  }

  // Phase 7: Connections API
  async getIntegrationCatalog(): Promise<IntegrationDefinition[]> {
    await delay(MOCK_DELAY)
    return mockIntegrationDefinitions
  }

  async getIntegration(id: string): Promise<IntegrationDefinition> {
    await delay(MOCK_DELAY)
    const i = mockIntegrationDefinitions.find(i => i.id === id)
    if (!i) throw new Error("Integration not found")
    return i
  }

  async getConnections(): Promise<Connection[]> {
    await delay(MOCK_DELAY)
    return mockConnections.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  async getConnection(id: string): Promise<Connection> {
    await delay(MOCK_DELAY)
    const c = mockConnections.find(c => c.id === id)
    if (!c) throw new Error("Connection not found")
    return c
  }

  async createConnection(data: Partial<Connection>): Promise<Connection> {
    await delay(MOCK_DELAY * 2)
    const c: Connection = {
      id: \`conn_\${Date.now()}\`,
      integrationId: data.integrationId!,
      name: data.name || "New Connection",
      status: "connected",
      credentialId: data.credentialId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString()
    }
    mockConnections.push(c)
    return c
  }

  async testConnection(id: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY * 2)
    const c = mockConnections.find(c => c.id === id)
    if (!c) throw new Error("Connection not found")
    c.lastCheckedAt = new Date().toISOString()
    
    if (c.status === "expired" || c.status === "error") {
      return { success: false, message: "Connection test failed. Invalid credentials or expired token." }
    }
    return { success: true, message: "Connection test successful." }
  }

  async reconnectConnection(id: string): Promise<Connection> {
    await delay(MOCK_DELAY * 2)
    const c = mockConnections.find(c => c.id === id)
    if (!c) throw new Error("Connection not found")
    c.status = "connected"
    c.lastCheckedAt = new Date().toISOString()
    return c
  }
  
  async deleteConnection(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockConnections.findIndex(c => c.id === id)
    if (idx > -1) mockConnections.splice(idx, 1)
  }

  // Phase 7: Credentials API
  async getCredentials(): Promise<Credential[]> {
    await delay(MOCK_DELAY)
    return mockCredentials.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }
  
  async getCredential(id: string): Promise<Credential> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    return c
  }

  async createCredential(data: Partial<Credential>): Promise<Credential> {
    await delay(MOCK_DELAY * 2)
    const c: Credential = {
      id: \`cred_\${Date.now()}\`,
      name: data.name || "New Credential",
      type: data.type || "secret",
      provider: data.provider,
      maskedValue: data.type !== "oauth" ? "sk_••••••••" : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usedByConnectionIds: []
    }
    mockCredentials.push(c)
    return c
  }

  async updateCredential(id: string, data: Partial<Credential>): Promise<Credential> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    Object.assign(c, data, { updatedAt: new Date().toISOString() })
    return c
  }

  async replaceCredentialSecret(id: string, _secretValue: string): Promise<Credential> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    c.updatedAt = new Date().toISOString()
    return c
  }

  async deleteCredential(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    if (c.usedByConnectionIds.length > 0) {
      throw new Error("Credential is in use by one or more connections.")
    }
    const idx = mockCredentials.findIndex(c => c.id === id)
    if (idx > -1) mockCredentials.splice(idx, 1)
  }

  // Phase 7: Channels API
  async getWhatsAppChannels(): Promise<WhatsAppChannel[]> {
    await delay(MOCK_DELAY)
    return mockWhatsAppChannels
  }

  async createWhatsAppChannel(data: Partial<WhatsAppChannel>): Promise<WhatsAppChannel> {
    await delay(MOCK_DELAY * 2)
    const ch: WhatsAppChannel = {
      id: \`wa_\${Date.now()}\`,
      name: data.name || "New Channel",
      phoneNumber: data.phoneNumber!,
      provider: data.provider || "mock",
      status: "connected",
      connectionId: data.connectionId,
      createdAt: new Date().toISOString(),
    }
    mockWhatsAppChannels.push(ch)
    return ch
  }

  async testWhatsAppChannel(_id: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY)
    return { success: true, message: "Test message sent successfully." }
  }

  async deleteWhatsAppChannel(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockWhatsAppChannels.findIndex(c => c.id === id)
    if (idx > -1) mockWhatsAppChannels.splice(idx, 1)
  }

  async getVoiceChannels(): Promise<VoiceChannel[]> {
    await delay(MOCK_DELAY)
    return mockVoiceChannels
  }

  async createVoiceChannel(data: Partial<VoiceChannel>): Promise<VoiceChannel> {
    await delay(MOCK_DELAY * 2)
    const ch: VoiceChannel = {
      id: \`vc_\${Date.now()}\`,
      name: data.name || "New Channel",
      phoneNumber: data.phoneNumber,
      provider: data.provider || "mock",
      status: "connected",
      connectionId: data.connectionId,
      voice: data.voice,
      language: data.language,
      createdAt: new Date().toISOString(),
    }
    mockVoiceChannels.push(ch)
    return ch
  }

  async testVoiceChannel(_id: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY)
    return { success: true, message: "Test call initiated successfully." }
  }

  async deleteVoiceChannel(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockVoiceChannels.findIndex(c => c.id === id)
    if (idx > -1) mockVoiceChannels.splice(idx, 1)
  }
`;

content = content.replace(/}\s*export const api = new ApiClient\(\)\s*$/, methods + '\\n}\\n\\nexport const api = new ApiClient()\\n');
fs.writeFileSync(clientPath, content, 'utf8');
console.log('Appended methods to client.ts');
