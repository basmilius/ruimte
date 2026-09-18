import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Stepper, Toggle } from '@/shell/settings/controls';
import { FILES_TAB_LIMIT_RANGE, useSettings } from '@/state/settings';

/* The two panels beside the canvas: what the Files panel shows and keeps open, and how the Git panel lists what changed. */
export function FilesPane() {
    const filesTabLimit = useSettings((s) => s.filesTabLimit);
    const filesShowHidden = useSettings((s) => s.filesShowHidden);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const diffLayout = useSettings((s) => s.diffLayout);
    const diffWhitespace = useSettings((s) => s.diffWhitespace);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title="Files">
                <SettingsRow
                    label="Open files"
                    description="Past this number, the oldest unpinned tab closes. Double-click a tab to pin it."
                    control={
                        <Stepper
                            value={filesTabLimit}
                            min={FILES_TAB_LIMIT_RANGE.min}
                            max={FILES_TAB_LIMIT_RANGE.max}
                            step={FILES_TAB_LIMIT_RANGE.step}
                            label="Open files"
                            onChange={(value) => update({ filesTabLimit: value })}
                        />
                    }
                />
                <SettingsRow
                    label="Show hidden files"
                    description="Dotfiles and dot folders."
                    control={<Toggle checked={filesShowHidden} onChange={(checked) => update({ filesShowHidden: checked })} label="Show hidden files" />}
                />
                <SettingsRow
                    label="Start browsing in"
                    description="The folder the command palette starts in when you browse. Applies to every machine. Empty or missing falls back to the home folder."
                    control={
                        <input
                            className="field w-64 font-mono text-code"
                            aria-label="Start browsing in"
                            placeholder="~/projects"
                            value={browseStartFolder}
                            spellCheck={false}
                            onChange={(e) => update({ browseStartFolder: e.target.value })}
                            onKeyDown={(e) => e.stopPropagation()}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title="Git">
                <SettingsRow
                    label="Diff layout"
                    description="Stacked shows one column. Split puts the old and new versions side by side."
                    control={
                        <Segmented
                            value={diffLayout}
                            options={[
                                { id: 'stacked', label: 'Stacked' },
                                { id: 'split', label: 'Split' }
                            ]}
                            label="Diff layout"
                            onChange={(value) => update({ diffLayout: value })}
                        />
                    }
                />
                <SettingsRow
                    label="Show whitespace changes"
                    description="Off hides changes that only touch whitespace, in the diff and in the counts."
                    control={<Toggle checked={diffWhitespace} onChange={(checked) => update({ diffWhitespace: checked })} label="Show whitespace changes" />}
                />
            </SettingsSection>
        </>
    );
}
