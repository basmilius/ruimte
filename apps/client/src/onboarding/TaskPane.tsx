import type { ReactNode } from 'react';
import { Info, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CloseButton, Icon } from '@adecore/ui';

interface TaskPaneProps {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    /* A control on the header line, before the close button. */
    action?: ReactNode;
    /* The bar under the task: a note on the left, its buttons on the right. */
    footer: ReactNode;
    children: ReactNode;
}

/* The right side of the list: one task with its header, what it asks, and how to go on. */
export function TaskPane({ icon, title, subtitle, action, footer, children }: TaskPaneProps) {
    const { t } = useTranslation('common');
    return (
        <section className="flex min-w-0 grow flex-col" aria-label={title}>
            <header className="flex items-center gap-3.5 px-8 pt-5.5 pb-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-surface-hover text-text">
                    <Icon icon={icon} size={20} />
                </span>
                <div className="min-w-0 grow">
                    <h3 className="text-lg font-semibold text-text">{title}</h3>
                    <p className="text-xs text-text-muted">{subtitle}</p>
                </div>
                {action}
                <CloseButton label={t('action.close')} dialog />
            </header>
            <div className="flex min-h-0 grow flex-col gap-4.5 overflow-y-auto px-8 pt-1 pb-6">{children}</div>
            <footer className="flex min-h-15 items-center gap-2 border-t border-border px-8 py-3.5">{footer}</footer>
        </section>
    );
}

/* The note at the top of a task: what it is about, before what it asks. */
export function TaskNote({ children }: { children: ReactNode }) {
    return (
        <p className="flex gap-2.5 rounded-[10px] bg-accent/10 px-3.5 py-3 text-xs text-text">
            <Icon icon={Info} size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>{children}</span>
        </p>
    );
}

/* A square behind a mark at the start of a row. */
export function RowTile({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' }) {
    return (
        <span
            className={
                size === 'md'
                    ? 'grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hover'
                    : 'grid size-7 shrink-0 place-items-center rounded-[7px] bg-surface-hover'
            }
        >
            {children}
        </span>
    );
}
