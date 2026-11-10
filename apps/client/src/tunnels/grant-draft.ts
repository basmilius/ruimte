import type { ExternalGrant, ExternalTier, RuntimeMode } from '@ruimte/contracts';

const DAY_MS = 24 * 3_600_000;

export type Expiry = 'never' | '30' | '90' | '365';

export interface GrantDraft {
    tier: ExternalTier;
    ceiling: RuntimeMode;
    approvals: boolean;
    /* Null reaches every project, which is the default. */
    projects: string[] | null;
    expiry: Expiry;
}

export function draftOf(grant: ExternalGrant): GrantDraft {
    return { ...grant, expiry: 'never' };
}

export function expiryAt(expiry: Expiry, now: number): number | null {
    return expiry === 'never' ? null : now + Number(expiry) * DAY_MS;
}

export function grantOf(draft: GrantDraft): ExternalGrant {
    return { tier: draft.tier, ceiling: draft.ceiling, approvals: draft.approvals, projects: draft.projects };
}
