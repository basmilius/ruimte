import i18next from 'i18next';
import { canSwipeBetweenPages, desktop } from '@/desktop/bridge';
import { closedLidOffered, keepAwakeAvailable } from '@/state/keep-awake';
import { ALL_SETTINGS_SECTIONS, sectionDescription, sectionLabel } from '@/shell/settings/sections';
import { shortcutRowId, type ShortcutGroup } from '@/shell/settings/shortcuts';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import type { SettingsSectionId } from '@/state/ui';
import { formatShortcut } from '@basmilius/desktop-ui';

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

function hasOpenedMachine(): boolean {
    return useEndpoints.getState().endpoints.some((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID || hasLocalMachine());
}

/*
 * The rows a search can find. A pane draws only while it is open, so the rows cannot be read off the
 * screen; this list names each one by its words instead. A row that is not here is still in its pane,
 * the search just does not know it.
 */
export const SETTINGS_INDEX: readonly SearchEntry[] = [
    { id: 'appearance.theme', section: 'appearance', label: 'settings:appearance.theme.label', description: 'settings:appearance.theme.description' },
    { id: 'appearance.accent', section: 'appearance', label: 'settings:appearance.accent.label', description: 'settings:appearance.accent.description' },
    {
        id: 'appearance.interface.dock',
        section: 'appearance',
        label: 'settings:appearance.interface.dock.label',
        description: 'settings:appearance.interface.dock.description'
    },
    { id: 'appearance.sidebar', section: 'appearance', label: 'settings:appearance.sidebar.label', description: 'settings:appearance.sidebar.description' },
    {
        id: 'appearance.needsYou',
        section: 'appearance',
        label: 'settings:appearance.needsYou.label',
        description: 'settings:appearance.needsYou.description'
    },
    { id: 'appearance.language', section: 'appearance', label: 'settings:appearance.language.label', description: 'settings:appearance.language.description' },
    { id: 'appearance.region', section: 'appearance', label: 'settings:appearance.region.label', description: 'settings:appearance.region.description' },
    {
        id: 'appearance.font.interface',
        section: 'appearance',
        label: 'settings:appearance.font.interface.label',
        description: 'settings:appearance.font.interface.description'
    },
    {
        id: 'appearance.font.interfaceSize',
        section: 'appearance',
        label: 'settings:appearance.font.interfaceSize.label',
        description: 'settings:appearance.font.interfaceSize.description'
    },
    {
        id: 'appearance.font.mono',
        section: 'appearance',
        label: 'settings:appearance.font.mono.label',
        description: 'settings:appearance.font.mono.description'
    },
    { id: 'appearance.font.terminalSize', section: 'appearance', label: 'settings:appearance.font.terminalSize.label' },
    {
        id: 'editor.colors.light',
        section: 'editor',
        label: 'settings:editor.colors.light.label',
        description: 'settings:editor.colors.light.description'
    },
    {
        id: 'editor.colors.dark',
        section: 'editor',
        label: 'settings:editor.colors.dark.label',
        description: 'settings:editor.colors.dark.description'
    },
    {
        id: 'editor.general.font.size',
        section: 'editor',
        label: 'settings:editor.general.font.size.label',
        description: 'settings:editor.general.font.size.description'
    },
    {
        id: 'editor.general.font.ligatures',
        section: 'editor',
        label: 'settings:editor.general.font.ligatures.label',
        description: 'settings:editor.general.font.ligatures.description'
    },
    {
        id: 'editor.general.display.wrap',
        section: 'editor',
        label: 'settings:editor.general.display.wrap.label',
        description: 'settings:editor.general.display.wrap.description'
    },
    {
        id: 'editor.general.display.indentGuides',
        section: 'editor',
        label: 'settings:editor.general.display.indentGuides.label',
        description: 'settings:editor.general.display.indentGuides.description'
    },
    {
        id: 'editor.general.display.whitespace',
        section: 'editor',
        label: 'settings:editor.general.display.whitespace.label',
        description: 'settings:editor.general.display.whitespace.description'
    },
    {
        id: 'editor.general.display.rightMargin',
        section: 'editor',
        label: 'settings:editor.general.display.rightMargin.label',
        description: 'settings:editor.general.display.rightMargin.description'
    },
    {
        id: 'editor.general.navigation.camelHumps',
        section: 'editor',
        label: 'settings:editor.general.navigation.camelHumps.label',
        description: 'settings:editor.general.navigation.camelHumps.description'
    },
    {
        id: 'editor.smartKeys.pairBrackets',
        section: 'editor',
        label: 'settings:editor.smartKeys.pairBrackets.label',
        description: 'settings:editor.smartKeys.pairBrackets.description'
    },
    {
        id: 'editor.smartKeys.pairQuotes',
        section: 'editor',
        label: 'settings:editor.smartKeys.pairQuotes.label',
        description: 'settings:editor.smartKeys.pairQuotes.description'
    },
    {
        id: 'editor.smartKeys.surroundSelection',
        section: 'editor',
        label: 'settings:editor.smartKeys.surroundSelection.label',
        description: 'settings:editor.smartKeys.surroundSelection.description'
    },
    {
        id: 'editor.smartKeys.tabOut',
        section: 'editor',
        label: 'settings:editor.smartKeys.tabOut.label',
        description: 'settings:editor.smartKeys.tabOut.description'
    },
    {
        id: 'editor.smartKeys.smartEnter',
        section: 'editor',
        label: 'settings:editor.smartKeys.smartEnter.label',
        description: 'settings:editor.smartKeys.smartEnter.description'
    },
    {
        id: 'editor.smartKeys.indentOnPaste',
        section: 'editor',
        label: 'settings:editor.smartKeys.indentOnPaste.label',
        description: 'settings:editor.smartKeys.indentOnPaste.description'
    },
    {
        id: 'editor.smartKeys.smartSemicolon',
        section: 'editor',
        label: 'settings:editor.smartKeys.smartSemicolon.label',
        description: 'settings:editor.smartKeys.smartSemicolon.description'
    },
    { id: 'editor.servers', section: 'editor', label: 'settings:editor.servers.title', description: 'settings:editor.servers.description' },
    { id: 'editor.servers.own', section: 'editor', label: 'settings:editor.servers.own.title', description: 'settings:editor.servers.own.description' },
    { id: 'views.drawing.snap', section: 'views', label: 'settings:views.drawing.snap.label', description: 'settings:views.drawing.snap.description' },
    {
        id: 'views.browser.swipe',
        section: 'views',
        label: 'settings:views.browser.swipe.label',
        description: 'settings:views.browser.swipe.description',
        available: canSwipeBetweenPages
    },
    { id: 'files.files.openFiles', section: 'files', label: 'settings:files.files.openFiles.label', description: 'settings:files.files.openFiles.description' },
    { id: 'files.files.hidden', section: 'files', label: 'settings:files.files.hidden.label', description: 'settings:files.files.hidden.description' },
    {
        id: 'files.files.browseStart',
        section: 'files',
        label: 'settings:files.files.browseStart.label',
        description: 'settings:files.files.browseStart.description'
    },
    { id: 'files.git.layout', section: 'files', label: 'settings:files.git.layout.label', description: 'settings:files.git.layout.description' },
    { id: 'files.git.whitespace', section: 'files', label: 'settings:files.git.whitespace.label', description: 'settings:files.git.whitespace.description' },
    // On the detail of the CLI the pane opens on.
    {
        id: 'providers.defaults.account',
        section: 'providers',
        label: 'agent-providers:cli.defaults.account',
        description: 'agent-providers:cli.defaults.description'
    },
    {
        id: 'providers.defaults.model',
        section: 'providers',
        label: 'agent-providers:cli.defaults.model',
        description: 'agent-providers:cli.defaults.usesCliDefault'
    },
    { id: 'agents.defaults.permissions', section: 'agents', label: 'settings:agents.defaults.permissions' },
    { id: 'agents.defaults.terminalMode', section: 'agents', label: 'settings:agents.defaults.terminalMode' },
    {
        id: 'agents.chats.streaming',
        section: 'agents',
        label: 'settings:agents.chats.streaming.label',
        description: 'settings:agents.chats.streaming.words.description'
    },
    {
        id: 'agents.chats.showViews',
        section: 'agents',
        label: 'settings:agents.chats.showViews.label',
        description: 'settings:agents.chats.showViews.description'
    },
    { id: 'providers.apple', section: 'providers', label: 'settings:providers.apple.label', description: 'settings:providers.apple.description' },
    { id: 'agents.resumeAtReset', section: 'agents', label: 'settings:agents.resumeAtReset.label', description: 'settings:agents.resumeAtReset.description' },
    { id: 'agents.deleteAnyView', section: 'agents', label: 'settings:agents.deleteAnyView.label', description: 'settings:agents.deleteAnyView.description' },
    { id: 'agents.working.sound', section: 'agents', label: 'settings:agents.working.sound.label', description: 'settings:agents.working.sound.description' },
    {
        id: 'agents.keepAwake.mode',
        section: 'agents',
        label: 'settings:agents.keepAwake.mode.label',
        description: 'settings:agents.keepAwake.mode.working.description',
        available: keepAwakeAvailable
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
    { id: 'voice.voice', section: 'voice', label: 'settings:voice.conversation.voice.label', description: 'settings:voice.conversation.voice.description' },
    {
        id: 'voice.confirm',
        section: 'voice',
        label: 'settings:voice.conversation.confirm.label',
        description: 'settings:voice.conversation.confirm.description'
    },
    { id: 'computer.enable', section: 'computer', label: 'settings:computer.allow', description: 'settings:computer.description' },
    {
        id: 'computer.grant.accessibility',
        section: 'computer',
        label: 'settings:computer.grant.accessibility.label',
        description: 'settings:computer.grant.accessibility.description'
    },
    {
        id: 'computer.grant.screenRecording',
        section: 'computer',
        label: 'settings:computer.grant.screenRecording.label',
        description: 'settings:computer.grant.screenRecording.description'
    },
    // On the account row of the Account pane.
    { id: 'machines.signIn', section: 'machines', label: 'settings:machines.account.title', description: 'settings:machines.account.description' },
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
    {
        id: 'machines.machine.keepRunning',
        section: 'machines',
        label: 'settings:backgroundService.keepRunning.label',
        description: 'settings:backgroundService.keepRunning.description',
        available: () => hasLocalMachine() && desktop()?.backgroundService !== undefined
    },
    { id: 'about.updates.auto', section: 'about', label: 'settings:about.updates.auto.label', description: 'settings:about.updates.auto.description' },
    { id: 'about.onboarding', section: 'about', label: 'onboarding:about.label', description: 'onboarding:about.description', available: hasLocalMachine }
];

export interface SearchResult {
    section: SettingsSectionId;
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

// An interpolation the index cannot fill in reads as nothing rather than as its braces.
function words(key: string): string {
    return i18next
        .t(key)
        .replace(/\{\{\w+\}\}/g, '')
        .trim();
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
        description: sectionDescription(meta.id)
    })).filter((result) => matches(terms, result.label, result.description));
    const order = ALL_SETTINGS_SECTIONS.map((meta) => meta.id);
    const indexed = SETTINGS_INDEX.filter((entry) => entry.available?.() ?? true).map((entry) => ({
        section: entry.section,
        id: entry.id,
        label: words(entry.label),
        description: entry.description ? words(entry.description) : ''
    }));
    const rows = [...indexed, ...built]
        .filter((result) => matches(terms, result.label, result.description))
        .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
    return [...panes, ...rows];
}
