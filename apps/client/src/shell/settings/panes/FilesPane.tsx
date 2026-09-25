import { Folder, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Stepper, Toggle } from '@/shell/settings/controls';
import { FILES_TAB_LIMIT_RANGE, useSettings } from '@/state/settings';

/* The two panels beside the canvas, what the Files panel shows and keeps open, and how the Git panel lists what changed. */
export function FilesPane() {
    const { t } = useTranslation('settings');
    const filesTabLimit = useSettings((s) => s.filesTabLimit);
    const filesShowHidden = useSettings((s) => s.filesShowHidden);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const diffLayout = useSettings((s) => s.diffLayout);
    const diffWhitespace = useSettings((s) => s.diffWhitespace);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('files.files.title')} icon={Folder}>
                <SettingsRow
                    searchId="files.files.openFiles"
                    label={t('files.files.openFiles.label')}
                    description={t('files.files.openFiles.description')}
                    control={
                        <Stepper
                            value={filesTabLimit}
                            min={FILES_TAB_LIMIT_RANGE.min}
                            max={FILES_TAB_LIMIT_RANGE.max}
                            step={FILES_TAB_LIMIT_RANGE.step}
                            label={t('files.files.openFiles.label')}
                            onChange={(value) => update({ filesTabLimit: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="files.files.hidden"
                    label={t('files.files.hidden.label')}
                    description={t('files.files.hidden.description')}
                    control={
                        <Toggle checked={filesShowHidden} onChange={(checked) => update({ filesShowHidden: checked })} label={t('files.files.hidden.label')} />
                    }
                />
                <SettingsRow
                    searchId="files.files.browseStart"
                    label={t('files.files.browseStart.label')}
                    description={t('files.files.browseStart.description')}
                >
                    <input
                        className="field bg-surface-sunken font-mono text-code"
                        aria-label={t('files.files.browseStart.label')}
                        placeholder="~/projects"
                        value={browseStartFolder}
                        spellCheck={false}
                        onChange={(e) => update({ browseStartFolder: e.target.value })}
                        onKeyDown={(e) => e.stopPropagation()}
                    />
                </SettingsRow>
            </SettingsSection>
            <SettingsSection title={t('files.git.title')} icon={GitBranch}>
                <SettingsRow
                    searchId="files.git.layout"
                    label={t('files.git.layout.label')}
                    description={t('files.git.layout.description')}
                    control={
                        <Segmented
                            value={diffLayout}
                            options={[
                                { id: 'stacked', label: t('files.git.layout.options.stacked') },
                                { id: 'split', label: t('files.git.layout.options.split') }
                            ]}
                            label={t('files.git.layout.label')}
                            onChange={(value) => update({ diffLayout: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="files.git.whitespace"
                    label={t('files.git.whitespace.label')}
                    description={t('files.git.whitespace.description')}
                    control={
                        <Toggle checked={diffWhitespace} onChange={(checked) => update({ diffWhitespace: checked })} label={t('files.git.whitespace.label')} />
                    }
                />
            </SettingsSection>
        </>
    );
}
