import { useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Ban } from 'lucide-react';
import { PROJECT_ICON_EMOJI_MAX, PROJECT_ICON_NAMES, type ProjectIconChoice } from '@ruimte/contracts';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { adoptMachineName } from '@/transport/server-info';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface MachineIdentityDialogProps {
    endpointId: string;
    /* The name the row shows now, so the dialog opens on something even before the machine answers. */
    label: string;
    open: boolean;
    onOpenChange(open: boolean): void;
}

/*
 * The form under the popup, which unmounts on close, so every look at the dialog starts at what the
 * machine says it is rather than at the draft of the time before.
 *
 * Name and icon travel together: the wire takes both on every call, because a null is a choice of
 * its own (back to the name the machine starts with, or no icon at all). That is why this is one
 * dialog with one Save and not the two steps a project's name and icon are: sending half of it would
 * mean deciding what the other half was, and another client may have changed it in the meantime.
 */
function IdentityForm({ endpointId, label, onOpenChange }: MachineIdentityDialogProps) {
    const info = useServers((s) => s.byEndpoint[endpointId]);
    const chosen = info?.nameSource === 'chosen';
    const [name, setName] = useState(chosen ? (info?.label ?? '') : '');
    const [icon, setIcon] = useState<ProjectIconChoice | null>(info?.icon ?? null);
    const [emoji, setEmoji] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const save = async (): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            setFailure('That machine is not known any more');
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const next = await link.request('endpoint.setIdentity', { name: name.trim() === '' ? null : name.trim(), icon });
            useServers.getState().setIdentity(endpointId, { label: next.label, nameSource: next.nameSource ?? null, icon: next.icon ?? null });
            adoptMachineName(endpointId, next.label, next.nameSource ?? null);
            onOpenChange(false);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That machine did not take the change');
        } finally {
            setBusy(false);
        }
    };

    const useEmoji = (): void => {
        if (emoji.trim() !== '') {
            setIcon({ kind: 'emoji', value: emoji.trim() });
        }
    };

    return (
        <>
            <div className="mt-3 flex items-center gap-3">
                <MachineGlyph icon={icon} size={32} className="text-text-muted" />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{name.trim() === '' ? label : name.trim()}</span>
                    <span className="truncate text-sm text-text-faint">Every client that pairs with this machine sees this name.</span>
                </div>
            </div>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Name</div>
            <input
                autoFocus
                className="field"
                aria-label="Machine name"
                placeholder={chosen ? 'The name this machine starts with' : label}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        void save();
                    }
                }}
            />
            <p className="mt-1.5 text-sm text-text-faint">Leave it empty to go back to the name the machine answers with on its own.</p>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Emoji</div>
            <div className="flex items-center gap-2">
                <input
                    className="field w-24 text-center"
                    aria-label="Emoji"
                    placeholder="🖥️"
                    value={emoji}
                    maxLength={PROJECT_ICON_EMOJI_MAX}
                    onChange={(e) => setEmoji(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                />
                <Button disabled={emoji.trim() === ''} onClick={useEmoji}>
                    Use emoji
                </Button>
                <span className="grow" />
                <Tooltip label="No icon" name>
                    <button className="icon-btn h-7 w-7" disabled={icon === null} onClick={() => setIcon(null)}>
                        <Icon icon={Ban} size={16} />
                    </button>
                </Tooltip>
            </div>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Icon</div>
            <div className="grid grid-cols-10 gap-1">
                {PROJECT_ICON_NAMES.map((entry) => (
                    <Tooltip key={entry} label={entry} name>
                        <button
                            type="button"
                            className={clsx(
                                'flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover',
                                icon?.kind === 'lucide' && icon.value === entry ? 'bg-surface-active text-text' : 'text-text-muted'
                            )}
                            onClick={() => setIcon({ kind: 'lucide', value: entry })}
                        >
                            <Icon icon={PROJECT_ICON_GLYPHS[entry]} size={16} />
                        </button>
                    </Tooltip>
                ))}
            </div>

            {failure && (
                <p className="mt-3 text-sm text-status-error" role="alert">
                    {failure}
                </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
                <Button onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button variant="primary" disabled={busy} onClick={() => void save()}>
                    Save
                </Button>
            </div>
        </>
    );
}

/* What a machine is called and what it looks like, set from any client that paired with it. */
export function MachineIdentityDialog(props: MachineIdentityDialogProps) {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                <Dialog.Popup className="dialog-popup dialog-popup-nested w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">Machine</Dialog.Title>
                    <IdentityForm {...props} />
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
