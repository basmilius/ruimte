import { UsagePane as Pane } from '@adecore/agents-react/usage';
import { useUi } from '@/state/ui';
import { usageDialog } from '@/usage/dialog';

// The usage page is a dialog of its own, so settings step aside rather than stack two dialogs.
function openUsage(): void {
    const ui = useUi.getState();
    ui.setSettings({ open: false });
    usageDialog.open();
}

export function UsagePane() {
    return <Pane onOpenPage={openUsage} />;
}
