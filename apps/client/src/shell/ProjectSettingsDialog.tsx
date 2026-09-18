import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { FolderSearch, ImageUp } from 'lucide-react';
import { PROJECT_ICON_NAMES, type ProjectIconChoice, type ProjectSummary } from '@ruimte/contracts';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The daemon rejects larger files, so the picker catches them before sending the bytes.
const MAX_BYTES = 256 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/* A picked file without the data URL prefix that FileReader adds. */
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

interface ProjectSettingsDialogProps {
    project: ProjectSummary;
    endpointId: string;
    open: boolean;
    onOpenChange(open: boolean): void;
    actions: {
        rename(name: string): Promise<void>;
        setChosenIcon(icon: ProjectIconChoice): Promise<void>;
        uploadIcon(mime: string, base64: string): Promise<void>;
        useFolderIcon(): Promise<void>;
    };
}

function ProjectSettingsForm({ project, endpointId, onOpenChange, actions }: Omit<ProjectSettingsDialogProps, 'open'>) {
    const chosen = project.icon.kind === 'emoji' || project.icon.kind === 'lucide' ? project.icon : null;
    const fileRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(project.name);
    const [emoji, setEmoji] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const trimmedName = name.trim();

    const run = async (work: () => Promise<void>): Promise<boolean> => {
        setBusy(true);
        setFailure(null);
        try {
            await work();
            return true;
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That did not work');
            return false;
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
        await run(async () => actions.uploadIcon(file.type, await readAsBase64(file)));
    };

    const save = async (): Promise<void> => {
        if (trimmedName === '') {
            return;
        }
        if (trimmedName !== project.name && !(await run(() => actions.rename(trimmedName)))) {
            return;
        }
        onOpenChange(false);
    };

    return (
        <>
            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Name</div>
            <input
                autoFocus
                className="field"
                aria-label="Project name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                        void save();
                    }
                }}
            />

            <div className={`${SECTION_LABEL} mt-5 mb-1.5`}>Icon</div>
            <div className="flex items-center gap-3">
                <ProjectGlyph projectId={project.projectId} endpointId={endpointId} icon={project.icon} color={project.color} size={32} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{project.name}</span>
                    <span className="truncate text-sm text-text-faint">
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
                    onChange={(event) => setEmoji(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                />
                <Button disabled={busy || emoji.trim() === ''} onClick={() => void run(() => actions.setChosenIcon({ kind: 'emoji', value: emoji.trim() }))}>
                    Use emoji
                </Button>
            </div>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>Symbol</div>
            <div className="grid grid-cols-10 gap-1">
                {PROJECT_ICON_NAMES.map((iconName) => (
                    <Tooltip key={iconName} label={iconName} name>
                        <button
                            type="button"
                            disabled={busy}
                            className={clsx(
                                'flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover',
                                chosen?.kind === 'lucide' && chosen.value === iconName ? 'bg-surface-active text-text' : 'text-text-muted'
                            )}
                            onClick={() => void run(() => actions.setChosenIcon({ kind: 'lucide', value: iconName }))}
                        >
                            <Icon icon={PROJECT_ICON_GLYPHS[iconName]} size={16} />
                        </button>
                    </Tooltip>
                ))}
            </div>

            {failure && (
                <p className="mt-3 text-sm text-status-error" role="alert">
                    {failure}
                </p>
            )}

            <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    void pickFile(file);
                }}
            />
            <div className="mt-4 flex items-center gap-2">
                <Button disabled={busy || !project.folder} onClick={() => fileRef.current?.click()}>
                    <Icon icon={ImageUp} size={12} /> Choose image…
                </Button>
                <Button disabled={busy || !project.folder} onClick={() => void run(actions.useFolderIcon)}>
                    <Icon icon={FolderSearch} size={12} /> Use folder's icon
                </Button>
                <span className="grow" />
                <Button variant="primary" disabled={busy || trimmedName === ''} onClick={() => void save()}>
                    Done
                </Button>
            </div>
            {!project.folder && <p className="mt-2 text-sm text-text-faint">A project without a folder cannot use an image.</p>}
        </>
    );
}

export function ProjectSettingsDialog({ project, endpointId, open, onOpenChange, actions }: ProjectSettingsDialogProps) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">Project settings</Dialog.Title>
                    <ProjectSettingsForm project={project} endpointId={endpointId} onOpenChange={onOpenChange} actions={actions} />
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
