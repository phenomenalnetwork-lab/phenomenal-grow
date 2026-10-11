import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { MeController } from "./me.controller";
import { PrismaService } from "./prisma.service";
import { AuthGuard } from "./auth.guard";
import { OrgGuard } from "./org.guard";

@Module({
  controllers: [HealthController, MeController],
  providers: [PrismaService, AuthGuard, OrgGuard],
})
export class AppModule {}
