import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ComputerGrant } from '@ruimte/contracts';
import { COMPUTER_GRANTS, setupLine, type ComputerSetup, type GrantState } from '@/computer/setup';
import { SettingsRow } from '@adecore/ui/settings';
import { Button, Pill } from '@adecore/ui';

const PHASE_DOTS: Record<ComputerSetup['phase'], string> = {
    unknown: 'bg-text-faint',
    unsupported: 'bg-text-faint',
    unavailable: 'bg-text-faint',
    off: 'bg-text-faint',
    starting: 'bg-status-needs-you',
    grants: 'bg-status-needs-you',
    ready: 'bg-status-idle'
};

/* Where the machine stands, behind a dot in the color of what it asks of you. */
export function SetupLine({ setup }: { setup: ComputerSetup }) {
    return (
        <span className="flex items-start gap-2">
            <span className="flex h-5 shrink-0 items-center">
                <span className={clsx('h-2 w-2 rounded-full', PHASE_DOTS[setup.phase])} />
            </span>
            {setupLine(setup)}
        </span>
    );
}

const GRANT_TONES = { granted: 'idle', missing: 'needsYou', unknown: 'muted' } as const;

interface GrantRowsProps {
    setup: ComputerSetup;
    // This Mac, whose System Settings the shell can open.
    local: boolean;
    busy: boolean;
    // Whether a search of the settings leads to these rows.
    searchable?: boolean;
    onOpen(grant: ComputerGrant): void;
}

/* A row per permission the helper needs, with where it stands and, on this Mac, the pane that grants it. */
export function GrantRows({ setup, local, busy, searchable = false, onOpen }: GrantRowsProps) {
    const { t } = useTranslation('settings');
    return COMPUTER_GRANTS.map((grant) => {
        const state: GrantState = setup[grant];
        return (
            <SettingsRow
                key={grant}
                searchId={searchable ? `computer.grant.${grant}` : undefined}
                label={t(`computer.grant.${grant}.label`)}
                description={t(`computer.grant.${grant}.description`)}
                control={
                    <>
                        <Pill shape="tag" tone={GRANT_TONES[state]}>
                            {t(`computer.state.${state}`)}
                        </Pill>
                        {local && state === 'missing' && (
                            <Button variant="secondary" disabled={busy} onClick={() => onOpen(grant)}>
                                {t('computer.open')}
                            </Button>
                        )}
                    </>
                }
            />
        );
    });
}
