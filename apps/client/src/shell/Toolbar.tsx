import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { PanelControls } from '@/shell/PanelControls';
import { ProjectMenu } from '@/shell/ProjectMenu';
import { STRIP_PADDING_PX } from '@/shell/Sidebar';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { useProject } from '@/state/project';
import { useServer } from '@/state/server';
import { useUi } from '@/state/ui';

/* The band above the canvas: which project is open, and the panels that sit next to it. It is as
   tall as the sidebar's own strip, so the two read as one title bar across the window. The
   connection dot lives here rather than in the sidebar, so it stays in view while the list is
   hidden; the left padding follows the sidebar's width, which keeps the breadcrumb from jumping
   when the list slides away. */
export function Toolbar() {
    const dirty = useProject((s) => s.dirty);
    const machine = useServer((s) => (s.reachability && s.reachability !== 'loopback' ? s.label : null));
    const panel = useUi((s) => s.panel);
    const sidebarOpen = useUi((s) => s.sidebarOpen);
    const inset = useTrafficLightInset();

    return (
        <header
            className="app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-3 pl-2 text-xs text-text-muted transition-[padding] duration-200 ease-out"
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
                {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" aria-label="Unsaved changes" />}
            </div>
            <ConnectionDot />
            {!panel.open && <PanelControls />}
        </header>
    );
}
