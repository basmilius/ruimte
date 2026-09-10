import type { ReactNode } from 'react';

interface SettingsSectionProps {
    title: string;
    description?: string;
    /* A small control on the header line, aligned right. */
    action?: ReactNode;
    children: ReactNode;
}

/* A titled group of rows in one card; rows divide themselves with a hairline. */
export function SettingsSection({ title, description, action, children }: SettingsSectionProps) {
    return (
        <section className="flex flex-col gap-2" aria-label={title}>
            <div className="flex items-end gap-3 px-1">
                <div className="min-w-0 grow">
                    <h3 className="text-sm font-medium text-text">{title}</h3>
                    {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
                </div>
                {action}
            </div>
            <div className="divide-y divide-border rounded-xl border border-border bg-surface">{children}</div>
        </section>
    );
}
