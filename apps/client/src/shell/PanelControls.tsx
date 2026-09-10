import clsx from 'clsx';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The Files and Git toggles. They belong to whatever strip is rightmost: the toolbar while the
   panel is closed, the panel's own header once it is open, so the buttons keep the window's right
   edge and never move on a toggle. That edge is also where Windows and Linux draw their window
   controls, so the inset travels with them. */
export function PanelControls() {
    const panel = useUi((s) => s.panel);

    return (
        <div className={clsx('btn-group', hasOverlayControls() && 'toolbar-overlay-inset')}>
            {PANELS.map((entry) => (
                <Tooltip key={entry.kind} label={entry.label} name>
                    <button className="icon-btn" data-active={panel.open && panel.kind === entry.kind} onClick={() => useUi.getState().togglePanel(entry.kind)}>
                        <Icon icon={entry.icon} size={16} />
                    </button>
                </Tooltip>
            ))}
        </div>
    );
}
