import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { useCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';

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
                        className="mt-3 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
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
                        <button
                            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-text-muted hover:bg-surface-sunken hover:text-text"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-text disabled:opacity-50"
                            disabled={!name.trim()}
                            onClick={submit}
                        >
                            Save
                        </button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
