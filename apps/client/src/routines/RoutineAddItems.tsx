import { Icon, Menu } from '@adecore/ui';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createNodeAction } from '@/action-port/person-actions';
import type { Point } from '@/canvas-model/math';
import { openRoutineForm } from '@/routines/form-state';
import { useRoutineList } from '@/routines/routine-list';
import { useProject } from '@/state/project';
import { useMachineAnswers } from '@/transport/features';

/*
 * A routine of this project placed as a node, or a new one; without any yet, only the new one. The
 * workspace's machine, not a remote node's: a routine belongs to the project.
 */
export function RoutineAddItems({ at }: { at?: () => Point }) {
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useProject((s) => s.currentEndpointId);
    const answers = useMachineAnswers(endpointId ?? '', 'routine.list');
    if (!answers || projectId === null || endpointId === null) {
        return null;
    }
    return <RoutineItems endpointId={endpointId} projectId={projectId} at={at} />;
}

function RoutineItems({ endpointId, projectId, at }: { endpointId: string; projectId: string; at: (() => Point) | undefined }) {
    const { t } = useTranslation('canvas');
    const list = useRoutineList(endpointId);
    const entries = list?.status === 'ready' ? list.result.routines.filter((entry) => entry.projectId === projectId) : [];
    if (entries.length === 0) {
        return (
            <Menu.Item onClick={() => openRoutineForm({ projectId })}>
                <Icon icon={CalendarClock} size={14} /> {t('canvasMenu.routine')}
            </Menu.Item>
        );
    }
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                <Icon icon={CalendarClock} size={14} /> {t('canvasMenu.routines')}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-h-96 min-w-48 overflow-y-auto">
                {entries.map((entry) => (
                    <Menu.Item
                        key={entry.routine.id}
                        onClick={() =>
                            void createNodeAction('routine', {
                                routine: entry.routine.id,
                                title: entry.routine.title,
                                ...(at === undefined ? {} : { at: at() })
                            })
                        }
                    >
                        <span className="truncate">{entry.routine.title}</span>
                    </Menu.Item>
                ))}
                <Menu.Separator />
                <Menu.Item onClick={() => openRoutineForm({ projectId })}>{t('canvasMenu.newRoutine')}</Menu.Item>
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}
