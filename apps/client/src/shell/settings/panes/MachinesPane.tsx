import { EndpointsSection } from '@/shell/settings/EndpointsSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';

/* A thin frame around the endpoint list; the list itself owns pairing and switching. */
export function MachinesPane() {
    return (
        <SettingsSection title="Known daemons" description="One daemon at a time. Switching empties the canvas and loads the other machine's projects.">
            <div className="px-4 py-3">
                <EndpointsSection />
            </div>
        </SettingsSection>
    );
}
