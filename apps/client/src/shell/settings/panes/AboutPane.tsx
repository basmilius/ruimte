import { faArrowUpRightFromSquare } from '@fortawesome/duotone-regular-svg-icons';
import { isDesktop } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Badge, buttonClass } from '@/shell/settings/controls';
import { useServer } from '@/state/server';
import { useTransportStatus } from '@/transport/status';
import { Icon } from '@/ui/Icon';

const REACHABILITY_LABELS = {
    loopback: 'On this machine',
    lan: 'On the local network',
    tunnel: 'Through a tunnel',
    public: 'On the public internet'
} as const;

const LINKS = [
    { label: 'ruimte.app', description: 'The site, with the download and the principles.', href: 'https://ruimte.app' },
    { label: 'Source on GitHub', description: 'The code, the issues and the handoff notes.', href: 'https://github.com/basmilius/ruimte' },
    { label: 'Report a problem', description: 'A new issue with what you saw and what you expected.', href: 'https://github.com/basmilius/ruimte/issues/new' }
];

export function AboutPane() {
    const version = useServer((s) => s.version);
    const platform = useServer((s) => s.platform);
    const home = useServer((s) => s.home);
    const label = useServer((s) => s.label);
    const reachability = useServer((s) => s.reachability);
    const status = useTransportStatus();

    return (
        <>
            <SettingsSection
                title="Ruimte"
                description={isDesktop() ? 'The desktop app and the daemon it carries.' : 'The client in this browser and the daemon it talks to.'}
            >
                <SettingsRow
                    label="Version"
                    description="As the daemon reports it; the client is built from the same tag."
                    control={version ? <Badge tone="accent">{version}</Badge> : <Badge tone="muted">{status === 'open' ? 'Unknown' : 'Not connected'}</Badge>}
                />
                <SettingsRow
                    label="Machine"
                    description={reachability ? REACHABILITY_LABELS[reachability] : 'The daemon has not introduced itself yet.'}
                    control={<span className="text-[12px] text-text-muted">{label ?? (status === 'open' ? 'Unnamed' : 'Not connected')}</span>}
                />
                <SettingsRow label="Platform" control={<span className="font-mono text-[12px] text-text-muted">{platform ?? '?'}</span>} />
                <SettingsRow
                    label="Data folder"
                    description="Sessions, chats, worktrees and the project registry live here."
                    control={<span className="max-w-72 truncate font-mono text-[12px] text-text-muted">{home ?? '?'}</span>}
                />
            </SettingsSection>
            <SettingsSection title="Links">
                {LINKS.map((link) => (
                    <SettingsRow
                        key={link.href}
                        label={link.label}
                        description={link.description}
                        control={
                            <a className={buttonClass} href={link.href} target="_blank" rel="noreferrer">
                                Open <Icon icon={faArrowUpRightFromSquare} size={12} />
                            </a>
                        }
                    />
                ))}
            </SettingsSection>
        </>
    );
}
