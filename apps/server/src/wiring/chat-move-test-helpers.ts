import { ManualClock } from '@adecore/agents/testing';
import { SnoozeStore } from '../push/snoozes.ts';
import type { ChatMoveWiring } from './chat-move.ts';

export const NO_PROPOSALS: ChatMoveWiring['proposals'] = { stands: () => false, moved: () => undefined, pauseHold: () => null };

export function emptySnoozes(): SnoozeStore {
    return new SnoozeStore({ clock: new ManualClock() });
}
