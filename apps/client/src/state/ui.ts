import type { AgentKind, ProjectPanelKind, ProjectPanels } from '@ruimte/contracts';
import { create } from 'zustand';
import { z } from 'zod';
import type { TemplateDraft } from '@/language/template-draft';
import type { TemplatesTracker } from '@/language/templates';
import { isScratchProject, useProject } from '@/state/project';
import { storedJson, storedText } from '@/state/stored-json';

export type SettingsSectionId =
    | 'appearance'
    | 'keyboard'
    | 'editor'
    | 'terminal'
    | 'views'
    | 'pets'
    | 'files'
    | 'storage'
    | 'providers'
    | 'voice'
    | 'computer'
    | 'agents'
    | 'usage'
    | 'machines'
    | 'about';

/* Launches, databases and output are kinds the project's file does not know, so each is stored beside `panel` (`launchesPanel`, `databasesPanel`, `outputPanel`). Problems and Voice Control are ones too, and only for this session: the file stores them as closed, since a voice session does not outlive the window. */
export type PanelKind = ProjectPanelKind | 'launches' | 'databases' | 'output' | 'problems' | 'voice';

const PANEL_KINDS: readonly PanelKind[] = ['files', 'git', 'processes', 'devices'];

const storedSidebar = storedText('ruimte.sidebar');
const storedChosenLaunches = storedJson(
    'ruimte.launches.chosen',
    z.custom<Record<string, string>>((stored) => stored !== null && typeof stored === 'object' && !Array.isArray(stored))
);

/* Where the panels lived before they were per project: read as a new project's defaults, never written. */
const LEGACY_PANEL_KEY = 'ruimte.panel';
const LEGACY_PANEL_WIDTH_KEY = 'ruimte.panel.width';

export interface PanelState {
    open: boolean;
    /* Which panel the surface shows; it survives a close, so the toggle reopens the last one. */
    kind: PanelKind;
}

/* The chat and the plan the plan panel shows, and whether a person closed it. */
export type PlanAnchor = NonNullable<ProjectPanels['plan']>;

const CLOSED_PANEL: PanelState = { open: false, kind: 'files' };

/* What the Chats project has no panel for: its folder is the daemon's, and so are its repository and what runs in it. */
const SCRATCH_HIDDEN_PANELS: readonly PanelKind[] = ['files', 'git', 'devices', 'launches', 'databases', 'problems'];

export function panelHidden(kind: PanelKind, scratch: boolean): boolean {
    return scratch && SCRATCH_HIDDEN_PANELS.includes(kind);
}

/* The panel as the window shows it: one the project has no place for reads as closed, whatever its file stored. */
export function shownPanel(panel: PanelState, scratch: boolean): PanelState {
    return panel.open && panelHidden(panel.kind, scratch) ? { ...panel, open: false } : panel;
}

/* The kind on its own for an open panel, `closed:` in front for one that is not, so a toggle still
   knows which panel it reopens. The shape the legacy key was written in. */
export function parsePanel(raw: string | null): PanelState {
    if (!raw) {
        return CLOSED_PANEL;
    }
    const open = !raw.startsWith('closed:');
    const kind = (open ? raw : raw.slice('closed:'.length)) as PanelKind;
    return PANEL_KINDS.includes(kind) ? { open, kind } : CLOSED_PANEL;
}

/* A width the legacy key holds, in whole pixels; null is "no width of the person's own". */
export function parseWidth(raw: string | null): number | null {
    const stored = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
}

export interface PanelDefaults {
    panel: PanelState;
    panelWidth: number | null;
    planAnchor: PlanAnchor | null;
    planWidth: number | null;
}

/* What a project whose local file says nothing about the panels opens with. */
export const PANEL_DEFAULTS: PanelDefaults = {
    panel: parsePanel(storedText(LEGACY_PANEL_KEY).read()),
    panelWidth: parseWidth(storedText(LEGACY_PANEL_WIDTH_KEY).read()),
    planAnchor: null,
    planWidth: null
};

interface SettingsState {
    open: boolean;
    /* The section the dialog shows; it stays where it was so reopening lands on the same pane. */
    section: SettingsSectionId;
    /* The row a search result points at, which scrolls itself into view and lights up once. */
    target: string | null;
    /* Bumped to put the keyboard in the search field; the field focuses on every change. */
    searchAt: number;
}

