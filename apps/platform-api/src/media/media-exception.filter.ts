import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { MediaHttpError } from "./problem";

@Catch(MediaHttpError)
export class MediaExceptionFilter implements ExceptionFilter {
  catch(error: MediaHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
