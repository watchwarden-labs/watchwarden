/**
 * Simple structured logger for code outside Fastify request context
 * (hub, scheduler, notifier, migrations).
 * In production, formats as JSON. In dev, uses plain text with timestamps.
 */
const isProd = process.env.NODE_ENV === 'production';

function fmt(level: string, module: string, msg: string, extra?: Record<string, unknown>): string {
  if (isProd) {
    return JSON.stringify({ level, module, msg, time: Date.now(), ...extra });
  }
  const ts = new Date().toISOString().slice(11, 19);
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
  return `[${ts}] ${level.toUpperCase()} [${module}] ${msg}${extraStr}`;
}

export const log = {
  info: (module: string, msg: string, extra?: Record<string, unknown>) =>
    console.log(fmt('info', module, msg, extra)),
  warn: (module: string, msg: string, extra?: Record<string, unknown>) =>
    console.warn(fmt('warn', module, msg, extra)),
  error: (module: string, msg: string, extra?: Record<string, unknown>) =>
    console.error(fmt('error', module, msg, extra)),
};
