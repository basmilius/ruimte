import i18next from 'i18next';
import { RENDERED_DOC_COMMENTS } from '@/features';
import { canSwipeBetweenPages, desktop, isDesktop } from '@/desktop/bridge';
import { closedLidOffered, keepAwakeAvailable } from '@/state/keep-awake';
import { ALL_SETTINGS_SECTIONS, sectionDescription, sectionLabel } from '@/shell/settings/sections';
import { FOLDING_GROUPS } from '@/shell/settings/folding-rows';
import { shortcutRowId, type ShortcutGroup } from '@/shell/settings/shortcuts';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { serverInfoOf } from '@/state/server';
import { useServers } from '@/state/server';
import type { SettingsSectionId } from '@/state/ui';
import { formatShortcut } from '@adecore/ui';

interface SearchEntry {
    /* The `searchId` of the row it leads to. */
    id: string;
    section: SettingsSectionId;
    /* Full i18n keys, namespace included. */
    label: string;
    description?: string;
    /* A row the pane only draws where it can act, so a result never leads to nothing. */
    available?: () => boolean;
}

/* A row whose id is also where its words sit, under `settings:<id>.label` and `.description`, in the pane its id starts with. */
function row(id: `${SettingsSectionId}.${string}`, available?: () => boolean): SearchEntry {
    return {
        id,
        section: id.slice(0, id.indexOf('.')) as SettingsSectionId,
        label: `settings:${id}.label`,
        description: `settings:${id}.description`,
        ...(available === undefined ? {} : { available })
    };
}

