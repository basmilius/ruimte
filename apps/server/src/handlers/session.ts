import type { Dispatcher } from '../dispatcher.ts';

// Phase 3 fills this in with the PTY-backed session.* handlers. Until then every
// session request answers unknown-request, which is what the dispatcher does on its own.
export const registerSessionHandlers = (_dispatcher: Dispatcher): void => {};
