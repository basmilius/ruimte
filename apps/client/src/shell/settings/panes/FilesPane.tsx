import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Stepper, Toggle } from '@/shell/settings/controls';
import { FILES_TAB_LIMIT_RANGE, useSettings } from '@/state/settings';

/* What the Files panel shows and how many files it keeps open. */
export function FilesPane() {
    const filesTabLimit = useSettings((s) => s.filesTabLimit);
    const filesShowHidden = useSettings((s) => s.filesShowHidden);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection title="Files" description="The tree next to the canvas and the viewer beside it.">
            <SettingsRow
                label="Open files"
                description="Past this many, the oldest tab you did not pin closes. Double-click a tab to pin it."
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
                description="Dotfiles and dot folders in the tree. The eye button in the panel sets the same thing."
                control={<Toggle checked={filesShowHidden} onChange={(checked) => update({ filesShowHidden: checked })} label="Show hidden files" />}
            />
            <SettingsRow
                label="Start browsing in"
                description="Where the command palette opens when you browse for a folder. One folder for every machine; a machine that does not have it starts in its home, and so does an empty field."
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
    );
}
