'use client';

import { Segmented, Switch } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { SettingsFrame } from './SettingsFrame.tsx';

/* The words of `settings.agents.*` in the client. */
const ROWS = [
    { label: 'Agents may delete any view or node', description: 'When off, an agent deletes only the views and nodes it created.', on: false },
    { label: 'Agents may reach all open projects', description: 'Agents in one project can read your other open projects and start agents there.', on: false },
    {
        label: 'Continue after a usage limit',
        description: 'A chat stopped by a usage limit continues once it resets. A turn that failed on an overloaded model tries again later.',
        on: true
    }
] as const;

/* The settings dialog of `@adecore/ui/settings` on the Agents section, with ADE CORE's own rows and switches. */
export function SettingsAgents() {
    return (
        <SettingsFrame
            active="Agents"
            description="What new agents start with and what they may do."
            label="The Settings dialog on Agents. The navigation lists General, Appearance and Keyboard, then Workspace and AI sections. The pane shows Short texts, with a Text model choice between Automatic and Choose, and What agents may do, with three switches."
        >
            <SettingsSection title="Short texts">
                <SettingsRow
                    label="Text model"
                    description="Writes new chat titles, commit messages and conflict proposals on this machine. Automatic leaves the choice to Ruimte. Editor AI has its own model."
                    control={
                        <Segmented
                            value="automatic"
                            options={[
                                { id: 'automatic', label: 'Automatic' },
                                { id: 'custom', label: 'Choose' }
                            ]}
                            label="Text model"
                            onValueChange={() => undefined}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title="What agents may do" description="Saved per machine. Applies to every device connected to it.">
                {ROWS.map((row) => (
                    <SettingsRow
                        key={row.label}
                        label={row.label}
                        description={row.description}
                        control={<Switch checked={row.on} onCheckedChange={() => undefined} label={row.label} />}
                    />
                ))}
            </SettingsSection>
        </SettingsFrame>
    );
}
