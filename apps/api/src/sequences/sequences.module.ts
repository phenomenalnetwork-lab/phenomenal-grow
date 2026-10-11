import { Module } from "@nestjs/common";
import { MetaProvider } from "../whatsapp/meta.provider";
import { NotificationsModule } from "../notifications/notifications.module";
import { SequencesEngine } from "./engine";
import { SequencesService } from "./sequences.service";
import { FollowupsService } from "./followups.service";
import {
  SequencesController,
  ContactEnrollmentsController,
  EnrollmentsController,
  FollowupsController,
  ReengagementController,
} from "./sequences.controller";

@Module({
  imports: [NotificationsModule],
  controllers: [
    SequencesController,
    ContactEnrollmentsController,
    EnrollmentsController,
    FollowupsController,
    ReengagementController,
  ],
  providers: [SequencesEngine, SequencesService, FollowupsService, MetaProvider],
  exports: [SequencesEngine, SequencesService],
})
export class SequencesModule {}
