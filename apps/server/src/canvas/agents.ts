import { ToolRefusal } from '@adecore/agents/context';
import { narrowerMode } from '@adecore/agents/providers';
import { MAX_PROMPT_LENGTH } from '@ruimte/actions';
import { AgentKindSchema, spellsOutMembers, type AgentKind, type ProjectCanvasView, type ProjectNode, type RuntimeMode } from '@ruimte/contracts';
import { z } from 'zod';
import { DEFAULT_RUNTIME_MODE } from '../providers/launch.ts';
import { shippedProviders, tableKinds } from '../providers/table.ts';
import { field, orNote, type AgentStartHost, type CanvasHost, type AgentCall } from './host.ts';
import { MAX_LINKS } from './links.ts';
import type { placeInGroup, Rect } from './placement.ts';
import { readPromptFile } from './project-paths.ts';

/* The CLIs the daemon ships with, in menu order; an agent a person installed from the ACP registry comes on top. */
export const AGENT_KINDS = tableKinds();

/* A kind an agent may name. Whether this machine offers and has it is asked of its providers, where the agent starts. */
export function agentKindField(what: string) {
    const message = () => `${what} needs a CLI: ${AGENT_KINDS.join(', ')}, or the kind of an agent installed from the ACP registry`;
    return z.string({ error: message }).refine((kind) => AgentKindSchema.safeParse(kind).success, { error: message });
}

/* The shipped CLIs with a chat backend; the rest only ever runs in a shell, so an agent of theirs is always a terminal. */
export function chatKinds(): AgentKind[] {
    return shippedProviders()
        .filter((provider) => provider.capabilities.chat)
        .map((provider) => provider.kind);
}

interface AgentNodeSpec {
    id: string;
    chat: boolean;
    kind: AgentKind;
    /* The CLI's name, which titles the node when the agent chose none. */
    kindName: string;
    title: string | undefined;
    rect: Rect;
    cwd: string | undefined;
    /* Terminal only: the mode its CLI starts in, kept on the node so a reload starts it the same way. */
    runtimeMode?: RuntimeMode;
    /* The account of the CLI on this machine, kept on the node so a reload starts it under the same one. */
    account?: string;
}

/* The node a person's own click would have made: titled after the CLI, and a chat fixed to it, so
   its composer shows a badge instead of a model picker (`addAgentNode` in the client). */
export function agentNode(spec: AgentNodeSpec): ProjectNode {
    return {
        id: spec.id,
        kind: spec.chat ? 'chat' : 'terminal',
        title: spec.title ?? spec.kindName,
        // A title the agent chose is not one the session may rename, the rule a person's typing follows.
        ...(spec.title === undefined ? {} : { titleSource: 'user' as const }),
        ...spec.rect,
        provider: spec.kind,
        ...(spec.chat ? { providerFixed: true } : {}),
        ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
        ...(spec.account === undefined ? {} : { account: spec.account }),
        ...(spec.chat || spec.runtimeMode === undefined ? {} : { runtimeMode: spec.runtimeMode })
    };
}

/*
 * The account a child starts under when the call names none: its opener's when it runs the same CLI,
 * named even when that is the default one so the order of the accounts does not replace it; else none,
 * which starts it where its project or that order says. One the child's project turned off is dropped
 * rather than refused, since nobody chose it. An agent names an account only as `namedAccount` allows,
 * since an account is someone's costs.
 */
function inheritedAccount(call: AgentCall, kind: AgentKind, projectId: string): string | undefined {
    const opener = call.host.starts.accountOf?.(call.caller) ?? null;
    const account = opener !== null && opener.kind === kind ? (opener.account ?? kind) : undefined;
    return account !== undefined && call.host.starts.accountsOff?.(projectId, kind).includes(account) ? undefined : account;
}

