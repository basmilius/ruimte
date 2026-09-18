import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, verify } from 'node:crypto';
import { PUSH_HKDF_SALT, PushEnvelopeSchema, pushEncryptionInfo, pushMessage, pushRoutingMessage } from '../../../packages/pulsar/src';

const input = JSON.parse(await Bun.stdin.text()) as {
    push: unknown;
    recipientPrivateKey: string;
    recipientPublicKey: string;
    daemonPublicKey: string;
};
const push = PushEnvelopeSchema.parse(input.push);
if (push.pushType === 'liveactivity') {
    throw new Error('Expected an encrypted push');
}
const recipient = createPrivateKey({
    key: {
        kty: 'OKP',
        crv: 'X25519',
        d: input.recipientPrivateKey,
        x: input.recipientPublicKey
    },
    format: 'jwk'
});
const ephemeral = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: push.ephemeralKey }, format: 'jwk' });
const shared = diffieHellman({ privateKey: recipient, publicKey: ephemeral });
const key = Buffer.from(
    hkdfSync('sha256', shared, Buffer.from(PUSH_HKDF_SALT), Buffer.from(pushEncryptionInfo(push.machineId, push.handle)), 32)
);
const encrypted = Buffer.from(push.ciphertext, 'base64url');
const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(push.nonce, 'base64url'), { authTagLength: 16 });
decipher.setAAD(Buffer.from(pushRoutingMessage(push)), { plaintextLength: encrypted.length - 16 });
decipher.setAuthTag(encrypted.subarray(-16));
const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
const daemon = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: input.daemonPublicKey }, format: 'jwk' });
if (!verify(null, Buffer.from(pushMessage(push)), daemon, Buffer.from(push.signature, 'base64url'))) {
    throw new Error('Invalid daemon signature');
}
process.stdout.write(plaintext);
