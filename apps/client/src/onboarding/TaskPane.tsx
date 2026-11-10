import { CloseButton, Icon, ScrollArea } from '@adecore/ui';
import clsx from 'clsx';
import { Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface TaskPaneProps {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    action?: ReactNode;
    footer: ReactNode;
    children: ReactNode;
}

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
            <ScrollArea className="grow" viewportClassName="flex flex-col gap-4.5 px-8 pt-1 pb-6">
                {children}
            </ScrollArea>
            <footer className="flex min-h-15 items-center gap-2 border-t border-border px-8 py-3.5">{footer}</footer>
        </section>
    );
}

export function TaskNote({ children }: { children: ReactNode }) {
    return (
        <p className="flex gap-2.5 rounded-[10px] bg-accent/10 px-3.5 py-3 text-xs text-text">
            <Icon icon={Info} size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>{children}</span>
        </p>
    );
}

export function RowTile({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' }) {
    return (
        <span className={clsx('grid shrink-0 place-items-center bg-surface-hover', size === 'md' ? 'size-8 rounded-lg' : 'size-7 rounded-[7px]')}>
            {children}
        </span>
    );
}
