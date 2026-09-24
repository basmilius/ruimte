import type { ComputerUse } from '../computer/computer-use.ts';
import type { Dispatcher } from '../dispatcher.ts';

export const registerComputerHandlers = (dispatcher: Dispatcher, computer: ComputerUse): void => {
    dispatcher.register('computer.status', () => computer.refreshStatus());

    dispatcher.register('computer.setEnabled', (payload) => computer.setEnabled(payload.enabled, payload.language));

    dispatcher.register('computer.approvals', () => ({ approvals: computer.pendingApprovals() }));

    dispatcher.register('computer.answer', async (payload) => ({ accepted: await computer.answer(payload.requestId, payload.choice) }));
};
