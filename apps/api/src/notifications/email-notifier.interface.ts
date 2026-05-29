export interface EmailNotifier {
  sendNewDeviceAlert(to: string, ipAddress: string, userAgent: string): Promise<void>;
}

export const EMAIL_NOTIFIER = 'EMAIL_NOTIFIER';
