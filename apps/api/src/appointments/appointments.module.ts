import { Module } from "@nestjs/common";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { SequencesModule } from "../sequences/sequences.module";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";

@Module({
  imports: [PipelinesModule, SequencesModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
