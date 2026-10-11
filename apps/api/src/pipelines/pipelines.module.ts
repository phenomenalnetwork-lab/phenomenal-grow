import { Module } from "@nestjs/common";
import { PipelinesController, EnrollmentsController } from "./pipelines.controller";
import { PipelinesService } from "./pipelines.service";

@Module({
  controllers: [PipelinesController, EnrollmentsController],
  providers: [PipelinesService],
})
export class PipelinesModule {}
