import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEvent } from '../types.js';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

const { sendEmail } = await import('../senders/email.js');

const successEvent: NotificationEvent = {
  type: 'update_success',
  agents: [
    { agentName: 'prod', containers: [{ name: 'app', image: 'app:latest', durationMs: 5000 }] },
  ],
};

describe('email sender', () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue(undefined);
    createTransport.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a transport from host/port/secure and sends to/from/subject/text', async () => {
    await sendEmail(
      {
        host: 'smtp.example.com',
        port: '587',
        secure: 'false',
        from: 'watchwarden@example.com',
        to: 'me@example.com',
      },
      successEvent,
    );

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [call] = sendMail.mock.calls[0] as [
      { from: string; to: string; subject: string; text: string },
    ];
    expect(call.from).toBe('watchwarden@example.com');
    expect(call.to).toBe('me@example.com');
    expect(call.subject).toContain('Update Complete');
    expect(call.text).toContain('app');
  });

  it('omits auth when no user is configured', async () => {
    await sendEmail(
      { host: 'smtp.example.com', port: '25', from: 'a@example.com', to: 'b@example.com' },
      successEvent,
    );

    const [config] = createTransport.mock.calls[0] as unknown as [{ auth?: unknown }];
    expect(config.auth).toBeUndefined();
  });

  it('sets auth when user/password are configured', async () => {
    await sendEmail(
      {
        host: 'smtp.example.com',
        port: '587',
        user: 'smtpuser',
        password: 'smtppass',
        from: 'a@example.com',
        to: 'b@example.com',
      },
      successEvent,
    );

    const [config] = createTransport.mock.calls[0] as unknown as [
      { auth?: { user: string; pass: string } },
    ];
    expect(config.auth).toEqual({ user: 'smtpuser', pass: 'smtppass' });
  });

  it('sets tls.rejectUnauthorized false when allowInsecureTLS is enabled', async () => {
    await sendEmail(
      {
        host: 'smtp.example.com',
        port: '587',
        allowInsecureTLS: 'true',
        from: 'a@example.com',
        to: 'b@example.com',
      },
      successEvent,
    );

    const [config] = createTransport.mock.calls[0] as unknown as [
      { tls?: { rejectUnauthorized: boolean } },
    ];
    expect(config.tls).toEqual({ rejectUnauthorized: false });
  });

  it('omits tls option when allowInsecureTLS is not enabled', async () => {
    await sendEmail(
      { host: 'smtp.example.com', port: '587', from: 'a@example.com', to: 'b@example.com' },
      successEvent,
    );

    const [config] = createTransport.mock.calls[0] as unknown as [{ tls?: unknown }];
    expect(config.tls).toBeUndefined();
  });

  it('propagates errors from sendMail', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));

    await expect(
      sendEmail(
        { host: 'smtp.example.com', port: '587', from: 'a@example.com', to: 'b@example.com' },
        successEvent,
      ),
    ).rejects.toThrow('SMTP connection refused');
  });
});
