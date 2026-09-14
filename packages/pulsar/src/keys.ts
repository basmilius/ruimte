import { z } from 'zod';

/*
 * The shapes key material travels in, the same ones `apps/server/src/auth/keys.ts` and the client's
 * WebCrypto produce: raw ed25519 bytes in base64url without padding. Checking the length here keeps
 * a string that could never verify from reaching a verifier, a Map or a database row.
 */

// 32 raw bytes.
export const PublicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a raw ed25519 public key in base64url');
export type PublicKey = z.infer<typeof PublicKeySchema>;

// 64 raw bytes.
export const SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/, 'Expected an ed25519 signature in base64url');
export type Signature = z.infer<typeof SignatureSchema>;

// At least 16 random bytes, so a nonce is never short enough to guess; the upper bound only keeps a frame small.
export const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/, 'Expected a nonce in base64url');
export type Nonce = z.infer<typeof NonceSchema>;

// The id a daemon mints for itself and keeps in `endpoint.json`.
export const MachineIdSchema = z.string().min(1).max(128);
export type MachineId = z.infer<typeof MachineIdSchema>;
