import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';

/* How the Git panel lists what changed. */
export function GitPane() {
    const gitTree = useSettings((s) => s.gitTree);
    const diffLayout = useSettings((s) => s.diffLayout);
    const diffWhitespace = useSettings((s) => s.diffWhitespace);
    const update = useSettings((s) => s.update);

    return (
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
    );
}
