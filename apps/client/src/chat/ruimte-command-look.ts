import i18next from 'i18next';
import { createElement } from 'react';
import type {
    CommandLook,
    CommandLookCall,
    CommandLookMatch,
    CommandLookSent,
    CommandName,
    ToolLook,
    ToolLookCall,
    ToolLookMatch
} from '@adecore/agents-react';
import { unescapeText } from '@ruimte/actions/text-escapes';
import type { ContextVerb } from '@ruimte/contracts';
import { Icon } from '@adecore/ui';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { ViewGlyph } from '@/project/ViewGlyph';
import { viewGlyphOf } from '@/shell/cell-view';
import { useSidebarSource, type SidebarSource } from '@/shell/sidebar-source';
import { memoByIdentity } from '@/state/identity-memo';
import { currentEndpointId } from '@/state/keys';
import { RuimteMark } from '@/ui/RuimteMark';

/* What a verb reads as: the name after "Ruimte", and the word the detail starts at, the verb itself being 0. */
interface VerbLook {
    readonly name: string;
    readonly from: number;
}

// Names of parts of Ruimte, so they stay English in Dutch too; a sentence around one is translated.
const VERB_LOOKS: Record<ContextVerb, VerbLook> = {
    help: { name: 'Help', from: 1 },
    list: { name: 'Context', from: 0 },
    read: { name: 'Context', from: 0 },
    done: { name: 'Task', from: 0 },
    notify: { name: 'Message', from: 0 },
    alert: { name: 'Notification', from: 1 },
    answer: { name: 'Message', from: 0 },
    agent: { name: 'Agent', from: 1 },
    team: { name: 'Team', from: 1 },
    fork: { name: 'Agent', from: 0 },
    flag: { name: 'Flag', from: 1 },
    node: { name: 'Canvas', from: 0 },
    link: { name: 'Canvas', from: 0 },
    browser: { name: 'Browser', from: 1 },
    device: { name: 'Device', from: 1 },
    view: { name: 'View', from: 1 },
    task: { name: 'Task', from: 1 },
    plan: { name: 'Plan', from: 1 },
    visual: { name: 'Visual', from: 1 },
    artifact: { name: 'Output', from: 1 },
    chat: { name: 'Chat', from: 1 },
    ui: { name: 'Help', from: 0 },
    worktree: { name: 'Worktree', from: 1 },
    operation: { name: 'Task', from: 1 },
    tool: { name: 'Using an extension tool', from: 2 },
    launches: { name: 'Launches', from: 1 },
    routine: { name: 'Routines', from: 1 },
    secret: { name: 'Launches', from: 1 },
    project: { name: 'Project', from: 1 },
    database: { name: 'Database', from: 1 },
    language: { name: 'Language', from: 1 },
    template: { name: 'Templates', from: 1 },
    provider: { name: 'Providers', from: 1 },
    computer: { name: 'Computer Use', from: 1 }
};

const NO_VERB: VerbLook = { name: 'Context', from: 0 };

// Long values an agent writes into a call, cut so the options after them stay in the line.
const FOLDED = ['--prompt', '--text', '--result', '--roles', '--answers'];
const LANGUAGES = { '--sql': 'sql' };

// The shape of a node id; a view id such as `main` is only taken for one as the value of a view option or field.
const NODE_ID = /^[a-z]+-[a-z0-9]+$/;
const VIEW_OPTIONS = new Set(['--view', 'view', 'view_id']);

// The tools of the MCP server whose part of Ruimte is not their first word, by the verb they were.
const TOOL_VERBS: Readonly<Record<string, ContextVerb>> = {
    context_list: 'list',
    context_read: 'read',
    task_done: 'done',
    agent_answer: 'answer',
    agent_team: 'team',
    agent_fork: 'fork',
    guide: 'help'
};

const TOOLKIT_VERBS: Readonly<Record<string, ContextVerb>> = { launch: 'launches' };

function lookOf(verb: string | undefined): VerbLook | null {
    if (verb === undefined) {
        return NO_VERB;
    }
    return Object.hasOwn(VERB_LOOKS, verb) ? VERB_LOOKS[verb as ContextVerb] : null;
}

