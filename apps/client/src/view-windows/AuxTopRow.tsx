import { Button, Tooltip, WorkspaceTopRow, useWindowControlsInset } from '@adecore/ui';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { STRIP_PADDING_PX, desktop, hasOverlayControls } from '@/desktop/bridge';
import { MachineGlyph } from '@/machines/MachineGlyph';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useServers } from '@/state/server';
import { projectKey } from './messages';

/*
 * An auxiliary window stays open while the window that has its project goes on to another one, so it
 * names the project its views are of. A press brings that window back with the project.
 */
export function AuxTopRow() {
    const { t } = useTranslation('shell');
    const project = useProject((s) => s.current);
    const endpointId = useProject((s) => s.currentEndpointId);
    const machine = useEndpoints((s) =>
        endpointId === null || endpointId === LOCAL_ENDPOINT_ID ? null : s.endpoints.find((entry) => entry.id === endpointId)
    );
    const machineIcon = useServers((s) => (endpointId === null ? null : (s.byEndpoint[endpointId]?.icon ?? null)));
    const inset = useWindowControlsInset();

    return (
        <WorkspaceTopRow
            className={clsx('workspace-toolbar app-drag', hasOverlayControls() && 'toolbar-overlay-inset')}
            style={{ paddingLeft: inset ?? STRIP_PADDING_PX }}
        >
            {project !== null && endpointId !== null && (
                <Tooltip label={t('viewWindows.showProject', { project: project.name })}>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="min-w-0 shrink-0"
                        onClick={() => {
                            const key = projectKey();
                            if (key !== null) {
                                desktop()?.openWindow?.(key);
                            }
                        }}
                    >
                        <ProjectGlyph projectId={project.projectId} endpointId={endpointId} icon={project.icon} color={project.color} />
                        <span className="max-w-40 truncate">{project.name}</span>
                        {machine && (
                            <span className="flex items-center text-text-faint">
                                <MachineGlyph icon={machineIcon} size={14} />
                                <span className="sr-only">{machine.label}</span>
                            </span>
                        )}
                    </Button>
                </Tooltip>
            )}
        </WorkspaceTopRow>
    );
}
