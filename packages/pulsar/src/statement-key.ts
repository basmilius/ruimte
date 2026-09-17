import type { PublicKey } from './keys.ts';

/*
 * Rotate by shipping the new public key first, then changing `STATEMENT_PRIVATE_KEY`, and removing
 * the old key in a later release. The overlap keeps older daemons accepting statements.
 */
export const PULSAR_STATEMENT_PUBLIC_KEYS: readonly PublicKey[] = ['8Z2XUxof6KwRqMW-QjvpONNclpj_5bn811INsr_Lb9k'];