/* A CLI's own login in a terminal of its own, for a machine no canvas on screen can hold a terminal node of. */
export interface LoginRequest {
    endpointId: string;
    kind: AgentKind;
    accountId: string;
    /* What a person calls the account. */
    name: string;
}

/* Where the onboarding stands while it is up: the welcome, or the list of tasks behind it. */
export type OnboardingStep = 'welcome' | 'hub';

export type ViewDialog =
    | { kind: 'settings'; viewId: string }
    /* Promoting a node that has lines drawn into it. Those lines do not survive the move. */
    | { kind: 'promote'; nodeId: string }
    | { kind: 'new-browser' }
    | null;

/*
 * A chat in Chats that leaves it. `make` starts a new project from the chat ("Make project…"); `pick`
 * moves it into a project that already exists, `projectId` being the one chosen beforehand, if any.
 */
export interface MoveChatRequest {
    chatId: string;
    mode: 'make' | 'pick';
    projectId: string | null;
    /* What an agent in the chat suggested, which the form starts from: a name and, when it gave one, a folder. */
    suggest?: { name: string; folder?: string };
}

/* A fork of a chat after a turn; `machine` is the daemon id of the machine the chat runs on, absent for the workspace's. */
export interface ForkRequest {
    chatId: string;
    turnId: string;
    machine?: string;
}

/*
 * A node being made on another machine, from the new-node menu, or a machine that stopped linking the
 * project being linked again (`relink`), which asks for its checkout once more.
 */
export interface RemoteNodeRequest {
    machineId: string;
    kind: 'chat' | 'terminal' | 'device';
    /* The canvas it goes on; null for a machine linked again, which makes no node. */
    viewId: string | null;
    /* Where on the canvas it goes, in world units; null lets the canvas place it. */
    at: { x: number; y: number } | null;
    relink: boolean;
    /*
     * A fork of this chat after this turn: the new chat starts from a transcript of the original instead of from nothing.
     * `source` is the daemon id of the machine the original runs on, absent for the workspace's.
     */
    handoff?: { chatId: string; turnId: string; title: string; provider?: AgentKind; source?: string };
}

/* A project being put on another machine; `then` is the node that was being made there, which opens again once the clone is in. */
export interface AddToMachineRequest {
    machineId: string | null;
    then?: RemoteNodeRequest;
}

/* What the palette is doing: jumping and running commands, searching the files of the open folder,
   searching the project's chats, or picking one file. A step inside the same dialog. */
export type PaletteMode = 'default' | 'grep' | 'chats' | 'file';

/* What a picked file becomes. A node carries where it lands, in world units, because the menu that
   asked knows the point that was right-clicked and the palette does not. */
export type FilePick = { kind: 'node'; at: { x: number; y: number } } | { kind: 'view' } | { kind: 'tab' };

export interface WorktreeMergeRequest {
    /* The project folder whose repository holds the worktrees. */
    folder: string;
    /* In the order they are merged; a group's are in the order of its members. */
    paths: string[];
    /* Whether "remove afterwards" starts ticked; removing a worktree with work asks to merge first with it on. */
    remove?: boolean;
}

/* The checkout whose unmerged files are being resolved, and the file the overlay opens on. */
export interface ConflictRequest {
    cwd: string;
    path?: string;
}

/* A provider's install or sign-in command, typed into a shell of its own for the person to run. */
export interface ProviderCommandRequest {
    endpointId: string;
    kind: AgentKind;
    command: string;
}

/* The template form Save as Live Template opens, with the tracker of the project it was asked in. */
export interface TemplateRequest {
    tracker: TemplatesTracker;
    draft: TemplateDraft;
}

