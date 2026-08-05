import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { I18nHttpError } from "./problem";

@Catch(I18nHttpError)
export class I18nExceptionFilter implements ExceptionFilter {
  catch(error: I18nHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply.status(error.getStatus()).type("application/problem+json").send(error.getResponse());
  }
}
