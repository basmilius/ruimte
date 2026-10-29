import { useRef, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { FolderSearch, ImageUp } from 'lucide-react';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { DEFAULT_PROJECT_COLOR, type ProjectIconChoice, type ProjectSummary } from '@ruimte/contracts';
import { accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { PROJECT_ICON_KEYWORDS } from '@/project/project-icons';
import { useProjectIconGroups } from '@/project/use-project-icon-groups';
import { ProjectAccountsSection } from '@/shell/ProjectAccountsSection';
import { submitOnEnter } from '@/shell/submit-on-enter';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { Button, ColorSwatch, Icon, useAsyncAction, Dialog, Field, FormError, IconPicker, Input, SectionLabel, Tooltip } from '@adecore/ui';

// The daemon rejects larger files, so the picker catches them before sending the bytes.
const MAX_BYTES = 256 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/heic,image/heif,.heic,.heif';

/* A picked file without the data URL prefix that FileReader adds. */
function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(i18next.t('shell:projectSettings.unreadable')));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            resolve(comma === -1 ? '' : result.slice(comma + 1));
        };
        reader.readAsDataURL(file);
    });
}

/* Everything the form works on, in one value the dialog can outlive its target with. */
export interface ProjectSettingsSubject {
    project: ProjectSummary;
    endpointId: string;
    actions: {
        rename(name: string): Promise<void>;
        setColor(color: string): Promise<void>;
        setChosenIcon(icon: ProjectIconChoice): Promise<void>;
        clearChosenIcon(): Promise<void>;
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
    const iconGroups = useProjectIconGroups();
    const trimmedName = name.trim();
    /* The Chats project's name is the app's word and its folder the daemon's, so only its symbol is a person's to pick. */
    const scratch = project.scratch === true;
    // The accounts come with the project this window holds, so only its own settings show them.
    const onScreen = useProject((s) => s.current?.projectId === project.projectId) && endpointId === currentEndpointId();

    const pickFile = async (file: File | undefined): Promise<void> => {
        if (!file) {
            return;
        }
        if (file.size > MAX_BYTES) {
            fail(t('projectSettings.tooLarge'));
            return;
        }
        const mime = file.type || (/\.hei[cf]$/i.test(file.name) ? `image/${file.name.slice(-4).toLowerCase()}` : '');

        await run(async () => actions.uploadIcon(mime, await readAsBase64(file)));
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
            {!scratch && (
                <Field label={t('projectSettings.name')} className="mt-4">
                    <Input
                        autoFocus
                        maxLength={MAX_TITLE_LENGTH}
                        aria-label={t('projectName.label')}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={submitOnEnter(() => void save())}
                    />
                </Field>
            )}

            {!scratch && (
                <>
                    <SectionLabel render={<div />} className="mt-5 mb-1.5">
                        {t('projectSettings.color')}
                    </SectionLabel>
                    {/* In the shared project file, beside the name, so the whole team sees the project in it. */}
                    <div role="radiogroup" aria-label={t('projectSettings.color')} className="flex flex-wrap gap-1.5">
                        <Tooltip label={t('projectSettings.defaultColor')}>
                            <ColorSwatch
                                role="radio"
                                aria-checked={project.color === DEFAULT_PROJECT_COLOR}
                                aria-label={t('projectSettings.defaultColor')}
                                color={DEFAULT_PROJECT_COLOR}
                                picked={project.color === DEFAULT_PROJECT_COLOR}
                                disabled={busy}
                                onClick={() => void run(() => actions.setColor(DEFAULT_PROJECT_COLOR))}
                            />
                        </Tooltip>
                        {NODE_ACCENTS.map((accent) => (
                            <Tooltip key={accent.id} label={accentLabel(accent.id)}>
                                <ColorSwatch
                                    role="radio"
                                    aria-checked={project.color === accent.color}
                                    aria-label={accentLabel(accent.id)}
                                    color={accent.color}
                                    picked={project.color === accent.color}
                                    disabled={busy}
                                    onClick={() => void run(() => actions.setColor(accent.color))}
                                />
                            </Tooltip>
                        ))}
                    </div>
                </>
            )}

            <SectionLabel render={<div />} className="mt-5 mb-1.5">
                {t('common:icon.label')}
            </SectionLabel>
            <div className="flex items-center gap-3">
                <ProjectGlyph projectId={project.projectId} endpointId={endpointId} icon={project.icon} color={project.color} size={32} scratch={scratch} />
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

            <IconPicker
                icons={iconGroups}
                keywords={PROJECT_ICON_KEYWORDS}
                rows={7}
                value={chosen?.value ?? null}
                disabled={busy}
                label={t('common:icon.symbol')}
                className="mt-4"
                onValueChange={(icon) => void run(() => actions.setChosenIcon({ kind: 'lucide', value: icon as ProjectIconChoice['value'] }))}
                onClear={() => void run(actions.clearChosenIcon)}
            />

            {!scratch && onScreen && <ProjectAccountsSection projectId={project.projectId} endpointId={endpointId} />}

            {failure && <FormError className="mt-3 break-words">{failure}</FormError>}

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
                {!scratch && (
                    <>
                        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
                            <Icon icon={ImageUp} size={12} /> {t('projectSettings.chooseImage')}
                        </Button>
                        <Button disabled={busy} onClick={() => void run(actions.useFolderIcon)}>
                            <Icon icon={FolderSearch} size={12} /> {t('projectSettings.useFolderIcon')}
                        </Button>
                    </>
                )}
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
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('projectSettings.title')}</Dialog.Title>
                {subject !== null && <ProjectSettingsForm {...subject} onOpenChange={onOpenChange} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
