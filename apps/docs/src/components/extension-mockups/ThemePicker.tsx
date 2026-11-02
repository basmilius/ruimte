import type { ReactNode } from 'react';
import { MockFigure } from './primitives';

/* Settings, Appearance: Ruimte's own three themes, then every theme of an extension with its thumbnail. */
export function ThemePicker() {
    return (
        <MockFigure caption="A theme of an extension sits beside System, Light and Dark, with the thumbnail its file names.">
            <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-surface p-5">
                <Choice label="System">
                    <span className="flex grow">
                        <span data-theme="light" className="grow bg-surface-raised" />
                        <span data-theme="dark" className="grow bg-surface-raised" />
                    </span>
                </Choice>
                <Choice label="Light">
                    <span data-theme="light" className="grow bg-surface-raised" />
                </Choice>
                <Choice label="Dark">
                    <span data-theme="dark" className="grow bg-surface-raised" />
                </Choice>
                <Choice label="Midnight" chosen>
                    <svg viewBox="0 0 160 100" className="h-full w-full">
                        <rect width="160" height="100" fill="#050a1f" />
                        <circle cx="130" cy="20" r="1.5" fill="#fff" />
                        <circle cx="96" cy="44" r="1" fill="#fff" />
                        <circle cx="40" cy="70" r="1.2" fill="#fff" />
                        <rect x="12" y="12" width="64" height="7" rx="3.5" fill="#24367a" />
                        <rect x="12" y="25" width="44" height="7" rx="3.5" fill="#14204d" />
                    </svg>
                </Choice>
            </div>
        </MockFigure>
    );
}

function Choice({ label, chosen = false, children }: { readonly label: string; readonly chosen?: boolean; readonly children: ReactNode }) {
    return (
        <span className="flex flex-col items-center gap-2">
            <span
                className={`flex h-16 w-26 overflow-hidden rounded-lg ${chosen ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-border-strong'}`}
            >
                {children}
            </span>
            <span className={`text-xs ${chosen ? 'text-text' : 'text-text-muted'}`}>{label}</span>
        </span>
    );
}
