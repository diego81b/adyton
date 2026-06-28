import { Module } from '@nestjs/common';
import { EMAIL_NOTIFIER } from './email-notifier.interface';
import { NoOpEmailNotifier } from './noop-email-notifier';
import { SmtpEmailNotifier } from './smtp-email-notifier';

@Module({
  providers: [
    {
      provide: EMAIL_NOTIFIER,
      useFactory: () =>
        process.env.SMTP_HOST ? new SmtpEmailNotifier() : new NoOpEmailNotifier(),
    },
  ],
  exports: [EMAIL_NOTIFIER],
})
export class NotificationsModule {}
