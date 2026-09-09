import { useSyncExternalStore } from 'react';
import { transport, type TransportStatus } from '@/transport';

const subscribe = (onChange: () => void): (() => void) => transport.subscribeStatus(onChange);
const read = (): TransportStatus => transport.status;

export const useTransportStatus = (): TransportStatus => useSyncExternalStore(subscribe, read);
