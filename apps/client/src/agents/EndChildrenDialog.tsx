import { Dialog } from '@base-ui-components/react/dialog';
import { Trash } from 'lucide-react';
import { endsAgentsWarning, useEndingAgents } from '@/agents/end-children';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/* Asked before a delete that also ends the agents the deleted nodes opened, with how many. */
export function EndChildrenDialog() {
    const pending = useEndingAgents((s) => s.pending);
    const close = (): void => useEndingAgents.setState({ pending: null });

    return (
        <Dialog.Root open={pending !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">Delete {pending?.what}?</Dialog.Title>
                    <p className="mt-1 text-sm text-text-muted">{endsAgentsWarning(pending?.agents ?? 0)}</p>
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={close}>Cancel</Button>
                        <Button
                            variant="danger"
                            onClick={() => {
                                pending?.run();
                                close();
                            }}
                        >
                            <Icon icon={Trash} size={12} /> Delete
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
