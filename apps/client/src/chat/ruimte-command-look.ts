import i18next from 'i18next';
import { createElement } from 'react';
import type { CommandLook, CommandLookMatch, CommandName } from '@adecore/agents-react';
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

// The shape of a node id; a view id such as `main` is only taken for one after `--view`.
const NODE_ID = /^[a-z]+-[a-z0-9]+$/;

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
        if (named === undefined || named.name === '' || !(NODE_ID.test(word) || (named.view && option === '--view'))) {
            return null;
        }
        return { name: named.name, icon: named.icon };
    };
}

/* `ruimte-context` as a tool of Ruimte's own in a chat, with the mark, the name of the part it works on and titles for ids. */
const RUIMTE_COMMAND_LOOK: CommandLook = {
    program: 'ruimte-context',
    brand: 'Ruimte',
    Mark: RuimteMark,
    describe: describeContextCall,
    sentence: (count) => i18next.t('chat:commandLook.usedAny', { count }),
    useNames: useContextNames
};

export const RUIMTE_COMMAND_LOOKS: readonly CommandLook[] = [RUIMTE_COMMAND_LOOK];
