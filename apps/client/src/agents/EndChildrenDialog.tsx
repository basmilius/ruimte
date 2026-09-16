import { Dialog } from '@base-ui-components/react/dialog';
import { Square, Trash } from 'lucide-react';
import { endsAgentsWarning, stopsTaskWarning, useEndingAgents } from '@/agents/end-children';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/* Asked before a delete that also ends the agents the deleted nodes opened, and before a task is stopped, with how many. */
export function EndChildrenDialog() {
    const pending = useEndingAgents((s) => s.pending);
    const close = (): void => useEndingAgents.setState({ pending: null });
    const stop = pending?.action === 'stop';

    return (
        <Dialog.Root open={pending !== null} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">
                        {stop ? 'Stop' : 'Delete'} {pending?.what}?
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-text-muted">{stop ? stopsTaskWarning(pending?.agents ?? 0) : endsAgentsWarning(pending?.agents ?? 0)}</p>
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={close}>Cancel</Button>
                        <Button
                            variant="danger"
                            onClick={() => {
                                pending?.run();
                                close();
                            }}
                        >
                            <Icon icon={stop ? Square : Trash} size={12} /> {stop ? 'Stop' : 'Delete'}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
