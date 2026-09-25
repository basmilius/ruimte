import { AgentKindSchema, type AgentKind, type ProjectCanvasView, type ProjectNode, type RuntimeMode } from '@ruimte/contracts';
import { MAX_PROMPT_LENGTH } from '@ruimte/actions';
import { DEFAULT_RUNTIME_MODE } from '../providers/launch.ts';
import { providerFor } from '../providers/registry.ts';
import { MAX_LINKS } from './links.ts';
import { narrowerMode } from './mode.ts';
import type { placeInGroup, Rect } from './placement.ts';
import { readPromptFile } from './project-paths.ts';
import { VerbRefusal, field, orNote, type CanvasHost, type VerbCall } from './verb.ts';

export const AGENT_KINDS = AgentKindSchema.options;

/* The CLIs with a chat backend; the rest only ever runs in a shell, so an agent of theirs is always a terminal. */
export const chatKinds = (): AgentKind[] => AGENT_KINDS.filter((kind) => providerFor(kind).capabilities.chat);

export const nameOf = (kind: AgentKind): string => providerFor(kind).name;

export interface AgentNodeSpec {
    id: string;
    chat: boolean;
    kind: AgentKind;
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
export const agentNode = (spec: AgentNodeSpec): ProjectNode => ({
    id: spec.id,
    kind: spec.chat ? 'chat' : 'terminal',
    title: spec.title ?? nameOf(spec.kind),
    // A title the agent chose is not one the session may rename, the rule a person's typing follows.
    ...(spec.title === undefined ? {} : { titleSource: 'user' as const }),
    ...spec.rect,
    provider: spec.kind,
    ...(spec.chat ? { providerFixed: true } : {}),
    ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
    ...(spec.account === undefined ? {} : { account: spec.account }),
    ...(spec.chat || spec.runtimeMode === undefined ? {} : { runtimeMode: spec.runtimeMode })
});

/*
 * The account a child starts under: its opener's when it runs the same CLI, named even when that is
 * the default one so the person's pick for new agents does not replace it; else none, which starts
 * it under that pick. Never one the agent picks, since an account is someone's costs.
 */
export const inheritedAccount = (call: VerbCall, kind: AgentKind): string | undefined => {
    const opener = call.host.accountOf?.(call.caller) ?? null;
    return opener !== null && opener.kind === kind ? (opener.account ?? kind) : undefined;
};

/* The mode a terminal agent is written down with: the one asked for, else the person's default narrowed to the caller's. */
export const terminalMode = (call: VerbCall, requested: RuntimeMode | undefined, ceiling: RuntimeMode): RuntimeMode =>
    requested ?? narrowerMode(call.host.terminalModePreference() ?? DEFAULT_RUNTIME_MODE, ceiling);

export const groupLines = (canvas: ProjectCanvasView): string[] =>
    orNote(
        canvas.nodes.filter((node) => node.kind === 'group').map((node) => `group\t${node.id}\t${field(node.title)}`),
        `${canvas.id} has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas`
    );

/* The group as it has to become: big enough for what was put in it, and naming it while it is collapsed. */
export const grownGroup = (group: ProjectNode, placement: ReturnType<typeof placeInGroup> | null, memberId: string): ProjectNode => {
    if (!placement) {
        return group;
    }
    const collapsed = group.collapsed === true;
    return {
        ...group,
        w: placement.grown.w,
        // While it is collapsed its own height is the header; the height it opens to is what grew.
        ...(collapsed ? { expandedHeight: placement.grown.h } : { h: placement.grown.h }),
        ...(collapsed ? { memberIds: [...(group.memberIds ?? []), memberId] } : {})
    };
};

/* The nodes a new agent reads from its first turn, held to the count one call may link at once. */
export const readsOf = (ids: readonly string[] | null): string[] => {
    const reads = [...new Set(ids ?? [])];
    if (reads.length > MAX_LINKS) {
        throw new VerbRefusal('too-many-links', `--reads names ${reads.length} nodes and at most ${MAX_LINKS} may be linked at once`);
    }
    return reads;
};

/* Refuses a CLI this machine does not have; `role` names the role of a team it belongs to. */
export const requireInstalled = (installed: readonly AgentKind[], kind: AgentKind, role?: string): void => {
    if (installed.includes(kind)) {
        return;
    }
    throw new VerbRefusal(
        'cli-not-installed',
        `${role === undefined ? '' : `${role}: `}${nameOf(kind)} is not installed on this machine`,
        installed.length === 0 ? ['note\tNo agent CLI is installed on this machine'] : installed.map((candidate) => `cli\t${candidate}\t${nameOf(candidate)}`)
    );
};

/* The first prompt, from whichever field carried it, checked against the one length a line into a shell survives. */
export const startPrompt = async (prompt: string | null, promptFile: string | null, host: CanvasHost, folder: string): Promise<string | null> => {
    if (prompt !== null && promptFile !== null) {
        throw new VerbRefusal('prompt-twice', '--prompt and --prompt-file both say what to start on; give one of them');
    }
    let text = prompt;
    if (promptFile !== null) {
        text = await readPromptFile(folder, promptFile, (path) => host.worktreePaths(path));
    }
    if (text === null) {
        return null;
    }
    text = text.trim();
    if (text === '') {
        throw new VerbRefusal('empty-prompt', 'The prompt is empty; leave the flag out to open an agent that waits for its person');
    }
    if (text.length > MAX_PROMPT_LENGTH) {
        throw new VerbRefusal(
            'prompt-too-long',
            `The prompt is ${text.length} characters and at most ${MAX_PROMPT_LENGTH} fit on the line a CLI is started with; put the rest in a file and tell the agent to read it`
        );
    }
    return text;
};
