'use client';

import { Button, IconButton, Select, Switch } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { Trash } from 'lucide-react';
import { SettingsFrame } from './SettingsFrame.tsx';

const AFTER_RESTART = [
    { value: 'back', label: 'Comes back on' },
    { value: 'off', label: 'Stays off' }
];

/* A hostname row as `shell/settings/tunnels/TunnelRows.tsx` draws it, with the words of `settings.tunnels.rows.*`. */
function Hostname({ name, what, back }: { readonly name: string; readonly what: string; readonly back: boolean }) {
    return (
        <SettingsRow
            label={name}
            description={what}
            control={
                <div className="flex items-center gap-2">
                    <Switch checked onCheckedChange={() => undefined} label={`${name} is on`} />
                    <Select
                        value={back ? 'back' : 'off'}
                        items={AFTER_RESTART}
                        variant="outlined"
                        label={`${name} after a restart`}
                        onValueChange={() => undefined}
                    />
                    <IconButton icon={Trash} label={`Remove ${name}`} onClick={() => undefined} />
                </div>
            }
        />
    );
}

/* The Tunnels section of the settings dialog with a tunnel running: the token Cloudflare accepted, the MCP guarded by a credential, a dev server with nothing in front of it on a second domain, and one client. */
export function SettingsTunnels() {
    return (
        <SettingsFrame
            active="Tunnels"
            description="Reach Ruimte's MCP and your dev servers from outside."
            height={1160}
            label="The Settings dialog on Tunnels. A Cloudflare API token that Cloudflare accepts, reaching 2 domains, with a button to remove it. Under Hostnames, the tunnel ruimte-studio, one hostname on bmnw.nl for the MCP that a credential guards and one on passly.dev for a dev server on port 3000 that anyone with the address reaches. Under External clients, the External MCP switch is on and shows its address on this machine, and one credential, Hosted bot, is listed with a button to revoke it."
        >
            <SettingsSection title="Tunnels">
                <SettingsRow
                    label="The tunnel is running"
                    description="Cloudflare ends the encryption at its edge, so it can read everything that passes through a tunnel: prompts, file contents, credentials and the cookies of a dev site. Ruimte adds no encryption of its own on top."
                />
                <SettingsRow
                    label="Cloudflare API token"
                    description="Cloudflare accepts this token. It reaches 2 domains on Bas."
                    control={<Button onClick={() => undefined}>Remove token</Button>}
                />
            </SettingsSection>
            <SettingsSection title="Hostnames">
                <SettingsRow
                    label="Tunnel ruimte-studio"
                    description="Its hostnames show in the Cloudflare dashboard too. Ruimte only changes the records it made."
                />
                <Hostname name="mcp-4f9a1c7e2b83d605.bmnw.nl" what="Ruimte's MCP, guarded by a credential on every request" back />
                <Hostname name="shop-tunnel.passly.dev" what="Dev server on port 3000, open to anyone with the address" back={false} />
            </SettingsSection>
            <SettingsSection
                title="External clients"
                description="A credential lets a hosted client, such as a bot, operate Ruimte as you. It has no end date unless you set one. Revoke it when you stop trusting the client."
            >
                <SettingsRow
                    label="External MCP"
                    description="Listening on 127.0.0.1, port 4230. A hostname above makes it reachable from outside."
                    control={<Switch checked onCheckedChange={() => undefined} label="External MCP" />}
                />
                <SettingsRow label="Address on this machine" control={<code className="text-xs text-text-muted select-all">http://127.0.0.1:4230/mcp</code>} />
                <SettingsRow label="1 client used a credential lately" control={<Button onClick={() => undefined}>New bearer</Button>} />
                <SettingsRow
                    label="Hosted bot"
                    description="Work · all projects · agents up to supervised · OAuth · last used 3 min ago"
                    control={<IconButton icon={Trash} label="Revoke Hosted bot" tooltip="Revoke" onClick={() => undefined} />}
                />
            </SettingsSection>
        </SettingsFrame>
    );
}
