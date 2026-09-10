import { FileText } from 'lucide-react';
import { PANELS } from '@/shell/panels';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The panel toggles. They stay in the toolbar whether a panel is open or not, so a toggle never
   moves out from under the pointer; the panel's own header carries its title and its close button
   and nothing that belongs to the toolbar. */
export function PanelControls() {
    const panel = useUi((s) => s.panel);
    const previewOpen = useUi((s) => s.preview.open);
    const hasTabs = useFiles((s) => s.tabs.length > 0);

    return (
        <div className="btn-group">
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
