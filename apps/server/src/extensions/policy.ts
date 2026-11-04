/*
 * What an extension may do, decided without doing it: the host refuses with it, and `ruimte extension test` holds an
 * author's code to the same answers. Pure, so both carry it, and it imports nothing that needs zod.
 */
import type { AgentInfo, ChatInfo, ExtensionManifest } from '@ruimte/contracts';
import { missingPermissionMessage } from '@ruimte/contracts/extension-client';
import { extensionActionPermission } from '@ruimte/contracts/extension-permissions';
import { extensionAgentStatus, extensionChatOf, type ExtensionErrorCode } from '@ruimte/contracts/extension-results';

/* Why the host does not do what an extension asked, under the code it reads. */
export interface Refusal {
    code: ExtensionErrorCode;
    message: string;
}

/*
 * The machine events `server/` may follow, the `ServerEvents` of `@ruimte/extension`: the permission each takes, and
 * what of the event it hears. A chat's thread or a terminal's state says as much as reading it, so it takes that permission.
 */
const SERVER_EVENTS: Readonly<Record<string, { permission: string; payload(payload: never): object }>> = {
    'chat.status': {
        permission: 'chats.read',
        payload: ({ info }: { info: ChatInfo }) => ({ chat: extensionChatOf(info) })
    },
    'chat.event': {
        permission: 'chats.read',
        payload: ({ chatId }: { chatId: string }) => ({ chatId })
    },
    'session.status': {
        permission: 'terminals.read',
        payload: ({ sessionId, agent }: { sessionId: string; agent: AgentInfo | null }) => ({
            nodeId: sessionId,
            status: extensionAgentStatus(agent?.status, (agent?.requests?.length ?? 0) > 0)
        })
    }
};

function serverEvent(name: string): (typeof SERVER_EVENTS)[string] | null {
    return Object.hasOwn(SERVER_EVENTS, name) ? (SERVER_EVENTS[name] ?? null) : null;
}

export function permissionsOf(manifest: Pick<ExtensionManifest, 'permissions'> | null | undefined): ReadonlySet<string> {
    return new Set(Object.keys(manifest?.permissions ?? {}));
}

/* A tool only exists once its process said so, and an agent cannot ask for what it does not see. */
export function startsWithMachine(manifest: Pick<ExtensionManifest, 'autostart' | 'permissions'>): boolean {
    return manifest.autostart === true || permissionsOf(manifest).has('agents.tools');
}

/* Why `server/` may not follow this event, as its log says, or null when it may. */
export function eventRefusal(name: string, permissions: ReadonlySet<string>): string | null {
    const event = serverEvent(name);

    if (event === null) {
        return `${name} is no event an extension can follow`;
    }

    return permissions.has(event.permission) ? null : `${name} needs the permission ${event.permission} in manifest.json`;
}

/* As much of a machine event as `ServerEvents` names, or null for one an extension cannot follow. */
export function eventPayload(name: string, payload: unknown): object | null {
    return serverEvent(name)?.payload(payload as never) ?? null;
}

export function missingPermission(id: string, permission: string, permissions: ReadonlySet<string>): Refusal | null {
    if (permissions.has(permission)) {
        return null;
    }

    return { code: 'permission-denied', message: missingPermissionMessage(id, permission) };
}

/* An action of the machine, within `EXTENSION_ACTIONS` and the manifest. */
export function actionRefusal(id: string, action: string, permissions: ReadonlySet<string>): Refusal | null {
    const permission = extensionActionPermission(action);

    if (permission === null) {
        return { code: 'not-found', message: `An extension cannot ask for ${action}` };
    }

    return missingPermission(id, permission, permissions);
}

/* The asks of an extension's own storage, which takes no permission, as `useStorage` takes none. */
const STORAGE_ASKS: ReadonlySet<string> = new Set(['storage.get', 'storage.set', 'storage.delete']);

/* What `server/` asks the host, each behind the permission it names: `action` takes the action's own. */
export function askRefusal(id: string, method: string, args: readonly unknown[], permissions: ReadonlySet<string>): Refusal | null {
    if (STORAGE_ASKS.has(method)) {
        return null;
    }

    if (method === 'action') {
        return actionRefusal(id, String(args[1]), permissions);
    }

    if (method === 'languages.add') {
        return missingPermission(id, 'languages.servers', permissions);
    }

    return missingPermission(id, method === 'chats.list' || method === 'chats.read' ? 'chats.read' : method, permissions);
}

// A loop of an extension and a chat costs the person's plan, so a chat stops listening well before that hurts.
export const MAX_SENDS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;

/* The sends of each extension to each chat in the last hour, on the clock it is given. */
export class SendLimit {
    private readonly sends = new Map<string, number[]>();
    private readonly now: () => number;

    constructor(now: () => number) {
        this.now = now;
    }

    /* Counts a send, or refuses one past the limit without counting it. */
    take(id: string, chatId: string): Refusal | null {
        const now = this.now();
        const key = `${id}:${chatId}`;
        const recent = (this.sends.get(key) ?? []).filter((at) => now - at < HOUR_MS);

        if (recent.length >= MAX_SENDS_PER_HOUR) {
            this.sends.set(key, recent);

            return { code: 'limit', message: `${id} sent ${chatId} ${MAX_SENDS_PER_HOUR} messages this hour and has to wait` };
        }

        this.sends.set(key, [...recent, now]);

        return null;
    }
}

export const SCHEDULE_NEEDS_CLOCK = 'schedule needs the permission clock in manifest.json';

const UNITS: Readonly<Record<string, number>> = { s: 1000, m: 60_000, h: 3_600_000 };
const MIN_EVERY_MS = 10_000;
// The longest delay a timer holds; past it Bun and Node fire after 1 ms instead.
const MAX_EVERY_MS = 2 ** 31 - 1;

/* How often `schedule` runs a task, from like 30s, 5m or 1h, of at least 10 seconds and at most 596 hours. A wrong one is the author's mistake. */
export function everyMs(every: string): number {
    const match = /^(\d+)([smh])$/.exec(every);
    const ms = match === null ? 0 : Number(match[1]) * (UNITS[match[2] as string] as number);

    if (!Number.isFinite(ms) || ms < MIN_EVERY_MS || ms > MAX_EVERY_MS) {
        throw new Error(`schedule takes something like 30s, 5m or 1h, of at least 10 seconds and at most 596h, not ${every}`);
    }

    return ms;
}
