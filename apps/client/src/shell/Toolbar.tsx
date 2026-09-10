import clsx from 'clsx';
import { Search } from 'lucide-react';
import { hasOverlayControls } from '@/desktop/bridge';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { PanelControls } from '@/shell/PanelControls';
import { ProjectMenu } from '@/shell/ProjectMenu';
import { STRIP_PADDING_PX } from '@/shell/Sidebar';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { useProject } from '@/state/project';
import { useServer } from '@/state/server';
import { useUi } from '@/state/ui';
import { BTN_GROUP } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

/* The band above the canvas: which project is open, and the panels that sit next to it. It is as
   tall as the sidebar's own strip, so the two read as one title bar across the window. The
   connection dot lives here rather than in the sidebar, so it stays in view while the list is
   hidden; the left padding follows the sidebar's width, which keeps the breadcrumb from jumping
   when the list slides away. */
export function Toolbar() {
    const dirty = useProject((s) => s.dirty);
    const switching = useProject((s) => s.switching);
    const machine = useServer((s) => (s.reachability && s.reachability !== 'loopback' ? s.label : null));
    const panel = useUi((s) => s.panel);
    const previewOpen = useUi((s) => s.preview.open);
    const sidebarOpen = useUi((s) => s.sidebarOpen);
    const inset = useTrafficLightInset();

    return (
        <header
            className="app-drag relative flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-3 pl-2 text-xs text-text-muted transition-[padding] duration-200 ease-out"
            style={sidebarOpen ? undefined : { paddingLeft: inset ?? STRIP_PADDING_PX }}
        >
            {!sidebarOpen && <SidebarToggle />}
            <div className="flex min-w-0 grow items-center gap-2">
                {machine && (
                    <>
                        <span>{machine}</span>
                        <span className="text-text-faint">/</span>
                    </>
                )}
                <ProjectMenu />
                <span className="text-text-faint">/</span>
                <span>Canvas</span>
                {/* A live region, not a decorated span: a reader announces the change instead of
                    passing over a dot it has no reason to visit. */}
                <span role="status" aria-live="polite" className="flex shrink-0 items-center">
                    {dirty && <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />}
                    <span className="sr-only">{dirty ? 'Unsaved changes' : 'Everything saved'}</span>
                </span>
            </div>
            <ConnectionDot />
            <PanelControls />
            <Separator />
            {/* The palette keeps the toolbar's right end, so with no panel beside it the search icon
                is what sits under the window controls on Windows and Linux and the inset lands here.
                An open panel reaches the window's edge instead and its header takes the inset over. */}
            <div className={clsx(BTN_GROUP, !panel.open && !previewOpen && hasOverlayControls() && 'toolbar-overlay-inset')}>
                <Tooltip label="Search" kbd="⌘K" name>
                    <button className="icon-btn" onClick={() => useUi.getState().setPaletteOpen(true)}>
                        <Icon icon={Search} size={16} />
                    </button>
                </Tooltip>
            </div>
            {/* Opening another project takes a round trip to the daemon; the line says the wait is the app's. */}
            {switching && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label="Opening the project" />}
        </header>
    );
}
