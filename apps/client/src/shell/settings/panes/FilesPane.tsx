import { Folder, FolderGit2, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@adecore/ui/settings';
import { Segmented, Stepper } from '@adecore/ui';
import { WorktreeFolderRow } from '@/shell/settings/MachineSettings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { FILES_TAB_LIMIT_RANGE, useSettings } from '@/state/settings';
import { useEndpointConnection } from '@/transport/status';

/* The two panels beside the canvas, what the Files panel shows and keeps open, and how the Git panel lists what changed. */
export function FilesPane() {
    const { t } = useTranslation('settings');
    const filesTabLimit = useSettings((s) => s.filesTabLimit);
    const diffLayout = useSettings((s) => s.diffLayout);
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
                            onValueChange={(value) => update({ filesTabLimit: value })}
                        />
                    }
                />
                <SettingSwitchRow id="files.files.hidden" setting="filesShowHidden" />
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
                            onValueChange={(value) => update({ diffLayout: value })}
                        />
                    }
                />
                <SettingSwitchRow id="files.git.whitespace" setting="diffWhitespace" />
            </SettingsSection>
            <WorktreeSection />
        </>
    );
}

/* Only the app on this computer may move its machine's worktrees, so the section is about that machine alone. */
function WorktreeSection() {
    const { t } = useTranslation('settings');
    const local = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID) ?? null);
    const connection = useEndpointConnection(LOCAL_ENDPOINT_ID);

    if (local === null || !hasLocalMachine()) {
        return null;
    }

    return (
        <SettingsSection title={t('machineDialog.worktrees')} icon={FolderGit2} scope="computer">
            <WorktreeFolderRow endpoint={local} reason={connection.status === 'open' ? null : t('machineDialog.availableWhenAnswering')} />
        </SettingsSection>
    );
}
