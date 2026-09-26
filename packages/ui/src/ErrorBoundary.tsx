import { Component, type ErrorInfo, type ReactNode } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { Copy, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from './Button.tsx';
import { BTN_GROUP } from './classes.ts';
import { copyText } from './clipboard.ts';
import { errorMessageOf, errorReport, shouldReset, type ResetKeys } from './error-boundary.ts';
import { Icon } from './Icon.tsx';
import { Tooltip } from './Tooltip.tsx';

interface ErrorBoundaryProps {
    /* What failed, as the first line of the message: "This view failed to render". */
    label: string;
    /* What the children draw from; the boundary tries again when one of them changes. */
    resetKeys?: ResetKeys;
    /* A node is small, so its message drops the icon and the spacing. */
    compact?: boolean;
    /* The last resort has nothing around it to fall back to, so it offers a reload as well. */
    reload?: boolean;
    /* The box of the message; by default it covers the positioned parent. */
    className?: string;
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: unknown;
    failed: boolean;
    componentStack: string | null;
}

const CLEAR: ErrorBoundaryState = { error: null, failed: false, componentStack: null };

/*
 * Keeps a render failure to the subtree it happened in. Without one React unmounts the whole tree,
 * and in the desktop shell that takes every parked `<webview>` down with it. Where they stand and
 * what resets them is in CLAUDE.md under Conventions.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = CLEAR;

    static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
        return { error, failed: true };
    }

    componentDidCatch(error: unknown, info: ErrorInfo): void {
        console.error(`${this.props.label}:`, error, info.componentStack);
        this.setState({ componentStack: info.componentStack ?? null });
    }

    componentDidUpdate(previous: ErrorBoundaryProps): void {
        if (shouldReset(this.state.failed, previous.resetKeys ?? [], this.props.resetKeys ?? [])) {
            this.reset();
        }
    }

    reset(): void {
        this.setState(CLEAR);
    }

    render(): ReactNode {
        if (!this.state.failed) {
            return this.props.children;
        }
        const { label, compact = false, reload = false, className = 'absolute inset-0' } = this.props;
        const { error, componentStack } = this.state;
        return (
            <div role="alert" className={clsx('grid place-items-center overflow-auto bg-surface', compact ? 'p-3' : 'p-6', className)}>
                <div className={clsx('flex max-w-[360px] flex-col items-center text-center', compact ? 'gap-1' : 'gap-2')}>
                    {!compact && <Icon icon={TriangleAlert} size={20} className="text-status-error" />}
                    <p className="text-sm font-medium text-text">{label}</p>
                    <p className="line-clamp-4 text-xs break-words text-text-muted">{errorMessageOf(error)}</p>
                    <div className={clsx('flex items-center gap-2', compact ? 'mt-1' : 'mt-2')}>
                        <Button variant="secondary" size="sm" onClick={() => this.reset()}>
                            {i18next.t('ui:action.retry')}
                        </Button>
                        {reload && (
                            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                                <Icon icon={RotateCw} size={14} />
                                {i18next.t('ui:action.reload')}
                            </Button>
                        )}
                        <div className={BTN_GROUP}>
                            <Tooltip label={i18next.t('ui:action.copyError')} name>
                                <button className="icon-btn icon-btn-sm" onClick={() => copyText(errorReport(label, error, componentStack))}>
                                    <Icon icon={Copy} size={14} />
                                </button>
                            </Tooltip>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
