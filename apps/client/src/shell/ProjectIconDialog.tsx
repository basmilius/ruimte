import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { FolderSearch, ImageUp } from 'lucide-react';
import { PROJECT_ICON_NAMES, type ProjectSummary } from '@ruimte/contracts';
import { projectClient } from '@/project';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { useProject } from '@/state/project';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The daemon refuses anything larger; saying so here saves a round trip with a photo attached.
const MAX_BYTES = 256 * 1024;

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/* The bytes of a picked file as base64, without the `data:` prefix a FileReader puts in front. */
const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('That file could not be read'));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            resolve(comma === -1 ? '' : result.slice(comma + 1));
        };
        reader.readAsDataURL(file);
    });

interface ProjectIconDialogProps {
    project: ProjectSummary;
    open: boolean;
    onOpenChange(open: boolean): void;
}

/* Picks what a project looks like: an emoji, one of the Lucide icons, an image file, or the folder. */
export function ProjectIconDialog({ project, open, onOpenChange }: ProjectIconDialogProps) {
    const chosen = useProject((s) => s.chosenIcon);
    const fileRef = useRef<HTMLInputElement>(null);
    const [emoji, setEmoji] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const run = async (work: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await work();
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That did not work');
        } finally {
            setBusy(false);
        }
    };

    const pickFile = async (file: File | undefined): Promise<void> => {
        if (!file) {
            return;
        }
        if (file.size > MAX_BYTES) {
            setFailure('That image is larger than 256 KB');
            return;
        }
        await run(async () => {
            await projectClient.uploadIcon(file.type, await readAsBase64(file));
        });
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[18vh] w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">Project icon</Dialog.Title>
                    <div className="mt-3 flex items-center gap-3">
                        <ProjectGlyph projectId={project.projectId} icon={project.icon} color={project.color} size={32} />
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm text-text">{project.name}</span>
                            <span className="truncate text-xs text-text-faint">
                                {project.icon.kind === 'image' ? `From ${project.icon.value}` : chosen ? 'Picked here' : 'The first letter of the name'}
                            </span>
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
                        <Button
                            disabled={busy || emoji.trim() === ''}
                            onClick={() => void run(() => projectClient.setChosenIcon({ kind: 'emoji', value: emoji.trim() }))}
                        >
                            Use emoji
                        </Button>
                    </div>

                    <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Icon</div>
                    <div className="grid grid-cols-10 gap-1">
                        {PROJECT_ICON_NAMES.map((name) => (
                            <Tooltip key={name} label={name} name>
                                <button
                                    type="button"
                                    disabled={busy}
                                    className={clsx(
                                        'flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover',
                                        chosen?.kind === 'lucide' && chosen.value === name ? 'bg-surface-active text-text' : 'text-text-muted'
                                    )}
                                    onClick={() => void run(() => projectClient.setChosenIcon({ kind: 'lucide', value: name }))}
                                >
                                    <Icon icon={PROJECT_ICON_GLYPHS[name]} size={16} />
                                </button>
                            </Tooltip>
                        ))}
                    </div>

                    {failure && (
                        <p className="mt-3 text-xs text-status-error" role="alert">
                            {failure}
                        </p>
                    )}

                    <input
                        ref={fileRef}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            void pickFile(file);
                        }}
                    />
                    <div className="mt-4 flex items-center gap-2">
                        <Button disabled={busy || !project.folder} onClick={() => fileRef.current?.click()}>
                            <Icon icon={ImageUp} size={12} /> Choose image…
                        </Button>
                        <Button disabled={busy || !project.folder} onClick={() => void run(() => projectClient.useFolderIcon())}>
                            <Icon icon={FolderSearch} size={12} /> Use folder's icon
                        </Button>
                        <span className="grow" />
                        <Button variant="primary" onClick={() => onOpenChange(false)}>
                            Done
                        </Button>
                    </div>
                    {!project.folder && <p className="mt-2 text-xs text-text-faint">A canvas without a folder has nowhere to keep an image.</p>}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
