import { auxWindowKey } from '@ruimte/desktop-bridge';
import { z } from 'zod';
import { desktop } from '@/desktop/bridge';
import type { CellAt, SplitZone } from '@/layout/split';
import type { Tab } from '@/state/files';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { auxWindowId } from '@/state/window-target';
import { fireAndForget } from '@/transport-api/transport';

/* A view of the project goes by its id. A loose view goes whole, since only the page that has it open holds its content (`state/files.ts`). */
export const ItemSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('view'), id: z.string().min(1) }),
    // Only the key is checked, since the tab comes from this app's own page in another window.
    z.object({ kind: z.literal('loose'), tab: z.custom<Tab>((value) => typeof (value as { key?: unknown } | null)?.key === 'string') })
]);
export type WindowItem = z.infer<typeof ItemSchema>;

const PlaceSchema = z.object({
    at: z.object({ column: z.number().int().nonnegative(), cell: z.number().int().nonnegative() }),
    zone: z.enum(['left', 'right', 'up', 'down', 'center']),
    index: z.number().int().nonnegative().nullable()
});

export interface WindowPlace {
    at: CellAt;
    zone: SplitZone;
    index: number | null;
}

const MessageSchema = z.discriminatedUnion('type', [
    /* A new auxiliary window asks whoever opened it for its views. */
    z.object({ type: z.literal('ready') }),
    /* The answer to `ready` while the drag that opened the window is still under way. The views come when it ends, unless something else takes them. */
    z.object({ type: z.literal('wait'), items: z.array(ItemSchema).min(1) }),
    /* The answer to `ready` of a window that opened none. */
    z.object({ type: z.literal('none') }),
    /* The sender already let go of the views. Without a place they join the tabs of the receiver's focused cell. */
    z.object({ type: z.literal('give'), items: z.array(ItemSchema).min(1), place: PlaceSchema.nullable() }),
    /* The sender took these out of a drag, so the receiver lets go of them. */
    z.object({ type: z.literal('took'), ids: z.array(z.string().min(1)).min(1) }),
    z.object({ type: z.literal('show'), viewId: z.string().min(1) }),
    /* A command an auxiliary window leaves to the window that has the project. */
    z.object({ type: z.literal('run'), command: z.string().min(1) }),
    /* The project closed, and its auxiliary windows go with it. */
    z.object({ type: z.literal('leave') })
]);
export type WindowMessage = z.infer<typeof MessageSchema>;

export function readWindowMessage(text: string): WindowMessage | null {
    try {
        const parsed = MessageSchema.safeParse(JSON.parse(text));

        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/* The key the shell knows the project on screen by, or null on the start screen. */
export function projectKey(): string | null {
    const { current, currentEndpointId } = useProject.getState();

    return current !== null && currentEndpointId !== null ? endpointKey(currentEndpointId, current.projectId) : null;
}

/* The key this window claimed for the project on screen. */
export function ownWindowKey(): string | null {
    const project = projectKey();
    const aux = auxWindowId();

    return project === null || aux === null ? project : auxWindowKey(project, aux);
}

/* False when no window has the key, or the shell hands no messages on. */
export function postToWindow(to: string, message: WindowMessage): Promise<boolean> {
    return (
        desktop()
            ?.postToWindow?.(to, JSON.stringify(message))
            .catch(() => false) ?? Promise.resolve(false)
    );
}

export function tellWindow(to: string, message: WindowMessage): void {
    void fireAndForget('postToWindow', postToWindow(to, message));
}

/* A shell from before auxiliary windows lacks these, and a browser has no shell at all. */
export function canMoveViews(): boolean {
    const shell = desktop();

    return typeof shell?.postToWindow === 'function' && typeof shell.auxWindows === 'function' && typeof shell.openWindow === 'function';
}
