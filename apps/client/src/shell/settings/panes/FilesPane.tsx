import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Stepper, Toggle } from '@/shell/settings/controls';
import { FILES_TAB_LIMIT_RANGE, useSettings } from '@/state/settings';

/* The two panels beside the canvas: what the Files panel shows and keeps open, and how the Git panel lists what changed. */
export function FilesPane() {
    const filesTabLimit = useSettings((s) => s.filesTabLimit);
    const filesShowHidden = useSettings((s) => s.filesShowHidden);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const gitTree = useSettings((s) => s.gitTree);
    const diffLayout = useSettings((s) => s.diffLayout);
    const diffWhitespace = useSettings((s) => s.diffWhitespace);
    const update = useSettings((s) => s.update);

    return (
        <>
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
            <SettingsSection title="Git" description="The status list next to the canvas.">
                <SettingsRow
                    label="Group changes by folder"
                    description="Every status group is a tree of the folders its files sit in, which folds up. Off lists the files flat, each with its own path."
                    control={<Toggle checked={gitTree} onChange={(checked) => update({ gitTree: checked })} label="Group changes by folder" />}
                />
                <SettingsRow
                    label="Diff layout"
                    description="Stacked is one patch, split puts the old and the new side by side. The diff's own toolbar sets the same thing."
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
                    description="Off asks git to ignore changes that are whitespace alone, so the counts match what the diff shows."
                    control={<Toggle checked={diffWhitespace} onChange={(checked) => update({ diffWhitespace: checked })} label="Show whitespace changes" />}
                />
            </SettingsSection>
        </>
    );
}
