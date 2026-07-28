import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validatePlatformApiEnv } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  validatePlatformApiEnv(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );
  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