interface UiStore {
    paletteOpen: boolean;
    paletteMode: PaletteMode;
    usageOpen: boolean;
    modelsOpen: boolean;
    login: LoginRequest | null;
    providerCommand: ProviderCommandRequest | null;
    templateRequest: TemplateRequest | null;
    onboarding: OnboardingStep | null;
    /* The consent for the CLIs' global settings is up (`state/agent-integrations.ts`). */
    agentIntegrations: boolean;
    /* Whether the session list is in view; it survives a reload, like everything else on the canvas. */
    sidebarOpen: boolean;
    /* Which canvases the sidebar has folded open, per project, or null until the list seeds itself.
       It rides the project's machine-local file with the panels (`project/panels-port.ts`). */
    sidebarExpanded: string[] | null;
    /* Text the palette opens with; a path puts it straight into folder browsing. */
    paletteSeed: string;
    /* A count and not a flag: asking twice while the palette is open has to start browsing twice. */
    paletteBrowseAt: number;
    /* The machine the folder browser was asked to open on, or null to open on the machines as usual. */
    paletteBrowseMachine: string | null;
    /* What picking a machine is for: its folders, or a new chat on it, which needs no folder at all. */
    paletteBrowseFor: 'folder' | 'chat';
    /* What the file mode does with the file that is chosen; null in every other mode. */
    filePick: FilePick | null;
    settings: SettingsState;
    panel: PanelState;
    /* Null until a drag gives the column a width of the person's own for this project. */
    panelWidth: number | null;
    /* One per window, since a window shows one project. Open follows from the rules in
       `plan/panel-rules.ts` and never from the project's file. */
    planAnchor: PlanAnchor | null;
    planOpen: boolean;
    planWidth: number | null;
    /* True while the columns show what was stored, false from the first change by hand. A column
       only slides when it is false, so a restore lands at its width. */
    panelsRestoring: boolean;
    layoutDialogOpen: boolean;
    /* The group a worktree is being bound to, while its dialog is up. */
    worktreeDialogFor: string | null;
    /* The worktrees a person is removing, one or a group's all, by the project folder whose repository holds them, while the question is up. */
    worktreeRemoval: { folder: string; paths: string[] } | null;
    /* The worktrees a person is merging, one or a group's all, while the merge dialog is up. */
    worktreeMerge: WorktreeMergeRequest | null;
    /* The checkout whose conflicts are open in the overlay; null while it is closed. */
    conflicts: ConflictRequest | null;
    /* The chat and the turn a fork goes on after, while its dialog is up. */
    forkDialog: ForkRequest | null;
    /* The chat in Chats that moves to a project, and the project picked beforehand, while its dialog is up. */
    moveChatDialog: MoveChatRequest | null;
    /* The dialog that starts a chat in a worktree made for it. */
    newWorktreeChatOpen: boolean;
    /* The dialog that starts a chat on a GitHub issue. */
    issueStartOpen: boolean;
    /* The checkout whose pull request is shown, while that dialog is up. */
    pullRequestDialog: { cwd: string } | null;
    /* A node on another machine being made, or made over for a machine that no longer links the project. */
    remoteNodeDialog: RemoteNodeRequest | null;
    addToMachineDialog: AddToMachineRequest | null;
    /* What a view is being asked about, from the sidebar, the breadcrumb or the palette alike. */
    viewDialog: ViewDialog;
    /* The sidebar row the caret is in, which is how a new heading opens. */
    renamingViewId: string | null;
    /* The application menu asks for the open project's settings; the project menu owns that dialog. */
    projectSettingsAsked: boolean;
    /* The launch the toolbar's chip shows, by `endpointKey(endpointId, projectId)`. This client's
       choice, so it stays in this client's storage and never in a project file. */
    chosenLaunches: Record<string, string>;
    chooseLaunch(projectKey: string, launchId: string): void;
    setUsageOpen(open: boolean): void;
    setModelsOpen(open: boolean): void;
    setLogin(login: LoginRequest | null): void;
    setProviderCommand(request: ProviderCommandRequest | null): void;
    setTemplateRequest(request: TemplateRequest | null): void;
    setOnboarding(step: OnboardingStep | null): void;
    setAgentIntegrations(open: boolean): void;
    askProjectSettings(asked: boolean): void;
    setWorktreeDialogFor(groupId: string | null): void;
    setWorktreeRemoval(removal: { folder: string; paths: string[] } | null): void;
    setWorktreeMerge(merge: WorktreeMergeRequest | null): void;
    setConflicts(request: ConflictRequest | null): void;
    setForkDialog(fork: ForkRequest | null): void;
    setMoveChatDialog(move: MoveChatRequest | null): void;
    setNewWorktreeChatOpen(open: boolean): void;
    setIssueStartOpen(open: boolean): void;
    setPullRequestDialog(request: { cwd: string } | null): void;
    setRemoteNodeDialog(request: RemoteNodeRequest | null): void;
    setAddToMachineDialog(request: AddToMachineRequest | null): void;
    setViewDialog(dialog: ViewDialog): void;
    setRenamingViewId(viewId: string | null): void;
    setSidebarOpen(open: boolean): void;
    toggleSidebar(): void;
    openPalette(seed?: string): void;
    /* The palette in its find-in-files mode, from the palette itself or from the files panel. */
    openFindInFiles(seed?: string): void;
    /* The palette in its chat search mode; with nothing typed it lists the CLI sessions started outside the app. */
    openChatSearch(seed?: string): void;
    /* With one machine it opens on that machine's start folder, with more on the machines. */
    openFolderBrowser(machineId?: string): void;
    /* The machines, for a new chat on the one that is picked. */
    openChatMachines(): void;
    /* The palette listing the files of the open folder, to make one of them a node or a view. */
    openFilePicker(pick: FilePick): void;
    setPaletteMode(mode: PaletteMode): void;
    setLayoutDialogOpen(open: boolean): void;
    setPaletteOpen(open: boolean): void;
    setSettings(patch: Partial<SettingsState>): void;
    setPanel(patch: Partial<PanelState>): void;
    togglePanel(kind?: PanelKind): void;
    setPanelWidth(width: number): void;
    setPlanPanel(state: { anchor: PlanAnchor | null; open: boolean }): void;
    setPlanWidth(width: number): void;
    /* Puts a project's panels on screen in one go, when it opens; they land without sliding. */
    setPanels(state: PanelDefaults): void;
    setSidebarExpanded(ids: string[] | null): void;
}

