import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { EmailNotifier } from './email-notifier.interface';

@Injectable()
export class SmtpEmailNotifier implements EmailNotifier {
  private readonly logger = new Logger(SmtpEmailNotifier.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    this.from = process.env.SMTP_FROM ?? 'Adyton <noreply@adyton.app>';
    this.transporter = createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  }

  async sendPakDeviceEnrolledAlert(to: string, deviceName: string, ip: string, ua: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'New PAK device enrolled in Adyton',
        text: [
          'A new device was enrolled as a Phone-as-Key for your Adyton account.',
          '',
          `Device name: ${deviceName}`,
          `IP address:  ${ip}`,
          `User agent:  ${ua}`,
          '',
          'If this was you, no action is needed.',
          'If you did not enroll this device, revoke it in Settings immediately.',
        ].join('\n'),
        html: `
<p>A new device was enrolled as a <strong>Phone-as-Key</strong> for your <strong>Adyton</strong> account.</p>
<table>
  <tr><td><strong>Device name</strong></td><td>${escapeHtml(deviceName)}</td></tr>
  <tr><td><strong>IP address</strong></td><td>${escapeHtml(ip)}</td></tr>
  <tr><td><strong>User agent</strong></td><td>${escapeHtml(ua)}</td></tr>
</table>
<p>If this was you, no action is needed.<br>
If you did not enroll this device, <strong>revoke it in Settings immediately</strong>.</p>
        `.trim(),
      });
    } catch (err) {
      this.logger.error('Failed to send PAK device enrolled alert', err instanceof Error ? err.message : String(err));
    }
  }

  async sendNewDeviceAlert(to: string, ipAddress: string, userAgent: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'New device signed in to Adyton',
        text: [
          'A new device just signed in to your Adyton account.',
          '',
          `IP address: ${ipAddress}`,
          `Device:     ${userAgent}`,
          '',
          'If this was you, no action is needed.',
          'If you did not sign in, change your master password immediately.',
        ].join('\n'),
        html: `
<p>A new device just signed in to your <strong>Adyton</strong> account.</p>
<table>
  <tr><td><strong>IP address</strong></td><td>${escapeHtml(ipAddress)}</td></tr>
  <tr><td><strong>Device</strong></td><td>${escapeHtml(userAgent)}</td></tr>
</table>
<p>If this was you, no action is needed.<br>
If you did not sign in, <strong>change your master password immediately</strong>.</p>
        `.trim(),
      });
    } catch (err) {
      // Email failure must not break login flow
      this.logger.error('Failed to send new-device alert', err instanceof Error ? err.message : String(err));
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
