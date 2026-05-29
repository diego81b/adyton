import { NoOpEmailNotifier } from './noop-email-notifier';

describe('NoOpEmailNotifier', () => {
  it('sendNewDeviceAlert resolves without throwing', async () => {
    const notifier = new NoOpEmailNotifier();
    await expect(
      notifier.sendNewDeviceAlert('user@example.com', '127.0.0.1', 'Mozilla/5.0'),
    ).resolves.toBeUndefined();
  });
});
