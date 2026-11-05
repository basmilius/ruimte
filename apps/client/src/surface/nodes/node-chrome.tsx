import { EmptyState } from '@adecore/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFileToolbarSlot } from '@/surface/panels/file-toolbar-slot';

/* What a node shows in place of its body: one line, or a title over a line of detail. */
export function NodePlate({ icon, busy, children }: { icon?: LucideIcon; busy?: boolean; children: ReactNode }) {
    return (
        <div className="grid h-full w-full place-items-center px-4">
            <EmptyState icon={icon} busy={busy}>
                <span className="flex flex-col gap-1">{children}</span>
            </EmptyState>
        </div>
    );
}

/* A node's controls in its header, the way a file node carries its own. */
export function NodeHeaderControls({ children }: { children: ReactNode }) {
    const { host } = useFileToolbarSlot();
    return host === null ? null : createPortal(children, host);
}
