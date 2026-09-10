import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';

/* How the Git panel lists what changed. */
export function GitPane() {
    const gitTree = useSettings((s) => s.gitTree);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection title="Git" description="The status list next to the canvas.">
            <SettingsRow
                label="Group changes by folder"
                description="Every status group is a tree of the folders its files sit in, which folds up. Off lists the files flat, each with its own path."
                control={<Toggle checked={gitTree} onChange={(checked) => update({ gitTree: checked })} label="Group changes by folder" />}
            />
        </SettingsSection>
    );
}
