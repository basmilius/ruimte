import { lazyDialog } from '@adecore/ui';
import type { DialogContribution } from '@/registry/dialogs';
import { useRoutineForm } from '@/routines/form-state';
import { useRoutinesStage } from '@/state/routines-stage';

const RoutinesStage = lazyDialog(
    () => import('@/routines/RoutinesStage'),
    'RoutinesStage',
    useRoutinesStage,
    (state) => state.open
);

const RoutineFormDialog = lazyDialog(
    () => import('@/routines/RoutineFormDialog'),
    'RoutineFormDialog',
    useRoutineForm,
    (s) => s.request !== null
);

export const ROUTINE_DIALOGS: readonly DialogContribution[] = [
    { id: 'routines-stage', surface: null, component: RoutinesStage },
    { id: 'routine-form', surface: 'dialog', component: RoutineFormDialog }
];
