import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ActionCentreHttpError } from "./problem";

@Catch(ActionCentreHttpError)
export class ActionCentreExceptionFilter implements ExceptionFilter {
  catch(error: ActionCentreHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
