import { z } from 'zod';
import { decideAccess, isOwner, type AccessOptions } from '../auth/access.ts';
import type { VoiceKeyStore } from './key-store.ts';

const VoiceKeyRequestSchema = z.object({ key: z.string() });

/*
 * `POST /machine/voice-key` with the key the desktop app's settings saved, `DELETE` when a person removed it there.
 * Local secret only. The removal is the shell's to report, since the key it hands over otherwise stays here and starts Voice.
 */
export async function handleVoiceKeyRequest(
    request: Request,
    remote: string,
    access: AccessOptions,
    keys: Pick<VoiceKeyStore, 'write' | 'clear'>
): Promise<Response> {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
        return new Response('Method not allowed', { status: 405 });
    }

    const decision = await decideAccess(request, remote, access, 'local');

    if (!decision.ok || !isOwner(decision.access)) {
        return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'DELETE') {
        await keys.clear();

        return new Response(null, { status: 204 });
    }

    const parsed = VoiceKeyRequestSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
        return new Response('Expected a key', { status: 400 });
    }

    try {
        await keys.write(parsed.data.key);
    } catch (e) {
        // The store says what is wrong without quoting the key.
        return new Response(e instanceof Error ? e.message : 'The key could not be saved', { status: 400 });
    }

    return new Response(null, { status: 204 });
}
