import { Module } from "@nestjs/common";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { SequencesModule } from "../sequences/sequences.module";
import { FormsController, PublicFormsController } from "./forms.controller";
import { FormsService } from "./forms.service";

@Module({
  imports: [PipelinesModule, SequencesModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
})
export class FormsModule {}
