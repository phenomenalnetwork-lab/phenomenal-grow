import { Module } from "@nestjs/common";
import { WhatsappService } from "./whatsapp.service";
import { MetaProvider } from "./meta.provider";
import { WebhookController } from "./webhook.controller";
import { ConversationsController, NumbersController } from "./whatsapp.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [WebhookController, ConversationsController, NumbersController],
  providers: [WhatsappService, MetaProvider],
})
export class WhatsappModule {}
