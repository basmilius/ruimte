import clsx from 'clsx';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { ProjectMenu } from '@/shell/ProjectMenu';
import { useProject } from '@/state/project';
import { useServer } from '@/state/server';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The band above the canvas: which project is open, and the panels that sit next to it. It is as
   tall as the sidebar's own strip, so the two read as one title bar across the window. */
export function Toolbar() {
    const dirty = useProject((s) => s.dirty);
    const machine = useServer((s) => (s.reachability && s.reachability !== 'loopback' ? s.label : null));
    const panel = useUi((s) => s.panel);

    return (
        <header className="app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-3 pl-2 text-[12px] text-text-muted">
            <div className="flex min-w-0 grow items-center gap-2">
                {machine && (
                    <>
                        <span className="pl-2">{machine}</span>
                        <span className="text-text-faint">/</span>
                    </>
                )}
                <ProjectMenu />
                <span className="text-text-faint">/</span>
                <span>Canvas</span>
                {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" aria-label="Unsaved changes" />}
            </div>
            <div className={clsx('btn-group', hasOverlayControls() && 'toolbar-overlay-inset')}>
                {PANELS.map((entry) => (
                    <Tooltip key={entry.kind} label={entry.label}>
                        <button
                            className="icon-btn"
                            aria-label={entry.label}
                            data-active={panel.open && panel.kind === entry.kind}
                            onClick={() => useUi.getState().togglePanel(entry.kind)}
                        >
                            <Icon icon={entry.icon} size={15} />
                        </button>
                    </Tooltip>
                ))}
            </div>
        </header>
    );
}
