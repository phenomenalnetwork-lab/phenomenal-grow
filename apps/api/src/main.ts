import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.join(__dirname, "../../../.env") });
import "reflect-metadata";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Own body parsing so the Meta webhook keeps a raw copy for signature checks.
  const app = await NestFactory.create(AppModule, { cors: true, bodyParser: false });
  app.use(
    express.json({
      limit: "2mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  // Abuse guardrails: generous global cap, strict on public capture forms.
  // The Meta webhook stays under the global cap (Meta retries on 429).
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use("/public/forms", rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`pgrow-api listening on :${port}`);
}

void bootstrap();
