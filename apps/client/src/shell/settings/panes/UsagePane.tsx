import { UsagePane as Pane } from '@ruimte/agents-react/usage/UsagePane';
import { useUi } from '@/state/ui';

// The usage page is a dialog of its own, so settings step aside rather than stack two dialogs.
const openUsage = (): void => {
    const ui = useUi.getState();
    ui.setSettings({ open: false });
    ui.setUsageOpen(true);
};

export function UsagePane() {
    return <Pane onOpenPage={openUsage} />;
}
