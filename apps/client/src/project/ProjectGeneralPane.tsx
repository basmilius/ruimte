import { Button, ColorSwatch, FormError, Icon, IconPicker, Input, Tooltip, useAsyncAction } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { DEFAULT_PROJECT_COLOR, type ProjectIconChoice } from '@ruimte/contracts';
import i18next from 'i18next';
import { FolderSearch, ImageUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accentLabel, NODE_ACCENTS } from '@/canvas-model/accents';
import { useProjectSettingsSubject } from '@/project/project-settings-subject';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useProjectIconGroups } from '@/project/use-project-icon-groups';
import { PROJECT_ICON_KEYWORDS } from '@/surface/project-icons';
import { submitOnEnter } from '@/surface/submit-on-enter';

// The daemon rejects larger files, so the picker catches them before sending the bytes.
const MAX_BYTES = 256 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/heic,image/heif,.heic,.heif';

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

/* The name, color and icon of a project. The Chats project's name is the app's word and its folder the daemon's, so only its symbol is a person's to pick. */
export function ProjectGeneralPane() {
    const { t } = useTranslation(['shell', 'common']);
    const { project, endpointId, actions } = useProjectSettingsSubject();
    const chosen = project.icon.kind === 'lucide' ? project.icon : null;
    const fileRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(project.name);
    const { busy, failure, run, fail } = useAsyncAction(t('projectName.failed'));
    const iconGroups = useProjectIconGroups();
    const scratch = project.scratch === true;

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

    // A setting here takes effect where it is set, so the name is kept when the field is left, and an empty one goes back.
    const keepName = async (): Promise<void> => {
        const trimmed = name.trim();

        if (trimmed === '' || trimmed === project.name) {
            setName(project.name);

            return;
        }

        if (!(await run(() => actions.rename(trimmed)))) {
            setName(project.name);
        }
    };

    return (
        <>
            {!scratch && (
                <SettingsSection>
                    <SettingsRow
                        searchId="general.name"
                        label={t('projectSettings.name')}
                        control={
                            <Input
                                className="w-64"
                                maxLength={MAX_TITLE_LENGTH}
                                aria-label={t('projectName.label')}
                                value={name}
                                disabled={busy}
                                onChange={(event) => setName(event.target.value)}
                                onBlur={() => void keepName()}
                                onKeyDown={submitOnEnter(() => void keepName())}
                            />
                        }
                    />
                    {/* In the shared project file, beside the name, so the whole team sees the project in it. */}
                    <SettingsRow searchId="general.color" label={t('projectSettings.color')}>
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
                    </SettingsRow>
                </SettingsSection>
            )}
            <SettingsSection title={t('common:icon.label')}>
                <SettingsRow
                    searchId="general.icon"
                    leading={
                        <ProjectGlyph
                            projectId={project.projectId}
                            endpointId={endpointId}
                            icon={project.icon}
                            color={project.color}
                            size={32}
                            scratch={scratch}
                        />
                    }
                    label={project.name}
                    description={
                        project.icon.kind === 'image'
                            ? t('projectSettings.fromFile', { file: project.icon.value })
                            : chosen
                              ? t('viewIcon.pickedHere')
                              : t('projectSettings.firstLetter')
                    }
                    control={
                        !scratch && (
                            <div className="flex items-center gap-2">
                                <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                                    <Icon icon={ImageUp} size={12} /> {t('projectSettings.chooseImage')}
                                </Button>
                                <Button size="sm" disabled={busy} onClick={() => void run(actions.useFolderIcon)}>
                                    <Icon icon={FolderSearch} size={12} /> {t('projectSettings.useFolderIcon')}
                                </Button>
                            </div>
                        )
                    }
                />
                <SettingsRow
                    searchId="general.symbol"
                    label={t('common:icon.symbol')}
                    control={
                        <IconPicker
                            hideLabel
                            icons={iconGroups}
                            keywords={PROJECT_ICON_KEYWORDS}
                            rows={7}
                            value={chosen?.value ?? null}
                            disabled={busy}
                            label={t('common:icon.symbol')}
                            onValueChange={(icon) => void run(() => actions.setChosenIcon({ kind: 'lucide', value: icon as ProjectIconChoice['value'] }))}
                            onClear={() => void run(actions.clearChosenIcon)}
                        />
                    }
                />
            </SettingsSection>
            {failure && <FormError className="break-words">{failure}</FormError>}
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
        </>
    );
}