function hasOpenedMachine(): boolean {
    return useEndpoints.getState().endpoints.some((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID || hasLocalMachine());
}

/*
 * The rows a search can find. A pane draws only while it is open, so the rows cannot be read off the
 * screen; this list names each one by its words instead. A row that is not here is still in its pane,
 * the search just does not know it.
 */
export const SETTINGS_INDEX: readonly SearchEntry[] = [
    row('general.language'),
    row('general.region'),
    row('general.projects'),
    row('general.sidebar'),
    row('general.needsYou'),
    row('general.dock'),
    row('general.browseStart'),
    row('appearance.theme'),
    row('appearance.palette'),
    row('appearance.accent'),
    row('appearance.interface.layout'),
    row('appearance.projectGlow'),
    row('appearance.font.interface'),
    row('appearance.font.interfaceSize'),
    row('editor.colors.light'),
    row('editor.colors.dark'),
    row('editor.general.font.family'),
    row('editor.general.font.size'),
    row('editor.general.font.lineHeight'),
    row('editor.general.font.ligatures'),
    row('editor.general.display.wrap'),
    row('editor.general.display.indentGuides'),
    row('editor.general.display.whitespace'),
    row('editor.general.display.stickyScroll'),
    row('editor.general.display.rightMargin'),
    row('editor.general.navigation.camelHumps'),
    row('editor.general.saving.trailingWhitespace'),
    row('editor.general.saving.ensureFinalNewline'),
    row('editor.general.documentation.render', () => RENDERED_DOC_COMMENTS),
    row('editor.general.codeVision.usages'),
    row('editor.general.codeVision.authors'),
    row('editor.folding.outline'),
    ...FOLDING_GROUPS.flatMap((group) => group.rows.map((folding) => row(`editor.folding.${group.id}.${folding.words}`))),
    row('editor.ai.inlineAgent'),
    row('editor.ai.agentChanges'),
    row('editor.ai.attribution'),
    row('editor.ai.onDevice.help'),
    row('editor.ai.onDevice.ghost'),
    row('editor.smartKeys.pairBrackets'),
    row('editor.smartKeys.pairQuotes'),
    row('editor.smartKeys.surroundSelection'),
    row('editor.smartKeys.tabOut'),
    row('editor.smartKeys.smartEnter'),
    row('editor.smartKeys.indentOnPaste'),
    row('editor.smartKeys.smartSemicolon'),
    row('editor.smartKeys.smartArrow'),
    row('editor.templates.live'),
    row('editor.templates.postfix'),
    row('editor.templates.postfixInCompletion'),
    { id: 'editor.servers', section: 'editor', label: 'settings:editor.servers.title', description: 'settings:editor.servers.description' },
    { id: 'editor.servers.own', section: 'editor', label: 'settings:editor.servers.own.title', description: 'settings:editor.servers.own.description' },
    row('terminal.font.family'),
    row('terminal.font.size'),
    row('terminal.font.lineHeight'),
    row('terminal.links'),
    {
        id: 'views.nodeSizes',
        section: 'views',
        label: 'settings:views.nodeSizes.searchLabel',
        description: 'settings:views.nodeSizes.description',
        available: () => Object.keys(useServers.getState().byEndpoint).length > 0
    },
    row('views.canvas.minimap'),
    row('views.canvas.renderDistance'),
    row('views.drawing.snap'),
    row('views.browser.swipe', canSwipeBetweenPages),
    row('pets.enabled'),
    row('pets.place'),
    row('pets.inViews'),
    row('pets.subagents'),
    row('pets.visitor'),
    row('pets.beam'),
    row('pets.sprite'),
    row('pets.custom'),
    row('pets.agents'),
    row('files.files.openFiles'),
    row('files.files.hidden'),
    row('files.git.layout'),
    row('files.git.whitespace'),
    {
        id: 'files.worktreeFolder',
        section: 'files',
        label: 'settings:machine.worktreeFolder.label',
        description: 'settings:machine.worktreeFolder.description',
        available: hasLocalMachine
    },
    // On the detail of the CLI the pane opens on.
    {
        id: 'providers.defaults.model',
        section: 'providers',
        label: 'agent-providers:cli.defaults.model',
        description: 'agent-providers:cli.defaults.usesCliDefault'
    },
    { id: 'agents.defaults.permissions', section: 'agents', label: 'settings:agents.defaults.permissions' },
    { id: 'agents.defaults.terminalMode', section: 'agents', label: 'settings:agents.defaults.terminalMode' },
    {
        id: 'chats.streaming',
        section: 'chats',
        label: 'settings:chats.streaming.label',
        description: 'settings:chats.streaming.words.description'
    },
    row('chats.readingWidth'),
    row('chats.showToolCalls'),
    row('chats.sendKey'),
    row('chats.steerByDefault'),
    row('chats.showViews'),
    row('chats.mapTiles'),
    { id: 'agents.visualReplies', section: 'chats', label: 'settings:agents.visualReplies.label', description: 'settings:agents.visualReplies.description' },
    row('providers.apple'),
    {
        id: 'providers.acpServer',
        section: 'providers',
        label: 'settings:providers.acpServer.searchLabel',
        description: 'settings:providers.acpServer.description'
    },
    row('agents.resumeAtReset'),
    row('agents.deleteAnyView'),
    row('agents.reachOpenProjects'),
    row('agents.working.sound'),
    {
        id: 'agents.keepAwake.mode',
        section: 'agents',
        label: 'settings:agents.keepAwake.mode.label',
        description: 'settings:agents.keepAwake.mode.working.description',
        available: keepAwakeAvailable
    },
    {
        id: 'terminal.shell',
        section: 'terminal',
        label: 'settings:machine.terminalShell.label',
        description: 'settings:machine.terminalShell.description',
        available: () => hasLocalMachine() && serverInfoOf(LOCAL_ENDPOINT_ID).platform === 'win32'
    },
    {
        id: 'agents.integrations',
        section: 'terminal',
        label: 'settings:agents.integrations.title',
        description: 'settings:agents.integrations.search',
        available: hasLocalMachine
    },
    {
        id: 'agents.keepAwake.lid',
        section: 'agents',
        label: 'settings:agents.keepAwake.lid.label',
        description: 'settings:agents.keepAwake.lid.search',
        available: closedLidOffered
    },
    { id: 'usage.currency', section: 'usage', label: 'agent-usage:settings.currency.label', description: 'agent-usage:settings.currency.dollars' },
    { id: 'usage.page', section: 'usage', label: 'agent-usage:settings.page.label', description: 'agent-usage:settings.page.description' },
    {
        id: 'voice.microphone',
        section: 'voice',
        label: 'settings:voice.conversation.microphone.label',
        description: 'settings:voice.conversation.microphone.description'
    },
    {
        id: 'voice.language',
        section: 'voice',
        label: 'settings:voice.conversation.language.label',
        description: 'settings:voice.conversation.language.description'
    },
    { id: 'voice.dictation', section: 'voice', label: 'voice:dictation.enable', description: 'voice:dictation.description' },
    { id: 'voice.key', section: 'voice', label: 'settings:voice.key.label', description: 'settings:voice.key.sectionDescription' },
    {
        id: 'voice.conversationLanguage',
        section: 'voice',
        label: 'settings:voice.conversation.machineLanguage.label',
        description: 'settings:voice.conversation.machineLanguage.description'
    },
    { id: 'voice.voice', section: 'voice', label: 'settings:voice.conversation.voice.label', description: 'settings:voice.conversation.voice.description' },
    {
        id: 'voice.confirm',
        section: 'voice',
        label: 'settings:voice.conversation.confirm.label',
        description: 'settings:voice.conversation.confirm.description'
    },
    { id: 'computer.enable', section: 'agents', label: 'settings:computer.allow', description: 'settings:computer.description' },
    {
        id: 'computer.grant.accessibility',
        section: 'agents',
        label: 'settings:computer.grant.accessibility.label',
        description: 'settings:computer.grant.accessibility.description'
    },
    {
        id: 'computer.grant.screenRecording',
        section: 'agents',
        label: 'settings:computer.grant.screenRecording.label',
        description: 'settings:computer.grant.screenRecording.description'
    },
    // On the account row of the Account pane.
    { id: 'machines.signIn', section: 'machines', label: 'settings:machines.account.title', description: 'settings:machines.account.description' },
    {
        id: 'machines.thisComputer',
        section: 'machines',
        label: 'settings:machines.thisComputer.setUp.label',
        description: 'settings:machines.thisComputer.setUp.description',
        available: () => isDesktop() && !hasLocalMachine()
    },
    { id: 'machines.add', section: 'machines', label: 'settings:machines.add.title', description: 'settings:machines.add.description' },
    // On the detail of a machine this client opened: the one picked, else this machine.
    {
        id: 'machines.machine.identity',
        section: 'machines',
        label: 'settings:machineDialog.identity.title',
        description: 'settings:machineDialog.identity.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.broker',
        section: 'machines',
        label: 'settings:machine.broker.label',
        description: 'settings:machine.broker.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.lanDoor',
        section: 'machines',
        label: 'settings:machine.lanDoor.label',
        description: 'settings:machine.lanDoor.search',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.reach',
        section: 'machines',
        label: 'settings:machine.reach.label',
        description: 'settings:machine.reach.search',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.direct',
        section: 'machines',
        label: 'settings:machine.direct.label',
        description: 'settings:machine.direct.description',
        available: hasLocalMachine
    },
    {
        id: 'machines.machine.streaming',
        section: 'machines',
        label: 'settings:machine.streaming.label',
        description: 'settings:machine.streaming.description',
        available: hasOpenedMachine
    },
    // On the Storage tab of a machine's detail.
    {
        id: 'machines.machine.storage.output',
        section: 'machines',
        label: 'settings:storage.output.title',
        description: 'settings:storage.output.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.storage.cleanup',
        section: 'machines',
        label: 'settings:storage.cleanup.title',
        description: 'settings:storage.cleanup.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.storage.projects',
        section: 'machines',
        label: 'settings:storage.projects.title',
        description: 'settings:storage.projects.footer',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.usageStats',
        section: 'machines',
        label: 'settings:machine.usageStats.label',
        description: 'settings:machine.usageStats.search',
        available: hasLocalMachine
    },
    {
        id: 'machines.machine.keepRunning',
        section: 'machines',
        label: 'settings:backgroundService.keepRunning.label',
        description: 'settings:backgroundService.keepRunning.description',
        available: () => hasLocalMachine() && desktop()?.backgroundService !== undefined
    },
    {
        id: 'machines.machine.stopRunning',
        section: 'machines',
        label: 'settings:backgroundService.stopRunning.label',
        description: 'settings:backgroundService.stopRunning.description',
        available: () => hasLocalMachine() && desktop()?.machine !== undefined
    },
    row('about.updates.auto'),
    { id: 'about.onboarding', section: 'about', label: 'onboarding:about.label', description: 'onboarding:about.description', available: hasLocalMachine }
];

export interface SearchResult {
    section: SettingsSectionId;
    /* English words that also find this result without being shown; set only outside English. */
    english?: string;
    /* The row to reveal, or null for a result that is the pane itself. */
    id: string | null;
    label: string;
    description: string;
}

/* Case and accents fold away, so "e" finds "é" and a capital in the query changes nothing. */
function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}

