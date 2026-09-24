import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Search } from 'lucide-react';
import { hasOverlayControls } from '@/desktop/bridge';
import { STRIP_PADDING_PX, useTrafficLightInset } from '@/desktop/useFullscreen';
import { PanelControls } from '@/shell/PanelControls';
import { ProjectMenu } from '@/shell/ProjectMenu';
import { ViewMenu } from '@/shell/ViewMenu';
import { FILES_VIEW_ID } from '@/shell/files-view';
import { ViewToolbar } from '@/shell/ViewToolbar';
import { useHasViewToolbar, useShowsSubagents, useToolbarView, useViewToolbarLeads } from '@/shell/view-toolbar';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { StationMenu } from '@/shell/menu/StationMenu';
import { IS_STATION } from '@/station';
import { useDiagram } from '@/state/diagram';
import { useDrawing } from '@/state/drawing';
import { cellCount } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { hasUpdate, useUpdates } from '@/state/updates';
import { BTN_GROUP } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { VoiceButton } from '@/voice/VoiceButton';
import { useVoice } from '@/voice/state';

/* The band above the canvas: which project is open, and the panels that sit next to it. It is as
   tall as the sidebar's own strip, so the two read as one title bar across the window. The left
   padding follows the sidebar's width, which keeps the breadcrumb from jumping when the list
   slides away. */
export function Toolbar() {
    const { t } = useTranslation('shell');
    const projectDirty = useProject((s) => s.dirty);
    const drawingDirty = useDrawing((s) => s.dirty);
    const diagramDirty = useDiagram((s) => s.dirty);
    const dirty = projectDirty || drawingDirty || diagramDirty;
    const switching = useProject((s) => s.switching);
    const panel = useUi((s) => s.panel);
    const voiceOpen = useVoice((s) => s.open);
    const sidebarOpen = useUi((s) => s.sidebarOpen);
    const bodyFocused = useDocument((s) => s.bodyFocused);
    /* The files are in no document, so the switcher has nothing to name while they hold the cell;
       the tabs beside it say which file is up. */
    const hasView = useDocument((s) => s.activeViewId !== null && s.activeViewId !== FILES_VIEW_ID);
    /* With the views side by side every cell carries its own bar, and this one goes back to being
       the application's: two bars speaking for two different views would read as one bar for both. */
    const split = useDocument((s) => (s.layout === null ? false : cellCount(s.layout) > 1));
    const view = useToolbarView();
    const hasViewToolbar = useHasViewToolbar(split ? null : view);
    const leads = useViewToolbarLeads(split ? null : view);
    const inSubagents = useShowsSubagents(split ? null : view);
    const inset = useTrafficLightInset();

    return (
        <header
            className="app-drag relative flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-2 pl-2 text-xs text-text-muted transition-[padding] duration-200 ease-out"
            style={sidebarOpen ? undefined : { paddingLeft: inset ?? STRIP_PADDING_PX }}
        >
            {/* The web client's menu goes where the wordmark went, so it stays one press away. */}
            {!sidebarOpen && IS_STATION && <StationMenu variant="symbol" />}
            {!sidebarOpen && <SidebarToggle />}
            {/* With the view putting something in the bar, the slack belongs to that part, so the
                breadcrumb stops at its own width and the address field of a page can run. */}
            <div className={clsx('flex min-w-0 items-center gap-2', !hasViewToolbar && 'grow')}>
                {/* The machine sits inside the switcher's own trigger, so the pill is one breadcrumb
                    rather than a label with a button behind it. */}
                <ProjectMenu />
                {/* The open sidebar is the view switcher already; the segment comes back with it
                    closed, and only when there is a view for it to name. */}
                {!sidebarOpen && hasView && (
                    <>
                        <span className="text-text-faint">/</span>
                        <ViewMenu />
                    </>
                )}
                {/* A live region, not a decorated span: a reader announces the change instead of
                    passing over a dot it has no reason to visit. */}
                <span role="status" aria-live="polite" className="flex shrink-0 items-center">
                    {dirty && <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />}
                    <span className="sr-only">{dirty ? t('toolbar.unsaved') : t('toolbar.saved')}</span>
                </span>
            </div>
            {/* A view of its own has no node header, so what that header carried sits here, fenced
                off from the panels, and from the breadcrumb as well where it starts beside it. A
                chat showing its sub-agents opens its breadcrumb with its own name, which needs no
                fence either. */}
            {leads && !inSubagents && <Separator />}
            {!split && <ViewToolbar view={view} focused={bodyFocused} chatTitle={sidebarOpen ? (view?.name ?? undefined) : undefined} />}
            {hasViewToolbar && <Separator />}
            <div className={BTN_GROUP}>
                <PanelControls />
            </div>
            <Separator />
            {/* The palette keeps the toolbar's right end, so with no panel beside it the search icon
                is what sits under the window controls on Windows and Linux and the inset lands here.
                An open panel reaches the window's edge instead and its header takes the inset over. */}
            <div className={clsx(BTN_GROUP, !panel.open && !voiceOpen && hasOverlayControls() && 'toolbar-overlay-inset')}>
                <UpdateButton />
                <VoiceButton />
                <Tooltip label={t('toolbar.search')} kbd={APP_SHORTCUTS.palette} name>
                    <button className="icon-btn" onClick={() => useUi.getState().setPaletteOpen(true)}>
                        <Icon icon={Search} size={16} />
                    </button>
                </Tooltip>
            </div>
            {/* Opening another project takes a round trip to the daemon; the line says the wait is the app's. */}
            {switching && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label={t('toolbar.opening')} />}
        </header>
    );
}

/* Only there when there is something to do about a new version, and green because it is good news
   rather than a warning. It opens About, which says what the state is and acts on it. */
function UpdateButton() {
    const { t } = useTranslation('shell');
    const state = useUpdates();
    if (!hasUpdate(state)) {
        return null;
    }
    const label = state.status === 'ready' ? t('toolbar.updateReady', { version: state.version ?? '' }).trim() : t('toolbar.updateOnTheWay');
    return (
        <Tooltip label={label} name>
            <button className="icon-btn text-positive hover:text-positive" onClick={() => useUi.getState().setSettings({ open: true, section: 'about' })}>
                <Icon icon={ArrowDownToLine} size={16} />
            </button>
        </Tooltip>
    );
}
