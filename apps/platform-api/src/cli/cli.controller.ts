import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public } from "../rbac";
import { CliRateLimiter } from "./cli-rate-limiter";
import { CliService } from "./cli.service";

@Controller("/api/v1/cli")
export class CliController {
  constructor(
    private readonly cli: CliService,
    private readonly rateLimiter: CliRateLimiter,
  ) {}

  @Post("device/authorize")
  @Public()
  async authorize(@Req() request: FastifyRequest) {
    await this.requireRateLimit(request, "device/authorize");
    const authorization = await this.cli.authorize();
    return {
      device_code: authorization.deviceCode,
      user_code: authorization.userCode,
      verification_uri: authorization.verificationUri,
      ...(authorization.verificationUriComplete
        ? { verification_uri_complete: authorization.verificationUriComplete }
        : {}),
      expires_in: authorization.expiresIn,
      interval: authorization.interval,
    };
  }

  @Post("device/token")
  @Public()
  async token(@Body() body: { device_code?: string }, @Req() request: FastifyRequest) {
    await this.requireRateLimit(request, "device/token");
    if (!body.device_code?.trim()) throw new BadRequestException("device_code required");
    const result = await this.cli.poll(body.device_code);
    return "error" in result
      ? result
      : {
          access_token: result.accessToken,
          ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
          expires_in: result.expiresIn,
          token_type: result.tokenType,
        };
  }

  @Get("doctor")
  @Public()
  async doctor(@Headers("x-alter-cli-version") cliVersion: string | undefined) {
    return this.cli.doctor(cliVersion);
  }

  private async requireRateLimit(request: FastifyRequest, endpoint: string): Promise<void> {
    if (!(await this.rateLimiter.allow(request.ip, endpoint))) {
      throw new HttpException(
        "CLI device-flow rate limit reached",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
