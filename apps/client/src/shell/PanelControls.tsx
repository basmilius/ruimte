import { useTranslation } from 'react-i18next';
import { PANELS } from '@/shell/panels';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The panel toggles. They stay in the toolbar whether a panel is open or not, so a toggle never
   moves out from under the pointer; the panel's own header carries its title and its close button
   and nothing that belongs to the toolbar. */
export function PanelControls() {
    const { t } = useTranslation('shell');
    const panel = useUi((s) => s.panel);

    return (
        <>
            {PANELS.map((entry) => (
                <Tooltip key={entry.kind} label={t(`panel.names.${entry.kind}`)} name>
                    <button className="icon-btn" data-active={panel.open && panel.kind === entry.kind} onClick={() => useUi.getState().togglePanel(entry.kind)}>
                        <Icon icon={entry.icon} size={16} />
                    </button>
                </Tooltip>
            ))}
        </>
    );
}
