import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { useContributions } from '@/extensions/registry';

export function extensionVoiceActions(): ActionHandlers<void> {
    return {
        'extension.voiceList': async () => ({
            output: {
                actions: useContributions
                    .getState()
                    .voiceActions.map((action) => ({ id: action.id, description: action.description, parameters: JSON.stringify(action.parameters) }))
            }
        }),
        'extension.voiceRun': async ({ id, input }) => {
            const action = useContributions.getState().voiceActions.find((each) => each.id === id);

            if (action === undefined) {
                throw new ActionRefusal('not_found', `No extension action ${id}`);
            }

            return { output: { text: await action.run(JSON.parse(input)) } };
        }
    };
}
