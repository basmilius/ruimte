import type { ActionName } from '@ruimte/actions';
import { DAEMON_VOICE_ACTIONS } from '@ruimte/voice';

/*
 * The fields Voice may fill per action of the matrix; every other field of the action stays null. `null`
 * leaves an action to the catalog's own split between actors, for a read whose every voice field is safe.
 * A field in `off` may be given only as false: a boolean Voice must never turn on.
 */
interface FieldRule {
    fields: readonly string[] | null;
    off?: readonly string[];
}

export const VOICE_FIELD_RULES: Readonly<Record<string, FieldRule>> = {
    'project.list': { fields: null },
    'project.switch': { fields: ['endpointId', 'projectId'] },
    'workspace.inspect': { fields: null },
    // Voice reaches only the machine its session runs on, so it names no machine.
    'target.resolve': { fields: ['target', 'names', 'nodeKind', 'scope'] },
    'chat.read': { fields: ['chatId', 'limit'] },
    'chat.inspect': { fields: null },
    'agents.inspect': { fields: null },
    'chat.send': { fields: ['chatId', 'prompt', 'delivery'] },
    // Not `force`: a person's composer asks on a busy chat, and Voice's question already said the turn stops.
    'chat.clear': { fields: ['chatId'] },
    // A chat with the person's CLI and model, never a terminal; a worktree, a task, another folder or machine are an agent's fields.
    'agent.start': { fields: ['provider', 'prompt', 'viewId', 'beside', 'title', 'model', 'effort', 'mode', 'requestId'], off: ['terminal'] }
};

export interface VoiceRefusal {
    code: string;
    message: string;
}

/* What Voice of one session may run through the daemon's registry, checked before every call and again before a confirmation. */
export interface VoicePolicy {
    readonly actions: ReadonlySet<ActionName>;
    check(name: string, input: Readonly<Record<string, unknown>>): VoiceRefusal | null;
}

function given(value: unknown): boolean {
    return value !== null && value !== undefined && value !== false;
}

/*
 * The policy of a session, derived from `DAEMON_VOICE_ACTIONS`. The registry checks the actor and the
 * catalog's fields as well; this is what keeps Voice off every daemon handler that an agent's verb would
 * reach, whatever a catalog entry opens to Voice for the desktop.
 */
export function voicePolicy(): VoicePolicy {
    const actions: ReadonlySet<ActionName> = new Set(DAEMON_VOICE_ACTIONS.map((action) => action.name));
    return {
        actions,
        check(name, input) {
            if (!actions.has(name as ActionName)) {
                return { code: 'not-for-voice', message: `Voice cannot run “${name}” on this machine.` };
            }
            const rule = VOICE_FIELD_RULES[name];
            if (rule === undefined) {
                return { code: 'not-for-voice', message: `Voice cannot run “${name}” on this machine.` };
            }
            for (const field of rule.off ?? []) {
                if (input[field] === true) {
                    return { code: 'voice-field', message: `Voice may not set “${field}” for “${name}”.` };
                }
            }
            if (rule.fields === null) {
                return null;
            }
            const allowed = new Set([...rule.fields, ...(rule.off ?? [])]);
            const field = Object.keys(input).find((key) => !allowed.has(key) && given(input[key]));
            return field === undefined ? null : { code: 'voice-field', message: `Voice may not give “${field}” to “${name}”.` };
        }
    };
}
