import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ExtensionManifest } from '@ruimte/contracts';
import { create } from 'zustand';

export type PanelGroup = 'project' | 'connected' | 'made' | 'extensions';

export interface PanelContribution {
    kind: `extension:${string}`;
    icon: LucideIcon;
    minWidth: number;
    toolbar: boolean;
    group: PanelGroup;
    label: () => string;
    component: ComponentType;
}

export interface SettingsSearchRow {
    /* The `searchId` of the row it leads to. */
    id: string;
    /* Full i18n keys, namespace included, so a search also finds the English words. */
    label: string;
    description: string;
}

export interface SettingsSectionContribution {
    id: string;
    icon: LucideIcon;
    group: 'workspace';
    // The core section it comes after, so a built-in stays where a person knows it.
    after: string;
    labelKey: string;
    descriptionKey: string;
    component: ComponentType;
    search?: readonly SettingsSearchRow[];
}

export interface CanvasLayerProps {
    z: number;
}

export interface CanvasLayerContribution {
    id: string;
    // On the canvas under the camera, or over it in the cell's overlay.
    place: 'canvas' | 'screen';
    component: ComponentType<CanvasLayerProps>;
}

export interface ViewAccessoryProps {
    id: string;
    title: string | undefined;
    onPress?: () => void;
}

export interface ViewAccessoryContribution {
    id: string;
    on: 'chat' | 'terminal';
    component: ComponentType<ViewAccessoryProps>;
}

export interface SharedStorageContribution {
    id: string;
    reload: () => void;
}

export interface ExtensionSurfaceProps {
    nodeId?: string;
}

export interface SidebarCardContribution {
    id: string;
    title: string;
    component: ComponentType;
}

export interface ExtensionNodeContribution {
    // `<extension id>/<type>`.
    id: string;
    title: string;
    icon: LucideIcon;
    component: ComponentType<ExtensionSurfaceProps>;
    dataVersion?: number;
    migrate?: (stored: unknown, fromVersion: number) => unknown;
}

export interface ExtensionViewContribution {
    id: string;
    title: string;
    component: ComponentType<{ params: unknown }>;
}

export interface CommandContribution {
    id: string;
    title: string;
    when?: () => boolean;
    run: () => void | Promise<void>;
}

/* A place an extension may put something. Ruimte gives each its spot; the extension decides when it shows. */
export type SlotName =
    | 'selectionBar'
    | 'nodeHeader'
    | 'nodeMenu'
    | 'canvasMenu'
    | 'lineMenu'
    | 'viewToolbar'
    | 'viewMenu'
    | 'panelHeader'
    | 'commandPalette'
    | 'composer'
    | 'fileMenu'
    | 'editorToolbar'
    | 'editorMenu'
    | 'diffToolbar'
    | 'terminalToolbar'
    | 'browserToolbar';

export type SlotFunction = (context: never) => boolean | { title?: string; icon?: LucideIcon; disabled?: boolean | string; badge?: string; order?: number };

export type SlotMenuItem =
    | 'separator'
    | { actionId: string }
    | { title: string; run: () => void; checked?: boolean }
    | { title: string; items: readonly SlotMenuItem[] };

/* An action, a menu or a widget: what goes in a slot. An action without slots only shows where a menu puts it. */
export interface SlotEntry {
    id: string;
    kind: 'action' | 'menu' | 'widget';
    title: string;
    icon?: LucideIcon;
    slots: Partial<Record<SlotName, true | ((context: object) => ReturnType<SlotFunction>)>>;
    run?: (context: object) => void | Promise<void>;
    items?: readonly SlotMenuItem[] | ((context: object) => readonly SlotMenuItem[]);
    component?: ComponentType<{ context: object; nodeId?: string | undefined }>;
    onFailure?: (text: string) => void;
    // Adds a node of an extension, so a menu lists it with the others of its kind.
    addsNode?: boolean;
}

export interface MarkdownBlockContribution {
    id: string;
    language: string;
    component: ComponentType<{ source: string }>;
}

export interface FileViewerContribution {
    id: string;
    title: string;
    extensions: readonly string[];
    component: ComponentType<{ file: { path: string; name: string; extension: string; text: string | null } }>;
}

export interface ExtensionSettingsContribution {
    id: string;
    component: ComponentType;
    keywords: readonly string[];
}

export interface BuiltInContribution {
    id: string;
    manifest: ExtensionManifest;
    icon?: LucideIcon;
    setEnabled(enabled: boolean): void;
}

export interface Contributions {
    builtIns: readonly BuiltInContribution[];
    panels: readonly PanelContribution[];
    settingsSections: readonly SettingsSectionContribution[];
    canvasLayers: readonly CanvasLayerContribution[];
    slotEntries: readonly SlotEntry[];
    fileViewers: readonly FileViewerContribution[];
    markdownBlocks: readonly MarkdownBlockContribution[];
    viewAccessories: readonly ViewAccessoryContribution[];
    sharedStorage: readonly SharedStorageContribution[];
    sidebarCards: readonly SidebarCardContribution[];
    extensionNodes: readonly ExtensionNodeContribution[];
    extensionViews: readonly ExtensionViewContribution[];
    commands: readonly CommandContribution[];
    extensionSettings: readonly ExtensionSettingsContribution[];
}

type ContributionKind = keyof Contributions;
type ContributionOf<Kind extends ContributionKind> = Contributions[Kind][number];

export const useContributions = create<Contributions>(() => ({
    builtIns: [],
    panels: [],
    settingsSections: [],
    canvasLayers: [],
    slotEntries: [],
    fileViewers: [],
    markdownBlocks: [],
    viewAccessories: [],
    sharedStorage: [],
    sidebarCards: [],
    extensionNodes: [],
    extensionViews: [],
    commands: [],
    extensionSettings: []
}));

/* Whether a stored entry is an extension's: every Ruimte keeps it as an unknown kind, so it survives one without the extension. */
export function extensionKeyOf(raw: Record<string, unknown> | undefined): string | null {
    return raw?.kind === 'extension' && typeof raw.extension === 'string' && typeof raw.type === 'string' ? `${raw.extension}/${raw.type}` : null;
}

function idOf(item: { id: string } | { kind: string }): string {
    return 'id' in item ? item.id : item.kind;
}

/* Adds a contribution, or replaces the one with its id when an extension reloads. Answers how to take it out again. */
export function contribute<Kind extends ContributionKind>(kind: Kind, item: ContributionOf<Kind>): () => void {
    const id = idOf(item);

    useContributions.setState((state) => {
        const rest = (state[kind] as readonly ContributionOf<Kind>[]).filter((entry) => idOf(entry) !== id);

        return { [kind]: [...rest, item] } as Partial<Contributions>;
    });

    return () => {
        useContributions.setState(
            (state) =>
                ({
                    [kind]: (state[kind] as readonly ContributionOf<Kind>[]).filter((entry) => entry !== item)
                }) as Partial<Contributions>
        );
    };
}
