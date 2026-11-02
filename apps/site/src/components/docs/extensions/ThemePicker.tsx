import type { ReactNode } from 'react';

/* Settings, Appearance as the app draws it: Ruimte's own three themes, then a theme of an extension with its thumbnail. */
export function ThemePicker() {
    return (
        <figure className="docs-figure" aria-label="The theme picker with System, Light, Dark and the extension theme Midnight, which is chosen.">
            <div aria-hidden className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-4">
                <Choice label="System">
                    <Sample side="light" half />
                    <Sample side="dark" half />
                </Choice>
                <Choice label="Light">
                    <Sample side="light" />
                </Choice>
                <Choice label="Dark">
                    <Sample side="dark" />
                </Choice>
                <Choice label="Midnight" chosen>
                    <img src="/docs/midnight-thumbnail.svg" alt="" className="h-full w-full object-cover" draggable={false} />
                </Choice>
            </div>
        </figure>
    );
}

/* A window in miniature, in the tokens of one side whatever the page is in. */
function Sample({ side, half = false }: { readonly side: 'light' | 'dark'; readonly half?: boolean }) {
    return (
        <span data-theme={side} className="flex min-w-0 grow flex-col gap-1.5 bg-surface-raised p-2.5">
            <span className={`h-1.5 rounded-full bg-surface-active ${half ? 'w-2/3' : 'w-3/5'}`} />
            <span className={`h-1.5 rounded-full bg-surface-hover ${half ? 'w-1/2' : 'w-2/5'}`} />
            {!half && <span className="mt-auto h-3 w-7 self-end rounded-full bg-accent" />}
        </span>
    );
}

function Choice({ label, chosen = false, children }: { readonly label: string; readonly chosen?: boolean; readonly children: ReactNode }) {
    return (
        <span className="flex flex-col items-center gap-2">
            <span
                className={`relative flex h-24 w-39 overflow-hidden rounded-[10px] ${chosen ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-border-strong'}`}
            >
                {children}
            </span>
            <span className={`text-[13px] ${chosen ? 'text-text' : 'text-text-muted'}`}>{label}</span>
        </span>
    );
}
