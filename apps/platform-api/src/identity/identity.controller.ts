import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CallbackQueryDto,
  ConfigureSsoDto,
  LoginDto,
  MfaChallengeDto,
  MfaEnrollDto,
  RefreshDto,
} from "./dto/auth.dto";
import { IdentityService, type IssuedSession } from "./identity.service";
import { IdentityHttpError, problemDetails } from "./problem";

const accessCookieName = "alter_access";
const refreshCookieName = "alter_refresh";

@Controller("/api/v1/auth")
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post("login")
  async login(@Body() body: LoginDto, @Res() reply: FastifyReply): Promise<void> {
    await this.safe(reply, "/api/v1/auth/login", async () => {
      requireFields(body, ["redirectUri", "state", "codeChallenge"]);
      const redirectUrl = await this.identityService.loginRedirectUrl(body);
      reply.status(303).header("Location", redirectUrl).send();
    });
  }

  @Get("callback")
  async callback(
    @Query() query: CallbackQueryDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.safe(reply, "/api/v1/auth/callback", async () => {
      if (!query.code || !query.redirect_uri || !query.code_verifier) {
        throw new IdentityHttpError(400, "INVALID_CALLBACK", "Callback fields missing");
      }

      const session = await this.identityService.handleCallback({
        code: query.code,
        redirectUri: query.redirect_uri,
        codeVerifier: query.code_verifier,
        deviceInfo: {
          userAgent: request.headers["user-agent"],
        },
        ip: request.ip,
      });
      setSessionCookies(reply, session);
      reply.send({ userId: session.userId });
    });
  }

  @Post("refresh")
  async refresh(
    @Body() body: RefreshDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.safe(reply, "/api/v1/auth/refresh", async () => {
      const refreshToken = body.refreshToken ?? readCookie(request, refreshCookieName);
      if (!refreshToken) {
        throw new IdentityHttpError(401, "REFRESH_TOKEN_REQUIRED", "Refresh token required");
      }

      const session = await this.identityService.refreshSession(refreshToken);
      setSessionCookies(reply, session);
      reply.status(200).send({ userId: session.userId });
    });
  }

  @Post("logout")
  async logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    await this.safe(reply, "/api/v1/auth/logout", async () => {
      const accessToken = readCookie(request, accessCookieName);
      if (accessToken) {
        const session = await this.identityService.authenticateAccessToken(accessToken);
        await this.identityService.revokeSession(session.userId, session.id);
      }
      clearSessionCookies(reply);
      reply.status(204).send();
    });
  }

  @Get("sessions")
  async sessions(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    await this.safe(reply, "/api/v1/auth/sessions", async () => {
      const session = await this.requireSession(request);
      const sessions = await this.identityService.listActiveSessions(session.userId);
      reply.send({ sessions });
    });
  }

  @Delete("sessions/:id")
  async revokeSession(
    @Param("id") sessionId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.safe(reply, `/api/v1/auth/sessions/${sessionId}`, async () => {
      const session = await this.requireSession(request);
      await this.identityService.revokeSession(session.userId, sessionId);
      reply.status(204).send();
    });
  }

  @Post("mfa/enroll")
  async enrollMfa(
    @Body() body: MfaEnrollDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.safe(reply, "/api/v1/auth/mfa/enroll", async () => {
      const session = await this.requireSession(request);
      const enrollment = await this.identityService.enrollMfa(body.userId ?? session.userId);
      reply.status(200).send(enrollment);
    });
  }

  @Post("mfa/challenge")
  async challengeMfa(
    @Body() body: MfaChallengeDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.safe(reply, "/api/v1/auth/mfa/challenge", async () => {
      requireFields(body, ["enrollmentId", "otp"]);
      const session = await this.requireSession(request);
      const challenge = await this.identityService.challengeMfa(
        body.userId ?? session.userId,
        body.enrollmentId,
        body.otp,
      );
      reply.status(200).send(challenge);
    });
  }

  @Post("sso/configure")
  async configureSso(
    @Body() body: ConfigureSsoDto,
    @Headers("x-alter-internal") internalHeader: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.safe(reply, "/api/v1/auth/sso/configure", async () => {
      if (internalHeader !== "true") {
        throw new IdentityHttpError(403, "SSO_CONFIG_FORBIDDEN", "SSO config forbidden");
      }
      requireFields(body, ["tenantId", "config"]);
      const config = await this.identityService.configureSso(body.tenantId, body.config);
      reply.status(200).send({ config });
    });
  }

  private async requireSession(request: FastifyRequest) {
    const accessToken = readCookie(request, accessCookieName);
    if (!accessToken) {
      throw new IdentityHttpError(401, "ACCESS_TOKEN_REQUIRED", "Access token required");
    }

    return this.identityService.authenticateAccessToken(accessToken);
  }

  private async safe(
    reply: FastifyReply,
    instance: string,
    handler: () => Promise<void>,
  ): Promise<void> {
    try {
      await handler();
    } catch (error) {
      const requestId = reply.getHeader("x-request-id")?.toString();
      const problem = problemDetails(error, instance, requestId);
      reply.status(problem.status).type("application/problem+json").send(problem);
    }
  }
}

function setSessionCookies(reply: FastifyReply, session: IssuedSession): void {
  reply.header("Set-Cookie", [
    serializeCookie(accessCookieName, session.accessToken, session.accessMaxAgeSeconds),
    serializeCookie(refreshCookieName, session.refreshToken, session.refreshMaxAgeSeconds),
  ]);
}

function clearSessionCookies(reply: FastifyReply): void {
  reply.header("Set-Cookie", [
    serializeCookie(accessCookieName, "", 0),
    serializeCookie(refreshCookieName, "", 0),
  ]);
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }

  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function requireFields<T extends object>(
  body: T,
  fields: Array<keyof T>,
): void {
  for (const field of fields) {
    if (!body[field]) {
      throw new IdentityHttpError(400, "INVALID_REQUEST_BODY", `${String(field)} required`);
    }
  }
}
