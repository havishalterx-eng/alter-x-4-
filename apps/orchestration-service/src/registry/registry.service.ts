import type {
  RegistryGetNodeTypeRequest,
  RegistryGetNodeTypeResponse,
  RegistryListNodeTypesRequest,
  RegistryListNodeTypesResponse,
} from "@alterx/contracts";

import { findNodeTypeDescriptor, listNodeTypeDescriptors } from "./node-type-catalog";

export class RegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryValidationError";
  }
}

export class RegistryNotFoundError extends Error {
  constructor(type: string) {
    super(`No node type registered for "${type}"`);
    this.name = "RegistryNotFoundError";
  }
}

/**
 * The Node Type Registry's read API -- a global, tenant-free catalog (see
 * node-type-catalog.ts). No database, no tenant scoping: every tenant's
 * canvas palette reads the same 11 node types.
 */
export class RegistryService {
  // ListNodeTypes carries no fields (see registry.proto) -- kept as a
  // parameter for interface parity with the RegistryHandler contract.
  async listNodeTypes(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request: RegistryListNodeTypesRequest,
  ): Promise<RegistryListNodeTypesResponse> {
    return { node_types: listNodeTypeDescriptors() };
  }

  async getNodeType(
    request: RegistryGetNodeTypeRequest,
  ): Promise<RegistryGetNodeTypeResponse> {
    if (request.type.trim().length === 0) {
      throw new RegistryValidationError("type is required");
    }
    const descriptor = findNodeTypeDescriptor(request.type);
    if (descriptor === undefined) {
      throw new RegistryNotFoundError(request.type);
    }
    return { node_type: descriptor };
  }
}
