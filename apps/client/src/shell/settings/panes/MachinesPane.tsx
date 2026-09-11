import { EndpointsSection } from '@/shell/settings/EndpointsSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';

/* A thin frame around the endpoint list; the list itself owns pairing and switching. */
export function MachinesPane() {
    return (
        <SettingsSection
            title="Known daemons"
            description="The one you pick is where projects open and the canvas runs; the others keep answering while this pane is open."
        >
            <div className="px-4 py-3">
                <EndpointsSection />
            </div>
        </SettingsSection>
    );
}
