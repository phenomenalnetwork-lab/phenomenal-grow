import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { TagsController } from "./tags.controller";
import { ContactsService } from "./contacts.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [ContactsController, TagsController],
  providers: [ContactsService],
})
export class ContactsModule {}
