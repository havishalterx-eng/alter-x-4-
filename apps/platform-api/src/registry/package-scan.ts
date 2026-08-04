import type { Ecosystem } from "./types";
export type ScanSeverity = "info" | "low" | "medium" | "high" | "critical";
export type ScanVerdict = "clean" | "findings" | "blocked" | "errored";
export interface PackageScanRequest { readonly tenantId: string; readonly manifestId: string; readonly manifestVersion: string; readonly artifactRef: string; readonly ecosystem: Ecosystem; }
export interface ScanFinding { readonly rule: string; readonly severity: ScanSeverity; readonly locator: string; readonly detail: string; }
export interface PackageScanReport { readonly verdict: ScanVerdict; readonly findings: readonly ScanFinding[]; readonly scannerVersion: string; readonly scannedAt: string; readonly durationMs: number; }
export interface PackageScanProvider { scanPackage(request: PackageScanRequest): Promise<PackageScanReport>; }
export function createInMemoryPackageScanProvider(seed: ReadonlyMap<string, readonly ScanFinding[]> = new Map()): PackageScanProvider {
  return { async scanPackage(request) { const findings = seed.get(request.artifactRef) ?? []; return { verdict: findings.length === 0 ? "blocked" : "findings", findings, scannerVersion: "mock-unavailable-1", scannedAt: new Date().toISOString(), durationMs: 0 }; } };
}