/* What one `ruimte-context` call reads as; a verb this client does not know reads as Ruimte alone, from the verb on. */
function describeContextCall(args: readonly string[]): CommandLookMatch {
    const look = lookOf(args[0]);
    if (look === null) {
        return { label: '', detailFrom: 0, fold: FOLDED, languages: LANGUAGES };
    }
    return {
        label: look.name,
        detailFrom: look.from,
        group: { key: look.name, sentence: (count) => i18next.t('chat:commandLook.used', { name: look.name, count }) },
        fold: FOLDED,
        languages: LANGUAGES
    };
}

/* The verb a tool of the MCP server was: its own, or its first word's. */
function verbOfTool(tool: string): string {
    const toolkit = tool.split('_')[0]!;
    if (Object.hasOwn(TOOL_VERBS, tool)) {
        return TOOL_VERBS[tool]!;
    }
    return Object.hasOwn(TOOLKIT_VERBS, toolkit) ? TOOLKIT_VERBS[toolkit]! : toolkit;
}

/*
 * What one tool of Ruimte's MCP server reads as: the name of its part of Ruimte, and its words from where the
 * call's verb would have started the detail. A toolkit this client does not know leaves it the CLI's own line.
 */
function describeTool(tool: string): ToolLookMatch | null {
    const look = lookOf(verbOfTool(tool));
    if (look === null) {
        return null;
    }
    return {
        label: look.name,
        lead: tool.split('_').slice(look.from).join(' '),
        group: { key: look.name, sentence: (count) => i18next.t('chat:commandLook.used', { name: look.name, count }) }
    };
}

interface ProjectName extends CommandName {
    readonly view: boolean;
}

/* Every view and node of the project by id, under the title it has now; one map per state of the sidebar. */
const projectNames = memoByIdentity((source: SidebarSource): ReadonlyMap<string, ProjectName> => {
    const names = new Map<string, ProjectName>();
    for (const view of source.views) {
        names.set(view.id, { name: view.name ?? '', icon: createElement(ViewGlyph, { ...viewGlyphOf(view), size: 12 }), view: true });
        for (const node of source.nodesOf(view)) {
            names.set(node.id, { name: node.title, icon: createElement(Icon, { icon: NODE_KIND_ICONS[node.kind], size: 12 }), view: false });
        }
    }
    return names;
});

/*
 * The titles of the ids in a call, from the project in this window, and only for a chat of that project:
 * a chat of another project or machine keeps its ids, since the ids it names are not here.
 */
export function useContextNames(endpointId: string, chatId: string): (word: string, option: string | null) => CommandName | null {
    const names = projectNames(useSidebarSource());
    const here = endpointId === currentEndpointId() && names.has(chatId);
    return (word: string, option: string | null): CommandName | null => {
        const named = here ? names.get(word) : undefined;
        if (named === undefined || named.name === '' || !(NODE_ID.test(word) || (named.view && option !== null && VIEW_OPTIONS.has(option)))) {
            return null;
        }
        return { name: named.name, icon: named.icon };
    };
}

/* The words of a `notify` call: one id and `--text`, and `--project` at most; null for anything else. */
function notifyWords(args: readonly string[]): { id: string; text: string; project: string | null } | null {
    const ids: string[] = [];
    const flags = new Map<string, string>();

    for (let i = 1; i < args.length; i++) {
        const word = args[i]!;

        if (!word.startsWith('--')) {
            ids.push(word);

            continue;
        }

        const equals = word.indexOf('=');
        const name = equals === -1 ? word : word.slice(0, equals);
        const value = equals === -1 ? args[++i] : word.slice(equals + 1);

        if ((name !== '--text' && name !== '--project') || value === undefined || flags.has(name)) {
            return null;
        }

        flags.set(name, value);
    }

    const [id] = ids;
    const text = flags.get('--text');

    return ids.length !== 1 || id === undefined || text === undefined ? null : { id, text, project: flags.get('--project') ?? null };
}

