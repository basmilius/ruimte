import { createHmac } from 'node:crypto';
import { localSecretChannelMessage } from '@ruimte/contracts';

export const localSecretProof = (secret: string, daemonId: string, challenge: string, binding: string): string =>
    createHmac('sha256', secret)
        .update(localSecretChannelMessage(daemonId, challenge, binding))
        .digest('base64url');
