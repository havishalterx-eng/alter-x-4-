import type { Ecosystem } from "./types";
export type ScanSeverity = "info" | "low" | "medium" | "high" | "critical";
export type ScanVerdict = "clean" | "findings" | "blocked" | "errored" | "unavailable";
export interface PackageScanRequest { readonly tenantId: string; readonly manifestId: string; readonly manifestVersion: string; readonly artifactRef: string; readonly ecosystem: Ecosystem; }
export interface ScanFinding { readonly rule: string; readonly severity: ScanSeverity; readonly locator: string; readonly detail: string; }
export interface PackageScanReport { readonly verdict: ScanVerdict; readonly findings: readonly ScanFinding[]; readonly scannerVersion: string; readonly scannedAt: string; readonly durationMs: number; }
export interface PackageScanProvider { scanPackage(request: PackageScanRequest): Promise<PackageScanReport>; }
// ENGINE-FIX-P3-10: no real scan provider is wired anywhere in this repo.
// With an empty seed, every artifactRef used to fall through
// `findings.length === 0 ? "blocked" : "findings"` -- an unconditional,
// permanent "blocked" that reads as a real security verdict but is really
// just "this stub has no data". `verdict: "unavailable"` says that
// honestly. A seeded artifactRef (real usage: tests) still reports a real
// clean/findings verdict, distinguished by seed.has(), not by array length,
// so an explicitly-seeded empty findings list still means "clean", not
// "we never scanned this at all".
export function createInMemoryPackageScanProvider(seed: ReadonlyMap<string, readonly ScanFinding[]> = new Map()): PackageScanProvider {
  return {
    async scanPackage(request) {
      const scannedAt = new Date().toISOString();
      if (!seed.has(request.artifactRef)) {
        return { verdict: "unavailable", findings: [], scannerVersion: "mock-unavailable-1", scannedAt, durationMs: 0 };
      }
      const findings = seed.get(request.artifactRef)!;
      return { verdict: findings.length === 0 ? "clean" : "findings", findings, scannerVersion: "mock-unavailable-1", scannedAt, durationMs: 0 };
    },
  };
}
