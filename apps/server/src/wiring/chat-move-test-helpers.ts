import { ManualClock } from '@adecore/agents/testing';
import { SnoozeStore } from '../push/snoozes.ts';
import type { ChatMoveWiring } from './chat-move.ts';

/* A machine whose chats have no suggestion card holding them. */
export const NO_PROPOSALS: ChatMoveWiring['proposals'] = { stands: () => false, moved: () => undefined, pauseHold: () => null };

/* A machine with no snooze set yet. */
export function emptySnoozes(): SnoozeStore {
    return new SnoozeStore({ clock: new ManualClock() });
}
