import { Test } from '@nestjs/testing';
import { SmtpEmailNotifier } from './smtp-email-notifier';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  })),
}));

import { createTransport } from 'nodemailer';

describe('SmtpEmailNotifier', () => {
  let notifier: SmtpEmailNotifier;
  let sendMail: jest.Mock;

  beforeEach(async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = 'Adyton <noreply@example.com>';

    const module = await Test.createTestingModule({
      providers: [SmtpEmailNotifier],
    }).compile();

    notifier = module.get(SmtpEmailNotifier);
    const transport = (createTransport as jest.Mock).mock.results[0].value as { sendMail: jest.Mock };
    sendMail = transport.sendMail;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it('sends an email with IP and user-agent in text and html body', async () => {
    await notifier.sendNewDeviceAlert('user@test.com', '1.2.3.4', 'Chrome/Windows');

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0] as { to: string; text: string; html: string };
    expect(call.to).toBe('user@test.com');
    expect(call.text).toContain('1.2.3.4');
    expect(call.text).toContain('Chrome/Windows');
    expect(call.html).toContain('1.2.3.4');
    expect(call.html).toContain('Chrome/Windows');
  });

  it('escapes HTML special chars in IP and user-agent', async () => {
    await notifier.sendNewDeviceAlert('user@test.com', '<script>', '"><img>');

    const call = sendMail.mock.calls[0][0] as { html: string };
    expect(call.html).not.toContain('<script>');
    expect(call.html).toContain('&lt;script&gt;');
    expect(call.html).toContain('&gt;&lt;img&gt;');
  });

  it('does not throw when sendMail rejects — logs error instead', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP timeout'));

    await expect(
      notifier.sendNewDeviceAlert('user@test.com', '1.2.3.4', 'Firefox'),
    ).resolves.toBeUndefined();
  });
});
