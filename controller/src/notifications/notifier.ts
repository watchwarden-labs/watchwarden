import { insertNotificationLog, listNotificationChannels } from '../db/queries.js';
import { decrypt } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { sendNtfy } from './senders/ntfy.js';
import { sendSlack } from './senders/slack.js';
import { sendTelegram } from './senders/telegram.js';
import { sendWebhook } from './senders/webhook.js';
import type { NotificationEvent } from './types.js';

// Rate limiting: track last dispatch time per channel+event.
// In-memory only — resets on controller restart. This is acceptable because
// a restart-triggered duplicate notification is preferable to persisting
// rate limit state in the DB for every dispatch.
const lastDispatch = new Map<string, number>();
const RATE_LIMIT_MS = 60_000; // 1 minute cooldown per channel per event type

class Notifier {
  async dispatch(event: NotificationEvent): Promise<void> {
    const channels = await listNotificationChannels();

    for (const channel of channels) {
      if (!channel.enabled) continue;

      try {
        const events = JSON.parse(channel.events) as string[];
        if (!events.includes(event.type)) continue;

        // Rate limit: only throttle "update_available" (which is already batched).
        // Success and failure notifications are per-container events — always deliver.
        const rateKey = `${channel.id}:${event.type}`;
        if (event.type === 'update_available') {
          const lastTime = lastDispatch.get(rateKey) ?? 0;
          if (Date.now() - lastTime < RATE_LIMIT_MS) {
            continue;
          }
        }

        await this.sendToChannel(channel, event);

        lastDispatch.set(rateKey, Date.now());
        await insertNotificationLog({
          channel_id: channel.id,
          channel_name: channel.name,
          event_type: event.type,
          status: 'success',
          error: null,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error('notify', `Notification send failed for channel ${channel.name}: ${errorMsg}`);
        await insertNotificationLog({
          channel_id: channel.id,
          channel_name: channel.name,
          event_type: event.type,
          status: 'failed',
          error: errorMsg,
        });
      }
    }
  }

  /** Send to a single channel. Throws on failure. */
  async sendToSingleChannel(
    channel: { type: string; config: string; id: string; name: string },
    event: NotificationEvent,
  ): Promise<void> {
    await this.sendToChannel({ ...channel, config: channel.config }, event);
    await insertNotificationLog({
      channel_id: channel.id,
      channel_name: channel.name,
      event_type: event.type,
      status: 'success',
      error: null,
    });
  }

  private async sendToChannel(
    channel: {
      type: string;
      config: string;
      template?: string | null;
      link_template?: string | null;
    },
    event: NotificationEvent,
  ): Promise<void> {
    // FIX-6.2: decrypt inside try-catch so a single corrupted/re-keyed channel
    // config doesn't kill the entire dispatch loop for other healthy channels.
    // biome-ignore lint/suspicious/noExplicitAny: channel config shape varies per sender type
    let config: any;
    try {
      config = JSON.parse(decrypt(channel.config));
    } catch (err) {
      throw new Error(
        `Failed to decrypt channel config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const formatOptions = {
      template: channel.template ?? undefined,
      linkTemplate: channel.link_template ?? undefined,
    };
    switch (channel.type) {
      case 'telegram':
        await sendTelegram(config, event, formatOptions);
        break;
      case 'slack':
        await sendSlack(config, event, formatOptions);
        break;
      case 'webhook':
        await sendWebhook(config, event, formatOptions);
        break;
      case 'ntfy':
        await sendNtfy(config, event, formatOptions);
        break;
    }
  }
}

export const notifier = new Notifier();
