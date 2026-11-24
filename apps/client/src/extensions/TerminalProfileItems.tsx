import { Icon, Menu } from '@adecore/ui';
import { terminalProfileIcon, useTerminalProfiles, type TerminalProfilePlace } from '@/extensions/terminal-profiles';

/* A row per terminal profile, in a menu that adds to a canvas. */
export function TerminalProfileItems({ place }: { place: () => TerminalProfilePlace }) {
    const { profiles, open } = useTerminalProfiles();

    return (
        <>
            {profiles.map((profile) => (
                <Menu.Item key={`${profile.extension}:${profile.id}`} onClick={() => open(profile, place())}>
                    <Icon icon={terminalProfileIcon(profile)} size={14} /> {profile.title}
                </Menu.Item>
            ))}
        </>
    );
}
