import { DEFAULT_EXTERNAL_CEILING, RuntimeModeSchema, type ExternalGrant, type ExternalTier, type FromMachine, type RuntimeMode } from '@ruimte/contracts';
import { knownWord } from '@/transport-api/known-word';

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

/* A ceiling of a newer machine has no row in the form, so the form starts at the default and the person sees what they approve. */
export function draftOf(grant: FromMachine<ExternalGrant>): GrantDraft {
    return { ...grant, ceiling: knownWord(RuntimeModeSchema.options, grant.ceiling) ?? DEFAULT_EXTERNAL_CEILING, expiry: 'never' };
}

export function expiryAt(expiry: Expiry, now: number): number | null {
    return expiry === 'never' ? null : now + Number(expiry) * DAY_MS;
}

export function grantOf(draft: GrantDraft): ExternalGrant {
    return { tier: draft.tier, ceiling: draft.ceiling, approvals: draft.approvals, projects: draft.projects };
}
