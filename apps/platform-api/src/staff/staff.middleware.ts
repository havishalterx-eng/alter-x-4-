import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RbacRequest } from "../rbac/types";
import { StaffService } from "./staff.service";
@Injectable() export class StaffAuthMiddleware implements NestMiddleware { constructor(private readonly staff:StaffService) {} async use(request:FastifyRequest & RbacRequest,_reply:FastifyReply,next:()=>void){const token=request.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith("alter_staff_access="))?.slice(19);if(token){try { const user=await this.staff.resolve(token);if(user) request.staffActorContext={staff_user_id:user.id,identity_ref:user.identity_ref,email:user.email,roles:user.roles as never}; } catch { /* An invalid staff token falls through to the RBAC deny path. */ }}next();} }
