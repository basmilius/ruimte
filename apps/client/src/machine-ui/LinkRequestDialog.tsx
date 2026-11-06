import { LinkMachineDialog } from '@/machine-ui/LinkMachineDialog';
import { closeLinkRequest, useLinkRequest } from '@/pulsar/link-request';

/* The approval a `/link` address opened, outside every workspace. The web client shows it before a machine is picked. */
export function LinkRequestDialog() {
    const open = useLinkRequest((s) => s.open);
    const code = useLinkRequest((s) => s.code);

    return <LinkMachineDialog open={open} initialCode={code} onOpenChange={(next) => (next ? undefined : closeLinkRequest())} />;
}
