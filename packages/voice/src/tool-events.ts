import type { LiveEvent } from './live-event.ts';

export interface LiveFunctionCall {
    callId: string;
    name: string;
    arguments: string;
}

/* A backend response event of one delegation, and the call it finished when it finished one of the offered tools. */
export interface LiveToolEvent {
    delegationId: string;
    type: string;
    call: LiveFunctionCall | null;
}

function functionCallOf(nested: { type?: unknown; item?: unknown }, toolNames: ReadonlySet<string>): LiveFunctionCall | null {
    if (nested.type !== 'response.output_item.done' || typeof nested.item !== 'object' || nested.item === null) {
        return null;
    }
    const item = nested.item as { type?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown };
    if (
        item.type !== 'function_call' ||
        typeof item.call_id !== 'string' ||
        typeof item.name !== 'string' ||
        !toolNames.has(item.name) ||
        typeof item.arguments !== 'string'
    ) {
        return null;
    }
    return { callId: item.call_id, name: item.name, arguments: item.arguments };
}

/* A call to a tool that was never offered is no call: the service would not have sent it, so nothing runs it. */
export function parseLiveToolEvent(event: LiveEvent, toolNames: ReadonlySet<string>): LiveToolEvent | null {
    if (event.type !== 'response.event' || typeof event.delegation_id !== 'string' || typeof event.event !== 'object' || event.event === null) {
        return null;
    }
    const nested = event.event as { type?: unknown; item?: unknown };
    if (typeof nested.type !== 'string') {
        return null;
    }
    return { delegationId: event.delegation_id, type: nested.type, call: functionCallOf(nested, toolNames) };
}
