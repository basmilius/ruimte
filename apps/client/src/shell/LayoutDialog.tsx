import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { useCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { Button } from '@/ui/Button';

/* Names an arrangement of the canvas so it can be brought back later from the dock or the palette. */
export function LayoutDialog() {
    const open = useUi((s) => s.layoutDialogOpen);
    const setOpen = useUi((s) => s.setLayoutDialogOpen);
    const [name, setName] = useState('');

    const submit = (): void => {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        useCanvas.getState().saveLayout(trimmed);
        setName('');
        setOpen(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[24vh] w-[380px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">Save layout</Dialog.Title>
                    <p className="mt-1 text-xs text-text-muted">Where every node and text sits right now, under a name you can apply later.</p>
                    <input
                        autoFocus
                        className="field mt-3"
                        aria-label="Layout name"
                        placeholder="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                submit();
                            }
                        }}
                    />
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={() => setOpen(false)}>Cancel</Button>
                        <Button variant="primary" disabled={!name.trim()} onClick={submit}>
                            Save
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
