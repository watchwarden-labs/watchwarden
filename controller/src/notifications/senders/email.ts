import nodemailer from 'nodemailer';
import type { NotificationEvent } from '../types.js';
import { type FormatOptions, formatTelegramMessage } from './telegram.js';

function subjectFor(event: NotificationEvent): string {
  switch (event.type) {
    case 'update_available':
      return 'WatchWarden: Updates Available';
    case 'update_success':
      return 'WatchWarden: Update Complete';
    case 'update_failed':
      return 'WatchWarden: Update Failed';
  }
}

export async function sendEmail(
  config: {
    host: string;
    port: string;
    secure?: string;
    user?: string;
    password?: string;
    from: string;
    to: string;
  },
  event: NotificationEvent,
  options?: FormatOptions,
): Promise<void> {
  const text = formatTelegramMessage(event, options);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: config.secure === 'true',
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  });
  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject: subjectFor(event),
    text,
  });
}
