import { IconButton, WorkspaceRailSeparator } from '@adecore/ui';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useFolderInRepo } from '@/controllers/git-repos';
import { useGitStatus } from '@/controllers/git-watch';
import { useRoutineList } from '@/routines/routine-list';
import { RoutinesButton } from '@/routines/RoutinesButton';
import { COMMANDS } from '@/shell/command-table';
import { useToolbarPanels, type PanelGroup } from '@/shell/panels';
import { useEndpointId } from '@/state/current-endpoint';
import { isThisMachine } from '@/state/local-machine';
import { isScratchProject, useProject } from '@/state/project';
import { useShownPanel, useUi } from '@/state/ui';

const GROUPS: readonly PanelGroup[] = ['project', 'connected', 'made', 'extensions'];

/* The panel toggles in the rail, one group under the other, and the Routines clock beside Output. A toggle
   opens its panel and closes it again, since the panel's header has no close button of its own. */
export function PanelControls() {
    const { t } = useTranslation('shell');
    const panel = useShownPanel();
    const scratch = useProject((s) => isScratchProject(s.current));
    const folder = useProject((s) => s.current?.folder ?? null);
    const entries = useToolbarPanels(scratch);
    const endpointId = useEndpointId();
    // Only a checkout of this machine is watched for the dot: a project elsewhere would hold a watch on that machine all the while.
    const candidate = entries.some((entry) => entry.kind === 'git') && isThisMachine(endpointId) ? folder : null;
    const repo = useFolderInRepo(candidate);
    /* The project folder's own checkout, which is what the panel shows first; it shares the watch the git and files panels hold. */
    const changes = useGitStatus(repo ? candidate : null)?.files.length ?? 0;

    const routinesShown = useRoutineList(endpointId) !== null;
    const groups = GROUPS.map((key) => ({ key, entries: entries.filter((entry) => entry.group === key) })).filter(
        (group) => group.entries.length > 0 || (group.key === 'made' && routinesShown)
    );

    return (
        <>
            {groups.map((group, index) => (
                <Fragment key={group.key}>
                    {index > 0 && <WorkspaceRailSeparator />}
                    {group.entries.map((entry) => {
                        const dirty = entry.kind === 'git' && changes > 0;
                        const badge = 'badge' in entry ? (entry.badge?.() ?? null) : null;

                        return (
                            <IconButton
                                key={entry.kind}
                                icon={entry.icon}
                                label={dirty ? t('panel.gitChanges', { count: changes }) : 'label' in entry ? entry.label() : t(`panel.names.${entry.kind}`)}
                                tooltipSide="left"
                                active={panel.open && panel.kind === entry.kind}
                                className={dirty || badge !== null ? 'relative' : undefined}
                                onClick={() => useUi.getState().togglePanel(entry.kind)}
                            >
                                {/* Gray as the unsaved dot is: it says there is something to commit, not that something is wrong. */}
                                {badge !== null && (
                                    <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs text-accent-text"
                                    >
                                        {badge}
                                    </span>
                                )}
                                {dirty && (
                                    <span aria-hidden="true" className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-text-faint" />
                                )}
                            </IconButton>
                        );
                    })}
                    {group.key === 'made' && <RoutinesButton shortcut={COMMANDS.routines.shortcut} />}
                </Fragment>
            ))}
        </>
    );
}
