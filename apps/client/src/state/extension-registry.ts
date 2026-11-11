import type { ExtensionManifest, ExtensionSlotName, ExtensionTheme } from '@ruimte/contracts';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { create } from 'zustand';

export type PanelGroup = 'project' | 'connected' | 'made' | 'extensions';

export interface PanelContribution {
    kind: `extension:${string}`;
    icon: LucideIcon;
    minWidth: number;
    toolbar: boolean;
    group: PanelGroup;
    label: () => string;
    badge?: () => string | null;
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
    group: 'workspace' | 'ai';
    // The core section it comes after, so a built-in stays where a person knows it; at the end of its group without one.
    after?: string;
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

export interface ExtensionSurfaceProps {
    nodeId?: string;
}

interface SidebarCardContribution {
    id: string;
    title: string;
    component: ComponentType;
}

interface ExtensionNodeContribution {
    // `<extension id>/<type>`.
    id: string;
    title: string;
    icon: LucideIcon;
    component: ComponentType<ExtensionSurfaceProps>;
    // What a new node starts with, however it is added.
    size: { width: number; height: number };
    initialData: unknown;
    // What a node made now stores, so it is not taken for one an older version made.
    dataVersion?: number;
}

interface ExtensionViewContribution {
    id: string;
    title: string;
    icon?: LucideIcon;
    component: ComponentType<{ params: unknown }>;
    /* Adds a view of it to the project and opens it, as its `New` command does. */
    open(): void;
}

interface CommandContribution {
    id: string;
    title: string;
    when?: () => boolean;
    run: () => void | Promise<void>;
    // Tells the terminal of `extension dev` why a run failed.
    onFailure?: (text: string) => void;
}

/* A place an extension may put something. Ruimte gives each its spot; the extension decides when it shows. */
export type SlotName = ExtensionSlotName;

type SlotFunction = (context: never) => boolean | { title?: string; icon?: LucideIcon; disabled?: boolean | string; badge?: string; order?: number };

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
    // Like mod+shift+k. Always with a modifier, as every shortcut in Ruimte.
    shortcut?: string;
    // Adds a node of an extension, so a menu lists it with the others of its kind.
    addsNode?: boolean;
}

export interface PaletteSourceContribution {
    id: string;
    title: string;
    search: (query: string) => Promise<readonly { id: string; title: string; detail?: string; run: () => void }[]>;
    onFailure?: (text: string) => void;
}

interface SlashCommandContribution {
    id: string;
    name: string;
    description: string;
    expand: (args: string) => Promise<string>;
}

interface ReferenceContribution {
    id: string;
    title: string;
    list: () => Promise<readonly { id: string; name: string }[]>;
    read: (item: { id: string; name: string }) => Promise<string>;
}

interface DiffViewerContribution {
    id: string;
    title: string;
    extensions: readonly string[];
    component: ComponentType<{ file: { path: string; name: string; extension: string }; diff: string }>;
}

interface VoiceActionContribution {
    id: string;
    description: string;
    parameters: object;
    run: (input: unknown) => Promise<string>;
}

interface ToolResultContribution {
    id: string;
    tools: readonly string[];
    component: ComponentType<{ call: { name: string; input: unknown; output: string | null; state: string } }>;
}

interface MarkdownBlockContribution {
    id: string;
    language: string;
    component: ComponentType<{ source: string }>;
}

interface FileViewerContribution {
    id: string;
    title: string;
    extensions: readonly string[];
    component: ComponentType<{ file: { path: string; name: string; extension: string; text: string | null } }>;
}

interface ExtensionSettingsContribution {
    id: string;
    component: ComponentType;
    keywords: readonly string[];
}

export interface SettingField {
    key: string;
    type: 'boolean' | 'text' | 'select';
    label: string;
    description?: string;
    default: boolean | string;
    options?: readonly { value: string; label: string }[];
}

export interface SettingGroup {
    title?: string;
    description?: string;
    fields: readonly SettingField[];
}

/* A theme a built-in brings, offered beside those of installed extensions and chosen the same way. */
export interface BuiltInThemeContribution {
    // `<extension id>/<name>`, the key a chosen theme is stored under.
    id: string;
    extensionId: string;
    theme: ExtensionTheme;
    thumbnailUrl: string;
}

interface ExtensionSchemaContribution {
    id: string;
    // Every field of every group, for a lookup by key.
    fields: readonly SettingField[];
    groups: readonly SettingGroup[];
}

interface BuiltInContribution {
    id: string;
    manifest: ExtensionManifest;
    // Its `assets/icon.svg` from the client's build, or a Lucide icon.
    icon?: string | LucideIcon;
    setEnabled(enabled: boolean): void;
}

export interface Contributions {
    builtIns: readonly BuiltInContribution[];
    builtInThemes: readonly BuiltInThemeContribution[];
    panels: readonly PanelContribution[];
    settingsSections: readonly SettingsSectionContribution[];
    canvasLayers: readonly CanvasLayerContribution[];
    slotEntries: readonly SlotEntry[];
    fileViewers: readonly FileViewerContribution[];
    markdownBlocks: readonly MarkdownBlockContribution[];
    toolResults: readonly ToolResultContribution[];
    slashCommands: readonly SlashCommandContribution[];
    paletteSources: readonly PaletteSourceContribution[];
    references: readonly ReferenceContribution[];
    diffViewers: readonly DiffViewerContribution[];
    voiceActions: readonly VoiceActionContribution[];
    sidebarCards: readonly SidebarCardContribution[];
    extensionNodes: readonly ExtensionNodeContribution[];
    extensionViews: readonly ExtensionViewContribution[];
    commands: readonly CommandContribution[];
    extensionSettings: readonly ExtensionSettingsContribution[];
    extensionSchemas: readonly ExtensionSchemaContribution[];
}

type ContributionKind = keyof Contributions;
type ContributionOf<Kind extends ContributionKind> = Contributions[Kind][number];

export const useContributions = create<Contributions>(() => ({
    builtIns: [],
    builtInThemes: [],
    panels: [],
    settingsSections: [],
    canvasLayers: [],
    slotEntries: [],
    fileViewers: [],
    markdownBlocks: [],
    toolResults: [],
    slashCommands: [],
    paletteSources: [],
    references: [],
    diffViewers: [],
    voiceActions: [],
    sidebarCards: [],
    extensionNodes: [],
    extensionViews: [],
    commands: [],
    extensionSettings: [],
    extensionSchemas: []
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
