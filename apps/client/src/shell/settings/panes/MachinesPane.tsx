import { EndpointsSection } from '@/shell/settings/EndpointsSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';

/* A thin frame around the endpoint list; the list itself owns pairing and forgetting. */
export function MachinesPane() {
    return (
        <SettingsSection
            title="Known daemons"
            description="The machines this client can talk to. Opening a project on one is what moves the work there; every machine here keeps answering while this pane is open."
        >
            <div className="px-4 py-3">
                <EndpointsSection />
            </div>
        </SettingsSection>
    );
}
