import { Dialog, ScrollArea } from '@adecore/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { closeRoutineForm, useRoutineForm } from '@/routines/form-state';
import { useRoutineList } from '@/routines/routine-list';
import { RoutineForm } from '@/routines/RoutineForm';
import { useEndpointId } from '@/state/current-endpoint';
import { showRoutine } from '@/state/routines-stage';

/* The routine form as a dialog of the workspace: New routine, Edit, the canvas menu, the palette and a chat's Repeat. */
export function RoutineFormDialog() {
    const { t } = useTranslation('routines');
    const endpointId = useEndpointId();
    const request = useRoutineForm((s) => s.request);
    const round = useRoutineForm((s) => s.round);
    // Held here as well, so a form opened outside the stage still knows the revs a save names.
    useRoutineList(endpointId);
    // What it last showed, so the form stays in the popup while it fades out instead of emptying it at once.
    const [shown, setShown] = useState(request);
    if (request !== null && request !== shown) {
        setShown(request);
    }
    return (
        <Dialog.Root open={request !== null} onOpenChange={(open) => !open && closeRoutineForm()}>
            <Dialog.Popup className="flex max-h-[85vh] w-[480px] flex-col">
                <ScrollArea viewportClassName="flex flex-col gap-4 p-5">
                    <Dialog.Title>{shown?.editing ? t('form.editTitle') : t('form.newTitle')}</Dialog.Title>
                    {shown !== null && (
                        <RoutineForm
                            key={round}
                            endpointId={endpointId}
                            request={shown}
                            onCancel={closeRoutineForm}
                            onDone={(projectId, routineId) => {
                                closeRoutineForm();
                                showRoutine({ projectId, routineId });
                            }}
                        />
                    )}
                </ScrollArea>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
