import { Module } from '@nestjs/common';
import { EMAIL_NOTIFIER } from './email-notifier.interface';
import { NoOpEmailNotifier } from './noop-email-notifier';

@Module({
  providers: [
    {
      provide: EMAIL_NOTIFIER,
      useClass: NoOpEmailNotifier,
    },
  ],
  exports: [EMAIL_NOTIFIER],
})
export class NotificationsModule {}
