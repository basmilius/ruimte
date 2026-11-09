import type { Area } from '../area.ts';
import type { ComputerUse } from '../computer/computer-use.ts';
import type { Dispatcher } from '../dispatcher.ts';

interface ComputerDeps {
    computer: ComputerUse;
}

/*
 * None of these is owner-only: the settings offer the switch for every machine a person reaches, and an
 * agent still gets nothing until that person grants Accessibility at the Mac and lets it into an app.
 */
export function computerArea(deps: ComputerDeps): Area {
    const { computer } = deps;

    return {
        name: 'computer',
        sources: [computer],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [{ phase: 'drain', label: 'Stopping computer use', run: () => computer.stop() }]
    };
}

function registerRequests(dispatcher: Dispatcher, { computer }: ComputerDeps): void {
    dispatcher.register('computer.status', () => computer.refreshStatus());

    dispatcher.register('computer.setEnabled', (payload) => computer.setEnabled(payload.enabled, payload.language));

    dispatcher.register('computer.restart', () => computer.restart());

    dispatcher.register('computer.requestGrant', (payload) => computer.requestGrant(payload.grant));

    dispatcher.register('computer.control', (payload) => computer.control(payload.action), { count: ['actions.computer'] });

    dispatcher.register('computer.setLanguage', async (payload) => {
        await computer.setLanguage(payload.language);
        return {};
    });

    dispatcher.register('computer.approvals', () => ({ approvals: computer.pendingApprovals() }));

    dispatcher.register('computer.answer', async (payload) => ({ accepted: await computer.answer(payload.requestId, payload.choice) }));

    dispatcher.register('computer.grants', () => computer.grants());

    dispatcher.register('computer.revoke', async (payload) => ({ removed: await computer.revoke(payload.bundleId, payload.kind, payload.nodeId) }));
}
