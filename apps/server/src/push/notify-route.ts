import { MACHINE_NOTIFY_MAX_TEXT, MachineNotifyRequestSchema } from '@ruimte/contracts';
import { decideAccess, isOwner, type AccessOptions } from '../auth/access.ts';
import type { MessageHost } from '../canvas/host.ts';
import { errorText } from '../error-text.ts';

/* `ruimte notify`: only the local secret, since a process that holds it is a person on this machine. */
export async function handleMachineNotify(
    request: Request,
    remoteAddress: string,
    access: AccessOptions,
    messages: Pick<MessageHost, 'alert'>
): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    const decision = await decideAccess(request, remoteAddress, access, 'local');
    if (!decision.ok || !isOwner(decision.access)) {
        return new Response('Forbidden', { status: 403 });
    }
    const parsed = MachineNotifyRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return new Response(`Expected a node id and a text of at most ${MACHINE_NOTIFY_MAX_TEXT} characters`, { status: 400 });
    }
    try {
        messages.alert(parsed.data.nodeId, parsed.data.text);
    } catch (e) {
        return Response.json({ code: 'node-not-found', message: errorText(e) }, { status: 422 });
    }
    return Response.json({ nodeId: parsed.data.nodeId });
}
