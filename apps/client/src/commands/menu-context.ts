import type { ProjectView } from '@ruimte/contracts';
import type { SplitDirection } from '@/layout/split';
import type { KeepAwakeMode } from '@/state/settings';
import type { PanelKind } from '@/state/ui';

export type MenuHost = 'desktop' | 'station';

/*
 * What a feature knows about the moment and its menu rows need. A feature adds its fields by merging
 * into this interface from its own `menu-facts.ts` and fills them with a provider (`commands/menu-facts.ts`),
 * so a new row condition changes that feature alone.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MenuFacts {}

/* Everything the menu depends on, flat, so the tree follows from it alone. The window's own facts are here; the rest are features'. */
export interface MenuContext extends MenuFacts {
    host: MenuHost;
    apple: boolean;
    /* A project is open in this window; the start screen has none. */
    workspace: boolean;
    /* The project has a folder a person may see; the Chats project has none. */
    folder: boolean;
    /* The project is the machine's Chats project, which has no panels for a folder and no launches. */
    scratch: boolean;
    /* The kind of the view in the focused cell. */
    view: ProjectView['kind'] | null;
    cells: number;
    /* The focused cell as a host of tabs: how many, which one is in front, and whether the tab in front has room to leave for a cell of its own. */
    tabs: { hosted: boolean; count: number; index: number; splitOff: boolean };
    split: { right: boolean; down: boolean };
    /* A cell fills the grid for now. */
    maximized: boolean;
    /* Columns stand right of the focused cell. */
    closesRight: boolean;
    /* A cell stands in that direction from the focused one. */
    cellNeighbors: Record<SplitDirection, boolean>;
    /* There is a view to step to. */
    viewsSteppable: boolean;
    /* The open panel, or null while none is. */
    panel: PanelKind | null;
    sidebar: boolean;
    /* The openable views in sidebar order; the first nine have a shortcut. */
    views: string[];
    releaseNotes: boolean;
    /* The page fills the screen, which only the web client asks the page itself. */
    fullscreen: boolean;
    /* When this computer stays awake, or null where the shell cannot hold it awake. */
    keepAwake: KeepAwakeMode | null;
    /* The settings dialog is up, where Find searches the settings instead. */
    settingsOpen: boolean;
    /* The shell opens windows of its own, a window per project. */
    windows: boolean;
    /* This app runs a machine of its own; the desktop app told to run none does not. */
    localMachine: boolean;
}
