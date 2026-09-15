import { useState } from 'react';
import clsx from 'clsx';
import { Ban } from 'lucide-react';
import { PROJECT_ICON_EMOJI_MAX, PROJECT_ICON_NAMES, type ProjectIconChoice } from '@ruimte/contracts';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { adoptMachineName } from '@/transport/server-info';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface MachineIdentityFormProps {
    endpointId: string;
    /* The name the row shows now, as the placeholder of a machine nobody named. */
    label: string;
    /* Why nothing can be saved, shown on the disabled button; null while the machine answers. */
    disabledReason: string | null;
}

/*
 * Name and icon travel together: the wire takes both on every call, because a null is a choice of
 * its own (back to the name the machine starts with, or no icon at all). That is why this is one form
 * with one Save and not two steps: sending half of it would mean deciding what the other half was,
 * and another client may have changed it in the meantime. The dialog keys the form on what the
 * machine says, so a change from elsewhere starts it over.
 */
export function MachineIdentityForm({ endpointId, label, disabledReason }: MachineIdentityFormProps) {
    const info = useServers((s) => s.byEndpoint[endpointId]);
    const savedName = info?.nameSource === 'chosen' ? (info.label ?? '') : '';
    const savedIcon = info?.icon ?? null;
    const [name, setName] = useState(savedName);
    const [icon, setIcon] = useState<ProjectIconChoice | null>(savedIcon);
    const [emoji, setEmoji] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const disabled = disabledReason !== null;
    const dirty = name.trim() !== savedName || JSON.stringify(icon) !== JSON.stringify(savedIcon);

    const save = async (): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            setFailure('That machine is no longer in the list');
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const next = await link.request('endpoint.setIdentity', { name: name.trim() === '' ? null : name.trim(), icon });
            useServers.getState().setIdentity(endpointId, {
                label: next.label,
                nameSource: next.nameSource ?? null,
                icon: next.icon ?? null,
                agentsDeleteAnyView: next.agentsDeleteAnyView === true
            });
            adoptMachineName(endpointId, next.label, next.nameSource ?? null);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'The machine could not save the change');
        } finally {
            setBusy(false);
        }
    };

    const useEmoji = (): void => {
        if (emoji.trim() !== '') {
            setIcon({ kind: 'emoji', value: emoji.trim() });
        }
    };

    const saveButton = (
        <Button variant="primary" disabled={disabled || busy || !dirty} onClick={() => void save()}>
            Save
        </Button>
    );

    return (
        <div className="flex min-w-0 flex-col p-4">
            <div className={`${SECTION_LABEL} mb-1.5`}>Name</div>
            <input
                className="field"
                aria-label="Machine name"
                placeholder={label}
                value={name}
                disabled={disabled}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && dirty) {
                        void save();
                    }
                }}
            />
            <p className="mt-1.5 text-xs text-text-faint">Leave empty to use the default name.</p>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Emoji</div>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="field w-24 text-center"
                    aria-label="Emoji"
                    placeholder="🖥️"
                    value={emoji}
                    disabled={disabled}
                    maxLength={PROJECT_ICON_EMOJI_MAX}
                    onChange={(e) => setEmoji(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                />
                <Button disabled={disabled || emoji.trim() === ''} onClick={useEmoji}>
                    Use emoji
                </Button>
                <span className="grow" />
                <Tooltip label="No icon" name>
                    <button className="icon-btn h-7 w-7" disabled={disabled || icon === null} onClick={() => setIcon(null)}>
                        <Icon icon={Ban} size={16} />
                    </button>
                </Tooltip>
            </div>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Icon</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(28px,1fr))] gap-1">
                {PROJECT_ICON_NAMES.map((entry) => (
                    <Tooltip key={entry} label={entry} name>
                        <button
                            type="button"
                            disabled={disabled}
                            className={clsx(
                                'flex h-7 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-50',
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
                <p className="mt-3 text-xs break-words text-status-error" role="alert">
                    {failure}
                </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
                {disabled ? (
                    <Tooltip label={disabledReason}>
                        <span className="inline-flex">{saveButton}</span>
                    </Tooltip>
                ) : (
                    saveButton
                )}
            </div>
        </div>
    );
}
