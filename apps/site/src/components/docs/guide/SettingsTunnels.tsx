'use client';

import { Button, IconButton, Pill, Switch, Table } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { MoreHorizontal } from 'lucide-react';
import { SettingsFrame } from './SettingsFrame.tsx';

/* The columns of `shell/settings/tunnels/HostnamesSection.tsx` and `CredentialsSection.tsx`. */
const HOSTNAME_COLUMNS = [{ width: 'minmax(0,3fr)' }, { width: 'minmax(0,2fr)', hideBelow: 'md' }, { width: 'auto', align: 'end' }] as const;

const CLIENT_COLUMNS = [
    { width: 'minmax(0,2fr)' },
    { width: 'auto', hideBelow: 'sm' },
    { width: 'minmax(0,2fr)', hideBelow: 'lg' },
    { width: 'auto', hideBelow: 'md' },
    { width: 'auto', align: 'end' }
] as const;

function More({ name }: { readonly name: string }) {
    return <IconButton icon={MoreHorizontal} size="sm" label={`More for ${name}`} onClick={() => undefined} />;
}

/* A hostname of Ruimte as its row draws it, with the words of `settings.tunnels.hostnames.*`. */
function Hostname({ name, target, mono = false }: { readonly name: string; readonly target: string; readonly mono?: boolean }) {
    return (
        <Table.Row>
            <Table.Cell>{name}</Table.Cell>
            <Table.Cell mono={mono}>{target}</Table.Cell>
            <Table.Cell>
                <Switch checked onCheckedChange={() => undefined} label={`${name} on`} />
                <More name={name} />
            </Table.Cell>
        </Table.Row>
    );
}

/* The Tunnels section of the settings dialog with a tunnel running: the token, the tunnel Ruimte runs, two hostnames of Ruimte and one already on the tunnel, and one client. */
export function SettingsTunnels() {
    return (
        <SettingsFrame
            active="Tunnels"
            description="Reach Ruimte's MCP and your dev servers from outside."
            height={900}
            label="The Settings dialog on Tunnels. In the Cloudflare card, the API token reaches 2 domains on Bas, with Remove, and the tunnel ruimte-studio-4f2a runs on this computer, with Stop using. Under Hostnames, with an Add hostname button, a table lists the MCP on bmnw.nl and a dev server on passly.dev that points to localhost:3000, each with a switch and a menu, and under Already on this tunnel a hostname someone else added. Under External clients, the External MCP switch is on, with a New bearer button and the address on this machine, and a table lists one client, Hosted bot."
        >
            <SettingsSection title="Cloudflare">
                <SettingsRow label="API token" description="Reaches 2 domains on Bas." control={<Button onClick={() => undefined}>Remove</Button>} />
                <SettingsRow
                    label="Tunnel"
                    description={
                        <>
                            <span className="block text-text">ruimte-studio-4f2a</span>
                            <span className="flex items-center gap-1.5">
                                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-status-running" />
                                Runs on this computer
                            </span>
                        </>
                    }
                    control={<Button onClick={() => undefined}>Stop using</Button>}
                />
            </SettingsSection>
            <SettingsSection
                title="Hostnames"
                description="Cloudflare can read all traffic through a tunnel."
                action={<Button onClick={() => undefined}>Add hostname</Button>}
            >
                <Table.Root label="Hostnames" columns={HOSTNAME_COLUMNS}>
                    <Table.Head>
                        <Table.Column>Hostname</Table.Column>
                        <Table.Column>Points to</Table.Column>
                        <Table.Column />
                    </Table.Head>
                    <Table.Group label="Ruimte">
                        <Hostname name="mcp-4f9a1c7e2b83d605.bmnw.nl" target="Ruimte MCP" />
                        <Hostname name="shop-tunnel.passly.dev" target="localhost:3000" mono />
                    </Table.Group>
                    <Table.Group label="Already on this tunnel">
                        <Table.Row muted>
                            <Table.Cell>nas.bmnw.nl</Table.Cell>
                            <Table.Cell mono>localhost:5000</Table.Cell>
                            <Table.Cell />
                        </Table.Row>
                    </Table.Group>
                </Table.Root>
            </SettingsSection>
            <SettingsSection
                title="External clients"
                description={
                    <>
                        On this machine at <code className="font-mono">http://127.0.0.1:4230/mcp</code>
                    </>
                }
                action={
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-2 text-xs text-text-muted">
                            <span aria-hidden>External MCP</span>
                            <Switch checked onCheckedChange={() => undefined} label="External MCP" />
                        </span>
                        <Button onClick={() => undefined}>New bearer</Button>
                    </div>
                }
            >
                <Table.Root label="External clients" columns={CLIENT_COLUMNS}>
                    <Table.Head>
                        <Table.Column>Client</Table.Column>
                        <Table.Column>Kind</Table.Column>
                        <Table.Column>Reach</Table.Column>
                        <Table.Column>Last used</Table.Column>
                        <Table.Column />
                    </Table.Head>
                    <Table.Row>
                        <Table.Cell>
                            <div className="min-w-0">
                                <div className="truncate">Hosted bot</div>
                                <div className="truncate text-xs text-text-muted">Expires in 28 days</div>
                            </div>
                        </Table.Cell>
                        <Table.Cell>
                            <Pill size="sm">OAuth</Pill>
                        </Table.Cell>
                        <Table.Cell>Work · 2 projects</Table.Cell>
                        <Table.Cell className="text-text-muted">3 min ago</Table.Cell>
                        <Table.Cell>
                            <More name="Hosted bot" />
                        </Table.Cell>
                    </Table.Row>
                </Table.Root>
            </SettingsSection>
        </SettingsFrame>
    );
}
