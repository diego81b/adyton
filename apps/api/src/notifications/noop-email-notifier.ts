import { Injectable } from '@nestjs/common';
import { EmailNotifier } from './email-notifier.interface';

@Injectable()
export class NoOpEmailNotifier implements EmailNotifier {
  async sendNewDeviceAlert(
    _to: string,
    _ipAddress: string,
    _userAgent: string,
  ): Promise<void> {
    // No-op: used when SMTP_HOST is not configured
  }
}