// The composer's `@account:<cli>/<id>`, with the id as `ProviderAccountIdSchema` spells it, so punctuation after it is no part of it.
const ACCOUNT_TOKEN = /(?<=^|[\s([{"'“‘])@account:([a-z0-9][a-z0-9-]*)\/([a-z][a-z0-9_-]{0,63})(?![a-z0-9_-])/g;

/* The CLIs a person named this account for with `@account:<cli>/<id>`, in the messages of their own turns of the calling chat. */
async function accountNamedFor(call: AgentCall, account: string): Promise<Set<string>> {
    const items = (await call.host.chatThreads?.items(call.caller)) ?? [];
    const agentTurns = new Set(items.flatMap((item) => (item.kind === 'turn' && item.origin === 'agent' ? [item.id] : [])));
    const clis = new Set<string>();

    for (const item of items) {
        if (item.kind !== 'user' || (item.turnId !== null && agentTurns.has(item.turnId))) {
            continue;
        }

        for (const found of item.text.matchAll(ACCOUNT_TOKEN)) {
            if (found[2] === account) {
                clis.add(found[1]!);
            }
        }
    }

    return clis;
}

/*
 * The account a call names for a child, or the inherited one when it names none. An agent may pass on
 * only an account a person spelled in its own chat, for the CLI the child runs, on this machine, and
 * one the project offers.
 */
export async function namedAccount(
    call: AgentCall,
    kind: AgentKind,
    projectId: string,
    account: string | null | undefined,
    machine: string | null | undefined
): Promise<string | undefined> {
    if (account == null) {
        return inheritedAccount(call, kind, projectId);
    }
    if (machine != null) {
        throw new ToolRefusal('account-elsewhere', `account names an account of this machine, and the agent runs on ${machine}; leave account out`);
    }

    const named = await accountNamedFor(call, account);

    if (named.size === 0) {
        throw new ToolRefusal('account-not-named', `account takes only an account a person named in this chat as @account:<cli>/${account}; leave account out`);
    }
    if (!named.has(kind)) {
        throw new ToolRefusal('account-other-cli', `${account} was named for ${[...named].join(', ')}, and the agent runs ${kind}`);
    }
    if (call.host.starts.accountsOff?.(projectId, kind).includes(account)) {
        throw new ToolRefusal('account-off', `This project turned ${account} off for ${kind}; leave account out`);
    }

    return account;
}

/* The mode a terminal agent is written down with: the one asked for, else the person's default narrowed to the caller's. */
export function terminalMode(call: AgentCall, requested: RuntimeMode | undefined, ceiling: RuntimeMode): RuntimeMode {
    return requested ?? narrowerMode(call.host.starts.terminalModePreference() ?? DEFAULT_RUNTIME_MODE, ceiling);
}

export function groupLines(canvas: ProjectCanvasView): string[] {
    return orNote(
        canvas.nodes.filter((node) => node.kind === 'group').map((node) => `group\t${node.id}\t${field(node.title)}`),
        `${canvas.id} has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas`
    );
}

/* The group as it has to become: big enough for what was put in it, and naming it once it spells out its members. */
export function grownGroup(group: ProjectNode, placement: ReturnType<typeof placeInGroup> | null, memberId: string): ProjectNode {
    if (!placement) {
        return group;
    }
    const collapsed = group.collapsed === true;
    return {
        ...group,
        w: placement.grown.w,
        // While it is collapsed its own height is the header; the height it opens to is what grew.
        ...(collapsed ? { expandedHeight: placement.grown.h } : { h: placement.grown.h }),
        ...(spellsOutMembers(group) ? { memberIds: [...(group.memberIds ?? []), memberId] } : {})
    };
}

export function readsOf(ids: readonly string[] | null): string[] {
    const reads = [...new Set(ids ?? [])];
    if (reads.length > MAX_LINKS) {
        throw new ToolRefusal('too-many-links', `reads names ${reads.length} nodes and at most ${MAX_LINKS} may be linked at once`);
    }
    return reads;
}

export function requireInstalled(starts: Pick<AgentStartHost, 'provider'>, installed: readonly AgentKind[], kind: AgentKind, role?: string): void {
    if (installed.includes(kind)) {
        return;
    }
    throw new ToolRefusal(
        'cli-not-installed',
        `${role === undefined ? '' : `${role}: `}${starts.provider(kind).name} is not installed on this machine`,
        installed.length === 0
            ? ['note\tNo agent CLI is installed on this machine']
            : installed.map((candidate) => `cli\t${candidate}\t${starts.provider(candidate).name}`)
    );
}

/* The first prompt, from whichever field carried it, checked against the one length a line into a shell survives. */
export async function startPrompt(prompt: string | null, promptFile: string | null, host: CanvasHost, folder: string): Promise<string | null> {
    if (prompt !== null && promptFile !== null) {
        throw new ToolRefusal('prompt-twice', 'prompt and promptFile both say what to start on; give one of them');
    }
    let text = prompt;
    if (promptFile !== null) {
        text = await readPromptFile(folder, promptFile, (path) => host.checkouts.paths(path));
    }
    if (text === null) {
        return null;
    }
    text = text.trim();
    if (text === '') {
        throw new ToolRefusal('empty-prompt', 'The prompt is empty; leave prompt out to open an agent that waits for its person');
    }
    if (text.length > MAX_PROMPT_LENGTH) {
        throw new ToolRefusal(
            'prompt-too-long',
            `The prompt is ${text.length} characters and at most ${MAX_PROMPT_LENGTH} fit on the line a CLI is started with; put the rest in a file and tell the agent to read it`
        );
    }
    return text;
}
