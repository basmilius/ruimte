import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The panel toggles. They belong to whatever strip is rightmost: the toolbar while the panel is
   closed, the panel's own header once it is open, so the buttons keep the window's right edge and
   never move on a toggle. That edge is also where Windows and Linux draw their window controls, so
   the inset travels with them. */
export function PanelControls() {
    const panel = useUi((s) => s.panel);
    const previewOpen = useUi((s) => s.preview.open);
    const hasTabs = useFiles((s) => s.tabs.length > 0);

    return (
        <div className={clsx('btn-group', hasOverlayControls() && 'toolbar-overlay-inset')}>
            {/* No open file means nothing to preview, so the toggle arrives with the first one. */}
            {hasTabs && (
                <Tooltip label="Preview" name>
                    <button className="icon-btn" data-active={previewOpen} onClick={() => useUi.getState().togglePreview()}>
                        <Icon icon={FileText} size={16} />
                    </button>
                </Tooltip>
            )}
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
