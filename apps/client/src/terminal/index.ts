import { useEndpoints } from '@/state/endpoints';
import { useSessions } from '@/state/sessions';
import { transport } from '@/transport';
import { SessionClient } from '@/terminal/session-client';

export const sessionClient = new SessionClient(transport, useSessions.getState(), () => useEndpoints.getState().activeId);
