/**
 * Structured logger with:
 * - WW_LOG_LEVEL env var (error | warn | info | debug), default: info
 * - Runtime log level changes via setLogLevel() with optional auto-reset TTL
 * - Optional file logging to /tmp/watchwarden/controller.log (toggled from UI)
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';

const isProd = process.env.NODE_ENV === 'production';

const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const DEFAULT_LOG_DIR = '/tmp/watchwarden';
const DEFAULT_LOG_FILE = `${DEFAULT_LOG_DIR}/controller.log`;
const MAX_LOG_TAIL_BYTES = 512 * 1024;

// --- State ---

let currentLevel: LogLevel = (process.env.WW_LOG_LEVEL?.toLowerCase() as LogLevel) ?? 'info';
if (!LEVELS[currentLevel]) currentLevel = 'info';

let debugUntil: string | null = null;
let debugTimer: ReturnType<typeof setTimeout> | null = null;
let fileLoggingEnabled = false;

// --- Log level ---

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function getDebugUntil(): string | null {
  return debugUntil;
}

export function setLogLevel(level: string, ttlMinutes?: number): void {
  const normalized = level.toLowerCase() as LogLevel;
  if (!LEVELS[normalized]) return;

  if (debugTimer) {
    clearTimeout(debugTimer);
    debugTimer = null;
    debugUntil = null;
  }

  currentLevel = normalized;

  if (normalized === 'debug' && ttlMinutes && ttlMinutes > 0) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    debugUntil = expiresAt.toISOString();
    debugTimer = setTimeout(() => {
      currentLevel = 'info';
      debugUntil = null;
      debugTimer = null;
      log.info('logger', 'Debug mode expired, reverted to info');
    }, ttlMinutes * 60_000);
    debugTimer.unref?.();
  }
}

// --- File logging ---

export function isFileLoggingEnabled(): boolean {
  return fileLoggingEnabled;
}

export function setFileLoggingEnabled(enabled: boolean): void {
  fileLoggingEnabled = enabled;
  if (enabled) {
    try {
      if (!existsSync(DEFAULT_LOG_DIR)) {
        mkdirSync(DEFAULT_LOG_DIR, { recursive: true });
      }
    } catch {
      fileLoggingEnabled = false;
    }
  }
}

export function getLogFilePath(): string {
  return DEFAULT_LOG_FILE;
}

/** Read the tail of the log file for diagnostics bundle. */
export function readLogTail(): string | null {
  if (!fileLoggingEnabled || !existsSync(DEFAULT_LOG_FILE)) return null;
  try {
    const stat = statSync(DEFAULT_LOG_FILE);
    if (stat.size === 0) return null;
    if (stat.size <= MAX_LOG_TAIL_BYTES) {
      return readFileSync(DEFAULT_LOG_FILE, 'utf-8');
    }
    const buf = Buffer.alloc(MAX_LOG_TAIL_BYTES);
    const fd = openSync(DEFAULT_LOG_FILE, 'r');
    readSync(fd, buf, 0, MAX_LOG_TAIL_BYTES, stat.size - MAX_LOG_TAIL_BYTES);
    closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return null;
  }
}

// --- Core ---

// --- Redaction ---

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // API tokens (ww_<hex>)
  [/ww_[0-9a-f]{16,}/gi, 'ww_[REDACTED]'],
  // Bearer tokens in headers
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
  // JWT tokens (three base64 segments separated by dots)
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[JWT_REDACTED]'],
  // Generic secrets/passwords in key=value or key: value patterns
  [
    /(password|secret|token|api_key|auth|credential)["']?\s*[:=]\s*["']?[^\s"',}{]{4,}/gi,
    '$1=[REDACTED]',
  ],
  // Docker registry auth (base64)
  [/registryAuth["']?\s*[:=]\s*["']?[A-Za-z0-9+/=]{20,}/gi, 'registryAuth=[REDACTED]'],
  // IPv4 addresses (preserve localhost/loopback)
  [
    /(?<![\d.])((?!127\.0\.0\.1|0\.0\.0\.0)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\d.])/g,
    '[IP_REDACTED]',
  ],
];

export function redact(input: string): string {
  let result = input;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function shouldLog(level: string): boolean {
  return (LEVELS[level] ?? 2) <= (LEVELS[currentLevel] ?? 2);
}

function fmt(level: string, module: string, msg: string, extra?: Record<string, unknown>): string {
  if (isProd) {
    return JSON.stringify({ level, module, msg, time: Date.now(), ...extra });
  }
  const ts = new Date().toISOString().slice(11, 19);
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
  return `[${ts}] ${level.toUpperCase()} [${module}] ${msg}${extraStr}`;
}

function emit(
  level: string,
  module: string,
  msg: string,
  extra?: Record<string, unknown>,
  consoleFn: typeof console.log = console.log,
): void {
  if (!shouldLog(level)) return;
  const line = redact(fmt(level, module, msg, extra));
  consoleFn(line);
  if (fileLoggingEnabled) {
    try {
      appendFileSync(DEFAULT_LOG_FILE, `${line}\n`);
    } catch {
      // Silently ignore
    }
  }
}

export const log = {
  info: (module: string, msg: string, extra?: Record<string, unknown>) =>
    emit('info', module, msg, extra, console.log),
  warn: (module: string, msg: string, extra?: Record<string, unknown>) =>
    emit('warn', module, msg, extra, console.warn),
  error: (module: string, msg: string, extra?: Record<string, unknown>) =>
    emit('error', module, msg, extra, console.error),
  debug: (module: string, msg: string, extra?: Record<string, unknown>) =>
    emit('debug', module, msg, extra, console.log),
};
