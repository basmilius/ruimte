import { useTranslation } from 'react-i18next';
import { toolbarPanels } from '@/shell/panels';
import { useFolderInRepo } from '@/state/git-repos';
import { useGitStatus } from '@/state/git-watch';
import { useEndpointId } from '@/state/keys';
import { isThisMachine } from '@/state/local-machine';
import { isScratchProject, useProject } from '@/state/project';
import { useShownPanel, useUi } from '@/state/ui';
import { IconButton } from '@adecore/ui';

/* The panel toggles. They stay in the toolbar whether a panel is open or not, so a toggle never
   moves out from under the pointer; the panel's own header carries its title and its close button
   and nothing that belongs to the toolbar. */
export function PanelControls() {
    const { t } = useTranslation('shell');
    const panel = useShownPanel();
    const scratch = useProject((s) => isScratchProject(s.current));
    const folder = useProject((s) => s.current?.folder ?? null);
    const entries = toolbarPanels(scratch);
    const endpointId = useEndpointId();
    // Only a checkout of this machine is watched for the dot: a project elsewhere would hold a watch on that machine all the while.
    const candidate = entries.some((entry) => entry.kind === 'git') && isThisMachine(endpointId) ? folder : null;
    const repo = useFolderInRepo(candidate);
    /* The project folder's own checkout, which is what the panel shows first; it shares the watch the git and files panels hold. */
    const changes = useGitStatus(repo ? candidate : null)?.files.length ?? 0;

    return (
        <>
            {entries.map((entry) => {
                const dirty = entry.kind === 'git' && changes > 0;
                return (
                    <IconButton
                        key={entry.kind}
                        icon={entry.icon}
                        label={dirty ? t('panel.gitChanges', { count: changes }) : t(`panel.names.${entry.kind}`)}
                        active={panel.open && panel.kind === entry.kind}
                        className={dirty ? 'relative' : undefined}
                        onClick={() => useUi.getState().togglePanel(entry.kind)}
                    >
                        {/* Gray as the unsaved dot is: it says there is something to commit, not that something is wrong. */}
                        {dirty && <span aria-hidden="true" className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-text-faint" />}
                    </IconButton>
                );
            })}
        </>
    );
}
