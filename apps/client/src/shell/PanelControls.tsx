import { useTranslation } from 'react-i18next';
import { toolbarPanels } from '@/shell/panels';
import { isScratchProject, useProject } from '@/state/project';
import { useShownPanel, useUi } from '@/state/ui';
import { IconButton } from '@adecore/ui';

/* The panel toggles. They stay in the toolbar whether a panel is open or not, so a toggle never
   moves out from under the pointer; the panel's own header carries its title and its close button
   and nothing that belongs to the toolbar. */
export function PanelControls() {
    const { t } = useTranslation('shell');
    const panel = useShownPanel();
    const scratch = useProject((s) => isScratchProject(s.current));

    return (
        <>
            {toolbarPanels(scratch).map((entry) => (
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
