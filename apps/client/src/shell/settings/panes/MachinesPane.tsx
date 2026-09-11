import { EndpointsSection } from '@/shell/settings/EndpointsSection';

/* The machines, one under the other. The pane's own header says what they are, so nothing here
   fences the list off a second time; the list itself owns pairing, naming and forgetting. */
export function MachinesPane() {
    return <EndpointsSection />;
}
