import { useTranslation } from 'react-i18next';
import { PANELS } from '@/shell/panels';
import { useUi } from '@/state/ui';
import { IconButton } from '@basmilius/react-ui';

/* The panel toggles. They stay in the toolbar whether a panel is open or not, so a toggle never
   moves out from under the pointer; the panel's own header carries its title and its close button
   and nothing that belongs to the toolbar. */
export function PanelControls() {
    const { t } = useTranslation('shell');
    const panel = useUi((s) => s.panel);

    return (
        <>
            {PANELS.filter((entry) => entry.toolbar).map((entry) => (
                <IconButton
                    key={entry.kind}
                    icon={entry.icon}
                    label={t(`panel.names.${entry.kind}`)}
                    active={panel.open && panel.kind === entry.kind}
                    onClick={() => useUi.getState().togglePanel(entry.kind)}
                />
            ))}
        </>
    );
}
