import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import {
    PUSH_HKDF_SALT,
    PushAlertContentSchema,
    PushReadContentSchema,
    type PushReadContent,
    PushEnvelopeSchema,
    pushEncryptionInfo,
    pushMessage,
    pushRoutingMessage,
    type PushAlertContent,
    type PushEnvelope,
    type PushRouting
} from '@ruimte/pulsar';

export const encryptPush = (
    routing: PushRouting,
    publicKey: string,
    content: PushAlertContent | PushReadContent,
    sign: (message: string) => string
): PushEnvelope => {
    const ephemeral = generateKeyPairSync('x25519');
    const recipient = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: publicKey }, format: 'jwk' });
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(PUSH_HKDF_SALT), Buffer.from(pushEncryptionInfo(routing.machineId, routing.handle)), 32));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    const fitted = 'through' in content ? PushReadContentSchema.parse(content) : PushAlertContentSchema.parse(content);
    let bytes = Buffer.from(JSON.stringify(fitted));
    // APNs counts UTF-8 bytes, so a short emoji-rich command can exceed the envelope budget.
    while (bytes.length > 2200 && 'body' in fitted && fitted.body.length > 0) {
        fitted.body = fitted.body.slice(0, Math.floor(fitted.body.length / 2));
        bytes = Buffer.from(JSON.stringify(fitted));
    }
    cipher.setAAD(Buffer.from(pushRoutingMessage(routing)), { plaintextLength: bytes.length });
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString('base64url');
    const push: PushEnvelope = {
        ...routing,
        pushType: 'through' in content ? 'background' : 'alert',
        ephemeralKey: ephemeral.publicKey.export({ format: 'jwk' }).x!,
        nonce: nonce.toString('base64url'),
        ciphertext,
        signature: ''
    };
    return PushEnvelopeSchema.parse({ ...push, signature: sign(pushMessage(push)) });
};