function withoutBraces(text: string): string {
    return text.replace(/\{\{\w+\}\}/g, '').trim();
}

// An interpolation the index cannot fill in reads as nothing rather than as its braces.
function words(key: string): string {
    return withoutBraces(i18next.t(key));
}

/* The English words of a key, or nothing where the interface already speaks English or the key has no English. */
function englishWords(key: string | undefined): string {
    if (key === undefined || i18next.language.startsWith('en') || !i18next.exists(key, { lng: 'en' })) {
        return '';
    }
    return withoutBraces(i18next.getFixedT('en')(key));
}

function matches(terms: readonly string[], ...texts: string[]): boolean {
    const haystack = fold(texts.join(' '));
    return terms.every((term) => haystack.includes(term));
}

/* One result per shortcut, found by its label, its category and its keys as this platform prints them. */
export function shortcutSearchRows(groups: readonly ShortcutGroup[], apple: boolean): SearchResult[] {
    return groups.flatMap((group) =>
        group.shortcuts.map((row, index) => ({
            section: 'keyboard' as const,
            id: shortcutRowId(group.id, index),
            label: row.label,
            description: i18next.t('settings:keyboard.result', {
                category: group.title,
                keys: [formatShortcut(row.keys, apple), ...(row.then ? [row.then] : [])].join(' ')
            })
        }))
    );
}

/*
 * Every pane and row whose words hold each word of the query, panes first, in the order of the
 * navigation. `built` holds the rows whose words exist only at run time, like the shortcuts.
 */
export function searchSettings(query: string, built: readonly SearchResult[] = []): SearchResult[] {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        return [];
    }
    const panes = ALL_SETTINGS_SECTIONS.map((meta) => ({
        section: meta.id,
        id: null,
        label: sectionLabel(meta.id),
        description: sectionDescription(meta.id),
        english: `${englishWords(`settings:sections.${meta.id}.label`)} ${englishWords(`settings:sections.${meta.id}.description`)}`
    })).filter((result) => matches(terms, result.label, result.description, result.english));
    const order = ALL_SETTINGS_SECTIONS.map((meta) => meta.id);
    const indexed = SETTINGS_INDEX.filter((entry) => entry.available?.() ?? true).map((entry) => ({
        section: entry.section,
        id: entry.id,
        label: words(entry.label),
        description: entry.description ? words(entry.description) : '',
        english: `${englishWords(entry.label)} ${englishWords(entry.description)}`
    }));
    const rows = [...indexed, ...built]
        .filter((result) => matches(terms, result.label, result.description, result.english ?? ''))
        .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
    return [...panes, ...rows];
}
