export const ids = {
  tenant: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  user: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  workflow: "wf_018f47a5-7b2c-7d10-8f11-123456789abc",
  workflowVersion: "wfv_018f47a5-7b2c-7d10-8f11-123456789abc",
  project: "prj_018f47a5-7b2c-7d10-8f11-123456789abc",
  run: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
  nodeExecution: "node_018f47a5-7b2c-7d10-8f11-123456789abc",
  event: "evt_018f47a5-7b2c-7d10-8f11-123456789abc",
  trigger: "trg_018f47a5-7b2c-7d10-8f11-123456789abc",
  agent: "agt_018f47a5-7b2c-7d10-8f11-123456789abc",
  policy: "pol_018f47a5-7b2c-7d10-8f11-123456789abc",
  artifact: "art_018f47a5-7b2c-7d10-8f11-123456789abc",
  deployment: "dep_018f47a5-7b2c-7d10-8f11-123456789abc",
  environment: "env_018f47a5-7b2c-7d10-8f11-123456789abc",
  approval: "apr_018f47a5-7b2c-7d10-8f11-123456789abc",
  conversation: "cnv_018f47a5-7b2c-7d10-8f11-123456789abc",
  verification: "ver_018f47a5-7b2c-7d10-8f11-123456789abc",
  recovery: "rec_018f47a5-7b2c-7d10-8f11-123456789abc",
  clarification: "clr_018f47a5-7b2c-7d10-8f11-123456789abc",
  trace: "trc_018f47a5-7b2c-7d10-8f11-123456789abc",
  request: "req_018f47a5-7b2c-7d10-8f11-123456789abc",
} as const;

export const timestamp = "2026-07-22T12:00:00.000Z";

export const graphFixture = {
  schema_version: "1.0.0",
  entry_node_keys: ["start"],
  nodes: [
    {
      key: "start",
      type: "LLMTask",
      config: { prompt_template: "Summarize input" },
      metadata: { ui: { x: 10, y: 20 }, label: "Start" },
    },
    {
      key: "merge",
      type: "Merge",
      config: {},
      metadata: { ui: { x: 200, y: 20 } },
    },
  ],
  edges: [
    {
      key: "start_to_merge",
      from: "start",
      to: "merge",
      kind: "merge",
    },
  ],
  waves: [
    {
      key: "wave_0",
      order: 0,
      node_keys: ["start"],
      depends_on: [],
    },
    {
      key: "wave_1",
      order: 1,
      node_keys: ["merge"],
      depends_on: ["wave_0"],
    },
  ],
} as const;
