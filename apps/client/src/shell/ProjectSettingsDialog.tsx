import { useRef, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { FolderSearch, ImageUp } from 'lucide-react';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { type ProjectIconChoice, type ProjectSummary } from '@ruimte/contracts';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { IconPicker } from '@/ui/IconPicker';
import { useAsyncAction } from '@/ui/useAsyncAction';

// The daemon rejects larger files, so the picker catches them before sending the bytes.
const MAX_BYTES = 256 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/* A picked file without the data URL prefix that FileReader adds. */
const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(i18next.t('shell:projectSettings.unreadable')));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            resolve(comma === -1 ? '' : result.slice(comma + 1));
        };
        reader.readAsDataURL(file);
    });

/* Everything the form works on, in one value the dialog can outlive its target with. */
export interface ProjectSettingsSubject {
    project: ProjectSummary;
    endpointId: string;
    actions: {
        rename(name: string): Promise<void>;
        setChosenIcon(icon: ProjectIconChoice): Promise<void>;
        uploadIcon(mime: string, base64: string): Promise<void>;
        useFolderIcon(): Promise<void>;
    };
}

interface ProjectSettingsDialogProps {
    /* Null before the dialog is ever opened, and again once it has finished closing. */
    subject: ProjectSettingsSubject | null;
    open: boolean;
    onOpenChange(open: boolean): void;
    onOpenChangeComplete(open: boolean): void;
}

function ProjectSettingsForm({ project, endpointId, actions, onOpenChange }: ProjectSettingsSubject & { onOpenChange(open: boolean): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const chosen = project.icon.kind === 'lucide' ? project.icon : null;
    const fileRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(project.name);
    const { busy, failure, run, fail } = useAsyncAction(t('projectName.failed'));
    const trimmedName = name.trim();

    const pickFile = async (file: File | undefined): Promise<void> => {
        if (!file) {
            return;
        }
        if (file.size > MAX_BYTES) {
            fail(t('projectSettings.tooLarge'));
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
            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>{t('projectSettings.name')}</div>
            <input
                autoFocus
                className="field"
                maxLength={MAX_TITLE_LENGTH}
                aria-label={t('projectName.label')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                        void save();
                    }
                }}
            />

            <div className={`${SECTION_LABEL} mt-5 mb-1.5`}>{t('common:icon.label')}</div>
            <div className="flex items-center gap-3">
                <ProjectGlyph projectId={project.projectId} endpointId={endpointId} icon={project.icon} color={project.color} size={32} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{project.name}</span>
                    <span className="truncate text-sm text-text-faint">
                        {project.icon.kind === 'image'
                            ? t('projectSettings.fromFile', { file: project.icon.value })
                            : chosen
                              ? t('viewIcon.pickedHere')
                              : t('projectSettings.firstLetter')}
                    </span>
                </div>
            </div>

            <IconPicker value={chosen} disabled={busy} gridLabel={t('common:icon.symbol')} onChange={(icon) => void run(() => actions.setChosenIcon(icon))} />

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
                <Button disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Icon icon={ImageUp} size={12} /> {t('projectSettings.chooseImage')}
                </Button>
                <Button disabled={busy} onClick={() => void run(actions.useFolderIcon)}>
                    <Icon icon={FolderSearch} size={12} /> {t('projectSettings.useFolderIcon')}
                </Button>
                <span className="grow" />
                <Button variant="primary" disabled={busy || trimmedName === ''} onClick={() => void save()}>
                    {t('common:action.done')}
                </Button>
            </div>
        </>
    );
}

/* The dialog stays in the tree with its subject, so Base UI sees the open go from false to true and
   the popup animates both ways. A subject dropped at the click would cut the closing one short. */
export function ProjectSettingsDialog({ subject, open, onOpenChange, onOpenChangeComplete }: ProjectSettingsDialogProps) {
    const { t } = useTranslation('shell');
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{t('projectSettings.title')}</Dialog.Title>
                    {subject !== null && <ProjectSettingsForm {...subject} onOpenChange={onOpenChange} />}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
