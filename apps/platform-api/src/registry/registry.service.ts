import { Inject, Injectable } from "@nestjs/common";
import { PublisherRepository } from "../publisher/publisher.repository";
import { registryId } from "./id";
import type { PackageScanProvider } from "./package-scan";
import { RegistryHttpError } from "./problem";
import { RegistryRepository } from "./registry.repository";
import { PACKAGE_SCAN_PROVIDER } from "./tokens";
import type { CreateManifestInput, CreateVersionInput, ToolManifest, ToolVersion } from "./types";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

@Injectable()
export class RegistryService {
  constructor(private readonly repository: RegistryRepository, private readonly publishers: PublisherRepository, @Inject(PACKAGE_SCAN_PROVIDER) private readonly scanner: PackageScanProvider) {}
  list(tenantId: string) { return this.repository.list(tenantId); }
  async get(tenantId: string, manifestId: string) { return this.requireManifest(tenantId, manifestId); }
  versions(tenantId: string, manifestId: string) { return this.repository.versions(tenantId, manifestId); }
  async create(tenantId: string, input: CreateManifestInput): Promise<ToolManifest> {
    if (input.trust_level === "alter_verified") throw this.error(403, "REGISTRY_ALTER_VERIFIED_FIRST_PARTY_ONLY", "Alter verified trust is reserved for first-party manifests.", "/api/v1/registry/tools");
    if (input.trust_level === "verified_publisher") {
      const publisher = await this.publishers.getPublisher(tenantId);
      if (publisher?.verificationStatus !== "verified") throw this.error(403, "REGISTRY_PUBLISHER_VERIFICATION_REQUIRED", "Publisher verification is required for verified publisher trust.", "/api/v1/registry/tools");
    }
    return this.repository.createManifest(tenantId, registryId("tlm"), input);
  }
  async createVersion(tenantId: string, manifestId: string, input: CreateVersionInput): Promise<ToolVersion> { await this.requireOwnedManifest(tenantId, manifestId); return this.repository.createVersion(tenantId, registryId("tlv"), manifestId, input); }
  async scan(tenantId: string, manifestId: string, versionId: string) {
    const manifest = await this.requireOwnedManifest(tenantId, manifestId);
    const version = await this.requireVersion(tenantId, manifestId, versionId);
    if (version.status !== "draft" && version.status !== "scan_failed") throw this.transition(version.status, "scanning", manifestId, versionId);
    await this.repository.setVersionStatus(tenantId, version.id, "scanning");
    let result;
    try { result = await this.scanner.scanPackage({ tenantId, manifestId, manifestVersion: version.version, artifactRef: version.artifactRef, ecosystem: manifest.ecosystem }); }
    catch { result = { verdict: "errored" as const, findings: [], scannerVersion: "unavailable", scannedAt: new Date().toISOString(), durationMs: 0 }; }
    const report = await this.repository.report(tenantId, registryId("scn"), version.id, result);
    const publishable = report.verdict === "clean" || (report.verdict === "findings" && report.findings.every((finding) => !BLOCKING_SEVERITIES.has(finding.severity)));
    const updated = await this.repository.setVersionStatus(tenantId, version.id, publishable ? "published" : "scan_failed");
    if (publishable) await this.repository.setManifestStatus(tenantId, manifest.id, "published");
    return updated;
  }
  async report(tenantId: string, manifestId: string, versionId: string) { await this.requireManifest(tenantId, manifestId); await this.requireVersion(tenantId, manifestId, versionId); const report = await this.repository.latestReport(tenantId, versionId); if (!report) throw this.error(404, "REGISTRY_SCAN_REPORT_NOT_FOUND", "Scan report was not found.", `/api/v1/registry/tools/${manifestId}/versions/${versionId}/scan-report`); return report; }
  async revoke(tenantId: string, manifestId: string, versionId: string, reason: string, revokedBy: string) { await this.requireOwnedManifest(tenantId, manifestId); await this.requireVersion(tenantId, manifestId, versionId); return this.repository.revoke(tenantId, registryId("rvk"), manifestId, versionId, reason, revokedBy); }
  private async requireManifest(tenantId: string, id: string) { const manifest = await this.repository.get(tenantId, id); if (!manifest || manifest.trustLevel === "blocked") throw this.error(404, "REGISTRY_NOT_FOUND", "Registry resource was not found.", `/api/v1/registry/tools/${id}`); return manifest; }
  private async requireOwnedManifest(tenantId: string, id: string) { const manifest = await this.requireManifest(tenantId, id); if (manifest.tenantId !== tenantId) throw this.error(404, "REGISTRY_NOT_FOUND", "Registry resource was not found.", `/api/v1/registry/tools/${id}`); return manifest; }
  private async requireVersion(tenantId: string, manifestId: string, id: string) { const version = await this.repository.getVersion(tenantId, manifestId, id); if (!version) throw this.error(404, "REGISTRY_NOT_FOUND", "Registry resource was not found.", `/api/v1/registry/tools/${manifestId}/versions/${id}`); return version; }
  private transition(from: string, to: string, manifestId: string, versionId: string): RegistryHttpError { return this.error(409, "REGISTRY_INVALID_STATUS_TRANSITION", `Cannot transition version from ${from} to ${to}.`, `/api/v1/registry/tools/${manifestId}/versions/${versionId}/actions/scan`); }
  private error(status: 403 | 404 | 409, code: string, detail: string, instance: string) { return new RegistryHttpError(status, code, detail, instance); }
}
