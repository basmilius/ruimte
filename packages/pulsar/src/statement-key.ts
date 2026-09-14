import type { PublicKey } from './keys.ts';

/*
 * The address book's statement keys, pinned in every client and daemon build: a daemon believes a
 * statement only when one of these signed it. The private half of the first one is the Worker secret
 * `STATEMENT_PRIVATE_KEY`.
 *
 * Rotating: generate a new pair (see `apps/pulsar-worker/README.md`), add its public half at the front
 * of this list and ship a release, then put the new private half in the secret once that release is
 * out. Drop the old entry in a later release. A daemon on an older build keeps refusing statements from
 * the new key until it updates, so the overlap is what keeps signing in working across the rotation.
 */
export const PULSAR_STATEMENT_PUBLIC_KEYS: readonly PublicKey[] = ['8Z2XUxof6KwRqMW-QjvpONNclpj_5bn811INsr_Lb9k'];
