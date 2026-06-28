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

  async sendPakDeviceEnrolledAlert(
    _to: string,
    _deviceName: string,
    _ip: string,
    _ua: string,
  ): Promise<void> {
    // No-op: used when SMTP_HOST is not configured
  }
}
