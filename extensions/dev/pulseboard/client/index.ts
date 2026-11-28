import { defineCommand, defineSidebarCard, defineView, defineVoiceAction, getServer, onEvent, storage } from '@ruimte/extension/client';
import type { PulseboardServer } from '../server/index';

// Turns that ended while this computer had Ruimte open, in `computer` storage, where the view reads it.
const FINISHED = 'finished';

const view = defineView({ id: 'activity', title: 'Pulseboard', icon: 'activity', component: () => import('./ActivityView') });

defineSidebarCard({ id: 'now', title: 'Pulseboard', component: () => import('./NowCard') });
defineCommand({ id: 'open', title: 'Pulseboard: open the activity', run: () => view.open() });

onEvent('chat.turnFinished', () => void storage.set(FINISHED, (storage.get<number>(FINISHED) ?? 0) + 1));

defineVoiceAction({
    id: 'activity',
    description: 'Says how many turns the agents of this machine started, and how many ended while this computer watched',
    run: async () => {
        const finished = storage.get<number>(FINISHED) ?? 0;
        const counts = await getServer<PulseboardServer>().counts();

        if (!counts.ok) {
            return `${finished} turns ended here. The machine could not say how many it started.`;
        }

        return `The machine started ${counts.value.chats} turns in chats and ${counts.value.terminals} in terminals. ${finished} ended while this computer watched.`;
    }
});
