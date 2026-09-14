import { useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { RotateCcw } from 'lucide-react';
import { PROJECT_ICON_NAMES, type ProjectIconChoice, type ProjectView, viewIconOf } from '@ruimte/contracts';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { ViewGlyph } from '@/project/ViewGlyph';
import { useDocument } from '@/state/document';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* Picks the mark one view wears: an emoji, one of the Lucide icons, or whatever its kind gives it. */
export function ViewIconDialog({ view, onClose }: { view: ProjectView; onClose(): void }) {
    const [emoji, setEmoji] = useState('');
    const chosen = viewIconOf(view);
    const provider = view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null;

    const pick = (icon: ProjectIconChoice | null): void => useDocument.getState().setViewIcon(view.id, icon);

    return (
        <>
            <Dialog.Title className="text-base font-semibold text-text">View icon</Dialog.Title>
            <div className="mt-3 flex items-center gap-3">
                <ViewGlyph id={view.id} kind={view.kind} icon={chosen} provider={provider} path={view.kind === 'file' ? view.path : null} size={20} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{view.kind === 'separator' ? 'Separator' : view.name}</span>
                    <span className="truncate text-sm text-text-faint">{chosen ? 'Picked here' : 'Default for its kind'}</span>
                </div>
            </div>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Emoji</div>
            <div className="flex items-center gap-2">
                <input
                    className="field w-24 text-center"
                    aria-label="Emoji"
                    placeholder="🚀"
                    value={emoji}
                    maxLength={16}
                    onChange={(e) => setEmoji(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                />
                <Button disabled={emoji.trim() === ''} onClick={() => pick({ kind: 'emoji', value: emoji.trim() })}>
                    Use emoji
                </Button>
            </div>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Icon</div>
            <div className="grid grid-cols-10 gap-1">
                {PROJECT_ICON_NAMES.map((name) => (
                    <Tooltip key={name} label={name} name>
                        <button
                            type="button"
                            className={clsx(
                                'flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover',
                                chosen?.kind === 'lucide' && chosen.value === name ? 'bg-surface-active text-text' : 'text-text-muted'
                            )}
                            onClick={() => pick({ kind: 'lucide', value: name })}
                        >
                            <Icon icon={PROJECT_ICON_GLYPHS[name]} size={16} />
                        </button>
                    </Tooltip>
                ))}
            </div>

            <div className="mt-4 flex items-center gap-2">
                <Button disabled={!chosen} onClick={() => pick(null)}>
                    <Icon icon={RotateCcw} size={12} /> Use the default
                </Button>
                <span className="grow" />
                <Button variant="primary" onClick={onClose}>
                    Done
                </Button>
            </div>
        </>
    );
}
