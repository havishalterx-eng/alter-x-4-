import { Controller, Get } from "@nestjs/common";
import type { RegistryNodeTypeDescriptor } from "@alterx/contracts";
import { listNodeTypeDescriptors } from "./node-type-catalog";

/**
 * ENGINE-FIX-P3-8: "palette = Engine Node Type Registry + Platform
 * presentation metadata" (doc 13 sec 2 / architecture-decision doc). The
 * catalog in ./node-type-catalog.ts was already real and complete; nothing
 * read it over HTTP. Global, tenant-free, static -- every workspace sees
 * the same 11 types -- so this needs no service class or DB access.
 */
@Controller("api/v1/node-types")
export class NodeTypeController {
  @Get()
  list(): { node_types: readonly RegistryNodeTypeDescriptor[] } {
    return { node_types: listNodeTypeDescriptors() };
  }
}
