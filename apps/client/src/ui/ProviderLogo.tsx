import clsx from 'clsx';
import type { UsageProvider } from '@ruimte/contracts';
import { PROVIDER_PATHS } from '@/ui/provider-paths';

interface ProviderLogoProps {
    provider: UsageProvider;
    size?: number;
    className?: string;
}

/* The 24 by 24 box both marks are drawn in, so one size renders them at the same weight. */
const VIEW_BOX = '0 0 24 24';

export function ProviderLogo({ provider, size = 14, className }: ProviderLogoProps) {
    return (
        <svg aria-hidden viewBox={VIEW_BOX} width={size} height={size} fill="currentColor" className={clsx('shrink-0', className)}>
            <path d={PROVIDER_PATHS[provider]} />
        </svg>
    );
}
