import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { OnboardingHttpError } from "./problem";

@Catch(OnboardingHttpError)
export class OnboardingExceptionFilter implements ExceptionFilter {
  catch(error: OnboardingHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
