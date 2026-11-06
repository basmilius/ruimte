import type { BenchmarkLab } from '@ruimte/pulsar';

/* The address book's mark for a lab, in `currentColor` like `ProviderLogo`, so a new lab needs no release. */
export function LabLogo({ lab, size }: { lab: BenchmarkLab; size: number }) {
    return (
        <svg aria-hidden viewBox={lab.logo.viewBox} width={size} height={size} fill="currentColor" className="shrink-0">
            <path d={lab.logo.path} />
        </svg>
    );
}
