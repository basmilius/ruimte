import { EndpointsSection } from '@/shell/settings/EndpointsSection';

/* This machine first, then the machines that were added to this client, then what has access to this
   one. Those sections own naming, pairing and forgetting, so the pane only puts them on screen. */
export function MachinesPane() {
    return <EndpointsSection />;
}