/* Which app-level dialog is up; nothing here belongs to a node. The panels do belong to a project.
   They are loaded from and saved to its machine-local file by `project/panels-port.ts`. */
export const useUi = create<UiStore>((set, get) => {
    const openPaletteIn = (paletteMode: PaletteMode, seed: string): void => {
        set({ paletteOpen: true, paletteMode, paletteSeed: seed, filePick: null });
    };

    const browseMachines = (paletteBrowseFor: UiStore['paletteBrowseFor'], machineId: string | null): void => {
        set({
            paletteOpen: true,
            paletteMode: 'default',
            paletteSeed: '',
            paletteBrowseAt: get().paletteBrowseAt + 1,
            paletteBrowseMachine: machineId,
            paletteBrowseFor,
            filePick: null
        });
    };

    return {
        paletteOpen: false,
        paletteMode: 'default',
        usageOpen: false,
        modelsOpen: false,
        login: null,
        providerCommand: null,
        templateRequest: null,
        onboarding: null,
        agentIntegrations: false,
        paletteSeed: '',
        paletteBrowseAt: 0,
        paletteBrowseMachine: null,
        paletteBrowseFor: 'folder',
        filePick: null,
        sidebarOpen: storedSidebar.read() !== 'closed',
        sidebarExpanded: null,
        settings: { open: false, section: 'appearance', target: null, searchAt: 0 },
        /* Closed until a project says otherwise, so a reload cannot flash open a panel the project has closed. */
        panel: CLOSED_PANEL,
        panelWidth: null,
        planAnchor: null,
        planOpen: false,
        planWidth: null,
        panelsRestoring: true,
        layoutDialogOpen: false,
        worktreeDialogFor: null,
        worktreeRemoval: null,
        worktreeMerge: null,
        conflicts: null,
        forkDialog: null,
        moveChatDialog: null,
        newWorktreeChatOpen: false,
        issueStartOpen: false,
        pullRequestDialog: null,
        remoteNodeDialog: null,
        addToMachineDialog: null,
        viewDialog: null,
        renamingViewId: null,
        projectSettingsAsked: false,
        chosenLaunches: storedChosenLaunches.read() ?? {},
        chooseLaunch(projectKey, launchId) {
            if (get().chosenLaunches[projectKey] === launchId) {
                return;
            }
            const chosenLaunches = { ...get().chosenLaunches, [projectKey]: launchId };
            storedChosenLaunches.write(chosenLaunches);
            set({ chosenLaunches });
        },
        setUsageOpen(open) {
            set({ usageOpen: open });
        },
        setModelsOpen(open) {
            set({ modelsOpen: open });
        },
        setLogin(login) {
            set({ login });
        },
        setProviderCommand(request) {
            set({ providerCommand: request });
        },
        setTemplateRequest(request) {
            set({ templateRequest: request });
        },
        setOnboarding(step) {
            set({ onboarding: step });
        },
        setAgentIntegrations(open) {
            set({ agentIntegrations: open });
        },
        askProjectSettings(asked) {
            set({ projectSettingsAsked: asked });
        },
        setWorktreeDialogFor(groupId) {
            set({ worktreeDialogFor: groupId });
        },
        setWorktreeRemoval(removal) {
            set({ worktreeRemoval: removal });
        },
        setWorktreeMerge(merge) {
            set({ worktreeMerge: merge });
        },
        setConflicts(request) {
            set({ conflicts: request });
        },
        setForkDialog(fork) {
            set({ forkDialog: fork });
        },
        setMoveChatDialog(move) {
            set({ moveChatDialog: move });
        },
        setNewWorktreeChatOpen(open) {
            set({ newWorktreeChatOpen: open });
        },
        setIssueStartOpen(open) {
            set({ issueStartOpen: open });
        },
        setPullRequestDialog(request) {
            set({ pullRequestDialog: request });
        },
        setRemoteNodeDialog(request) {
            set({ remoteNodeDialog: request });
        },
        setAddToMachineDialog(request) {
            set({ addToMachineDialog: request });
        },
        setViewDialog(dialog) {
            set({ viewDialog: dialog });
        },
        setRenamingViewId(viewId) {
            set({ renamingViewId: viewId });
        },
        setSidebarOpen(open) {
            storedSidebar.write(open ? 'open' : 'closed');
            set({ sidebarOpen: open, panelsRestoring: false });
        },
        toggleSidebar() {
            get().setSidebarOpen(!get().sidebarOpen);
        },
        setLayoutDialogOpen(open) {
            set({ layoutDialogOpen: open });
        },
        openPalette(seed = '') {
            openPaletteIn('default', seed);
        },
        openFindInFiles(seed = '') {
            openPaletteIn('grep', seed);
        },
        openChatSearch(seed = '') {
            openPaletteIn('chats', seed);
        },
        openFolderBrowser(machineId) {
            browseMachines('folder', machineId ?? null);
        },
        openChatMachines() {
            browseMachines('chat', null);
        },
        openFilePicker(pick) {
            set({ paletteOpen: true, paletteMode: 'file', paletteSeed: '', filePick: pick });
        },
        setPaletteMode(mode) {
            set({ paletteMode: mode, paletteSeed: '', filePick: null });
        },
        setPaletteOpen(open) {
            set(open ? { paletteOpen: true, paletteMode: 'default', paletteSeed: '', filePick: null } : { paletteOpen: false, filePick: null });
        },
        setSettings(patch) {
            set({ settings: { ...get().settings, ...patch } });
        },
        setPanel(patch) {
            const panel = { ...get().panel, ...patch };
            set({ panel, panelsRestoring: false });
        },
        togglePanel(kind) {
            const was = get().panel;
            /* Without a kind the shortcut reopens whatever was up last, so the panel has one toggle of its own. */
            const panel = kind ? { open: !(was.open && was.kind === kind), kind } : { ...was, open: !was.open };
            set({ panel, panelsRestoring: false });
        },
        setPanelWidth(width) {
            set({ panelWidth: width, panelsRestoring: false });
        },
        setPlanPanel({ anchor, open }) {
            if (get().planAnchor === anchor && get().planOpen === open) {
                return;
            }
            set({ planAnchor: anchor, planOpen: open, panelsRestoring: false });
        },
        setPlanWidth(width) {
            set({ planWidth: width, panelsRestoring: false });
        },
        setSidebarExpanded(ids) {
            set({ sidebarExpanded: ids });
        },
        setPanels(state) {
            /* One update, so a panel and its width reach the DOM together instead of sliding from the default. */
            set({
                panel: state.panel,
                panelWidth: state.panelWidth,
                planAnchor: state.planAnchor,
                // Closed until the chat is on screen. The rules open it, never the file.
                planOpen: false,
                planWidth: state.planWidth,
                panelsRestoring: true
            });
        }
    };
});

export function useShownPanel(): PanelState {
    const panel = useUi((s) => s.panel);
    const scratch = useProject((s) => isScratchProject(s.current));
    return shownPanel(panel, scratch);
}
