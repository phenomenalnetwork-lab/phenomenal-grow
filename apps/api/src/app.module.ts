import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { MeController } from "./me.controller";
import { AuthGuard } from "./auth.guard";
import { OrgGuard } from "./org.guard";
import { PrismaModule } from "./prisma.module";
import { ContactsModule } from "./contacts/contacts.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { SequencesModule } from "./sequences/sequences.module";
import { HomeModule } from "./home/home.module";

@Module({
  imports: [PrismaModule, ContactsModule, WhatsappModule, PipelinesModule, SequencesModule, HomeModule],
  controllers: [HealthController, MeController],
  providers: [AuthGuard, OrgGuard],
})
export class AppModule {}
