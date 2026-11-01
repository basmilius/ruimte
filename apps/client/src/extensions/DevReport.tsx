import { Component, type ReactNode } from 'react';
import { sendDevLog } from '@/extensions/dev-log';

/* Hands a surface's failure on to the boundary around it, after telling that terminal. */
class DevErrorReporter extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
    override state = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    override componentDidCatch(error: Error): void {
        sendDevLog(this.props.id, 'error', [error]);
    }

    override render() {
        if (this.state.error !== null) {
            throw this.state.error;
        }

        return this.props.children;
    }
}

export function DevReport({ id, dev, children }: { id: string; dev: boolean; children: ReactNode }) {
    return dev ? <DevErrorReporter id={id}>{children}</DevErrorReporter> : children;
}