const REFUSALS = new Set(['self-notify', 'not-an-agent', 'unknown-node', 'node-on-other-machine']);
// `refused\t<code>` from the command, `refused <code>: <sentence>` from the MCP server.
const REFUSAL_LINE = /^refused[\t ]([a-z-]+)/;

/* How the call went, from its state and what it answered; null for a finished call whose answer says neither. */
function notifyOutcome({ state, output }: Pick<CommandLookCall, 'state' | 'output'>): Pick<CommandLookSent, 'state' | 'reason' | 'title'> | null {
    const lines = (output ?? '').split('\n');
    // A CLI may put its own line above what a failed call answered, so a refusal is looked for in all of them.
    const refused = lines.map((line) => REFUSAL_LINE.exec(line)).find((match) => match !== null);

    if (refused !== undefined || state === 'error') {
        const code = refused?.[1];

        return { state: 'failed', ...(code !== undefined && REFUSALS.has(code) ? { reason: i18next.t(`chat:commandLook.refused.${code}`) } : {}) };
    }

    if (state === 'running') {
        return { state: 'sending' };
    }

    const [word, , at, , title] = (lines[0] ?? '').split('\t');

    if (word !== 'notified' || (at !== 'now' && at !== 'waiting')) {
        return null;
    }

    return { state: at === 'now' ? 'delivered' : 'waiting', ...(title === undefined || title === '' ? {} : { title }) };
}

/* A `notify` call as the message it sent, with its text read the way the machine reads it; stdin comes as it is. */
export function sentByNotify(call: CommandLookCall): CommandLookSent | null {
    if (call.args[0] !== 'notify') {
        return null;
    }

    const words = notifyWords(call.args);

    if (words === null) {
        return null;
    }

    return sentMessage({ ...words, text: words.text === '-' ? call.heredoc : unescapeText(words.text) }, call);
}

/* The message to `id`, once there is text and the call says how it went. */
function sentMessage(
    words: { id: string; text: string | null; project: string | null },
    call: Pick<CommandLookCall, 'state' | 'output'>
): CommandLookSent | null {
    const outcome = notifyOutcome(call);

    if (words.text === null || words.text === '' || outcome === null) {
        return null;
    }

    const elsewhere = words.project === null ? {} : { title: i18next.t('chat:commandLook.inAnotherProject'), hint: words.project };

    return { to: words.id, text: words.text, ...elsewhere, ...outcome };
}

/* A call of the `notify` tool as the message it sent; the server takes its text as it is. */
export function sentByNotifyTool(call: ToolLookCall): CommandLookSent | null {
    const { id, text, project } = call.input;

    if (call.tool !== 'notify' || typeof id !== 'string' || typeof text !== 'string' || (project !== undefined && typeof project !== 'string')) {
        return null;
    }

    return sentMessage({ id, text, project: project ?? null }, call);
}

/* `ruimte-context` as a tool of Ruimte's own in a chat, with the mark, the name of the part it works on and titles for ids. */
const RUIMTE_COMMAND_LOOK: CommandLook = {
    program: 'ruimte-context',
    brand: 'Ruimte',
    Mark: RuimteMark,
    describe: describeContextCall,
    sentence: (count) => i18next.t('chat:commandLook.usedAny', { count }),
    useNames: useContextNames,
    sent: sentByNotify
};

/* The tools of the machine's MCP server, drawn the way their `ruimte-context` calls were. */
const RUIMTE_TOOL_LOOK: ToolLook = {
    server: 'ruimte',
    brand: 'Ruimte',
    Mark: RuimteMark,
    describe: describeTool,
    sentence: (count) => i18next.t('chat:commandLook.usedAny', { count }),
    useNames: useContextNames,
    sent: sentByNotifyTool
};

export const RUIMTE_COMMAND_LOOKS: readonly CommandLook[] = [RUIMTE_COMMAND_LOOK];
export const RUIMTE_TOOL_LOOKS: readonly ToolLook[] = [RUIMTE_TOOL_LOOK];
