import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
// NIST SP 800-38D recommends 96-bit (12-byte) IVs for GCM.
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

let derivedKey: Buffer | null = null;

/**
 * SEC-02: must be called once at startup with a per-deployment salt loaded from
 * (or persisted to) the database.  The old fallback of "watchwarden-salt" was a
 * publicly known constant that weakened scrypt against offline dictionary attacks
 * on any installation that used a weak ENCRYPTION_KEY.
 *
 * Call sequence in index.ts:
 *   1. Load `encryption_salt` from config table (or generate + store a fresh random one).
 *   2. Call `initCrypto(salt)` before the first encrypt/decrypt operation.
 */
export function initCrypto(salt: string): void {
	if (!salt || salt.length < 16) {
		throw new Error(
			"ENCRYPTION_SALT must be at least 16 characters (loaded from DB)",
		);
	}
	const raw = process.env["ENCRYPTION_KEY"];
	if (!raw) throw new Error("ENCRYPTION_KEY env var is required");

	derivedKey = scryptSync(raw, salt, KEY_LENGTH);
}

function getKey(): Buffer {
	if (derivedKey) return derivedKey;
	throw new Error(
		"Crypto not initialised — call initCrypto(salt) during startup before encrypting/decrypting",
	);
}

export function encrypt(plaintext: string): string {
	const key = getKey();
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(plaintext, "utf8", "base64");
	encrypted += cipher.final("base64");
	const authTag = cipher.getAuthTag();

	return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
	const key = getKey();
	const parts = ciphertext.split(":");
	if (parts.length !== 3) {
		throw new Error("Invalid ciphertext format");
	}

	const iv = Buffer.from(parts[0]!, "base64");
	const authTag = Buffer.from(parts[1]!, "base64");
	const encrypted = parts[2]!;

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	let decrypted = decipher.update(encrypted, "base64", "utf8");
	decrypted += decipher.final("utf8");
	return decrypted;
}

export function resetKey(): void {
	derivedKey = null;
}
