import { describe, expect, test } from 'bun:test';
import { USAGE_DESKTOP_COMMANDS, USAGE_DESKTOP_PANELS, USAGE_DESKTOP_SETTINGS_SECTIONS } from '@ruimte/pulsar';
import { commandUsageName, openedBy, usageSectionOf } from '@/desktop/usage';
import { COMMAND_IDS } from '@/shell/command-table';
import { AFTER_SETTLE_PREFIX, CHAT_MOVE_PREFIX, GO_VIEW_PREFIX, LAUNCH_CHOOSE_PREFIX, PR_SHOW_IN_PREFIX } from '@/shell/menu/ids';
import { PANELS } from '@/shell/panels';
import { ALL_SETTINGS_SECTIONS } from '@/shell/settings/sections';
import type { PanelState } from '@/state/ui';

const CLOSED: PanelState = { open: false, kind: 'files' };
const SETTINGS_CLOSED = { open: false, section: 'appearance' as const, target: null, searchAt: 0 };

describe('commandUsageName', () => {
    test('names every row of the command table, and the list holds no row the table lost', () => {
        const names = COMMAND_IDS.map(commandUsageName);

        expect(names.filter((name) => name === null)).toEqual([]);
        expect(names.toSorted()).toEqual([...USAGE_DESKTOP_COMMANDS].toSorted());
    });

    test('counts a generated row under its kind, never under its own id', () => {
        expect(commandUsageName('agent-chat-claude')).toBe('agentChat');
        expect(commandUsageName('agent-view-terminal-codex')).toBe('agentViewTerminal');
        expect(commandUsageName('launch-stop-a1b2')).toBe('launchStopListed');
        expect(commandUsageName('launch-stop')).toBe('launchStop');
        expect(commandUsageName(`${GO_VIEW_PREFIX}3`)).toBe('goView');
        expect(commandUsageName(`${CHAT_MOVE_PREFIX}project-1`)).toBe('chatMoveProject');
        expect(commandUsageName(`${LAUNCH_CHOOSE_PREFIX}l1`)).toBe('launchChoose');
        expect(commandUsageName(`${AFTER_SETTLE_PREFIX}t1`)).toBe('launchAfterSettle');
        expect(commandUsageName(`${PR_SHOW_IN_PREFIX}/Users/jane/app`)).toBe('prShowIn');
        expect(commandUsageName('layout-apply-My layout')).toBe('layoutApply');
    });

    test('is null for an id that is no command', () => {
        expect(commandUsageName('copy')).toBeNull();
        expect(commandUsageName('view-123')).toBeNull();
        expect(commandUsageName('')).toBeNull();
    });
});

describe('the counted panels and sections', () => {
    test('are the panels and settings sections the client has', () => {
        expect(PANELS.map((entry) => entry.kind).toSorted()).toEqual([...USAGE_DESKTOP_PANELS].toSorted());
        // An older client still counts the Computer use and Storage panes, which this one folded into Agents and a machine's detail.
        expect(ALL_SETTINGS_SECTIONS.flatMap((section) => usageSectionOf(section.id) ?? []).toSorted()).toEqual(
            USAGE_DESKTOP_SETTINGS_SECTIONS.filter((section) => section !== 'computer' && section !== 'storage').toSorted()
        );
    });

    test('leave Pets uncounted: opening it counts the dialog and no section', () => {
        const closed = { panel: CLOSED, panelsRestoring: false, settings: { open: false, section: 'pets' } } as never;
        const open = { panel: CLOSED, panelsRestoring: false, settings: { open: true, section: 'pets' } } as never;
        expect(usageSectionOf('pets')).toBeNull();
        expect(openedBy(open, closed)).toEqual(['dialogs.settings']);
    });

    test('leave General and Chats uncounted until the counters know them', () => {
        expect(usageSectionOf('general')).toBeNull();
        expect(usageSectionOf('chats')).toBeNull();
    });
});

describe('openedBy', () => {
    const base = { panel: CLOSED, panelsRestoring: false, settings: SETTINGS_CLOSED };

    test('counts a panel a person opened or switched to', () => {
        expect(openedBy({ ...base, panel: { open: true, kind: 'git' } }, base)).toEqual(['panels.git']);
        expect(openedBy({ ...base, panel: { open: true, kind: 'files' } }, { ...base, panel: { open: true, kind: 'git' } })).toEqual(['panels.files']);
        expect(openedBy({ ...base, panel: { open: true, kind: 'git' } }, { ...base, panel: { open: true, kind: 'git' } })).toEqual([]);
        expect(openedBy({ ...base, panel: CLOSED }, { ...base, panel: { open: true, kind: 'git' } })).toEqual([]);
    });

    test('does not count a panel a project put back when it opened', () => {
        expect(openedBy({ ...base, panel: { open: true, kind: 'git' }, panelsRestoring: true }, base)).toEqual([]);
    });

    test('counts the settings with the section they open on, and every section shown after', () => {
        const open = { ...base, settings: { ...SETTINGS_CLOSED, open: true } };
        const keyboard = { ...base, settings: { ...SETTINGS_CLOSED, open: true, section: 'keyboard' as const } };

        expect(openedBy(open, base)).toEqual(['dialogs.settings', 'settingsSections.appearance']);
        expect(openedBy(keyboard, open)).toEqual(['settingsSections.keyboard']);
        expect(openedBy(keyboard, keyboard)).toEqual([]);
        expect(openedBy({ ...base, settings: { ...SETTINGS_CLOSED, section: 'keyboard' } }, open)).toEqual([]);
    });
});
