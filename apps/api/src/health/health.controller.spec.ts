import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('returns status ok and an ISO timestamp', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('produces a fresh timestamp on each call', async () => {
    const a = controller.check();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = controller.check();
    expect(new Date(b.timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(a.timestamp).getTime(),
    );
  });
});
