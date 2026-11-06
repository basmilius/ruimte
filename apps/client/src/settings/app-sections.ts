import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { CodeXml, Folder, Info, Keyboard, LayoutGrid, Palette, Settings, SquareTerminal } from 'lucide-react';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';
import { APP_SETTINGS_ROWS } from '@/settings/app-rows';

function rowsOf(section: string) {
    return APP_SETTINGS_ROWS.filter((row) => row.section === section);
}

/* The preferences of the app itself and of the surfaces you work in; each other section comes from the feature it is about. */
export const APP_SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
    {
        id: 'general',
        slot: 'general',
        icon: Settings,
        label: () => i18next.t('settings:sections.general.label'),
        description: () => i18next.t('settings:sections.general.description'),
        pane: lazyNamed(() => import('@/settings/panes/GeneralPane'), 'GeneralPane'),
        rows: rowsOf('general')
    },
    {
        id: 'appearance',
        slot: 'general',
        icon: Palette,
        label: () => i18next.t('settings:sections.appearance.label'),
        description: () => i18next.t('settings:sections.appearance.description'),
        pane: lazyNamed(() => import('@/settings/panes/AppearancePane'), 'AppearancePane'),
        rows: rowsOf('appearance')
    },
    {
        id: 'keyboard',
        slot: 'general',
        icon: Keyboard,
        split: true,
        label: () => i18next.t('settings:sections.keyboard.label'),
        description: () => i18next.t('settings:sections.keyboard.description'),
        pane: lazyNamed(() => import('@/settings/panes/KeyboardPane'), 'KeyboardPane'),
        rows: rowsOf('keyboard')
    },
    {
        id: 'views',
        slot: 'workspace',
        icon: LayoutGrid,
        label: () => i18next.t('settings:sections.views.label'),
        description: () => i18next.t('settings:sections.views.description'),
        pane: lazyNamed(() => import('@/settings/panes/ViewsPane'), 'ViewsPane'),
        rows: rowsOf('views')
    },
    {
        id: 'editor',
        slot: 'workspace',
        icon: CodeXml,
        label: () => i18next.t('settings:sections.editor.label'),
        description: () => i18next.t('settings:sections.editor.description'),
        pane: lazyNamed(() => import('@/settings/panes/EditorPane'), 'EditorPane'),
        rows: rowsOf('editor')
    },
    {
        id: 'terminal',
        slot: 'workspace',
        icon: SquareTerminal,
        label: () => i18next.t('settings:sections.terminal.label'),
        description: () => i18next.t('settings:sections.terminal.description'),
        pane: lazyNamed(() => import('@/settings/panes/TerminalPane'), 'TerminalPane'),
        rows: rowsOf('terminal')
    },
    {
        id: 'files',
        slot: 'workspace',
        icon: Folder,
        label: () => i18next.t('settings:sections.files.label'),
        description: () => i18next.t('settings:sections.files.description'),
        pane: lazyNamed(() => import('@/settings/panes/FilesPane'), 'FilesPane'),
        rows: rowsOf('files')
    },
    {
        id: 'about',
        slot: 'footer',
        icon: Info,
        label: () => i18next.t('settings:sections.about.label'),
        description: () => i18next.t('settings:sections.about.description'),
        pane: lazyNamed(() => import('@/settings/panes/AboutPane'), 'AboutPane'),
        hero: lazyNamed(() => import('@/settings/panes/AboutPane'), 'AboutHero'),
        rows: rowsOf('about')
    }
];
