import { EndpointsSection } from '@/shell/settings/EndpointsSection';

/* This machine first, then the machines that were added to this client. The section owns naming,
   pairing and forgetting, so the pane only puts it on screen. */
export function MachinesPane() {
    return <EndpointsSection />;
}
