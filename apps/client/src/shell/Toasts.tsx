import { useTranslation } from 'react-i18next';
import { useToasts, type Toast } from '@/state/toasts';
import { CopyButton, Toasts as ToastStack } from '@adecore/ui';

/* Keep copy feedback on this button rather than opening another toast. */
function CopyOutput({ output }: { output: string }) {
    const { t } = useTranslation('shell');
    return <CopyButton text={output} label={t('toasts.copyOutput')} showLabel size="sm" variant="secondary" />;
}

// The stack subscribes to the store itself; under its hook name the React Compiler would refuse to hand it on.
const toastStore = useToasts;

function footerOf(toast: Toast) {
    if (toast.output === undefined || toast.output === '') {
        return null;
    }
    return (
        <div className="mt-1 flex">
            <CopyOutput output={toast.output} />
        </div>
    );
}

/*
 * A failure of a git action carries the output of the command that failed. Anything an agent has to
 * say about a view is not here but in the banner over the views, where a person looks for a decision.
 */
export function Toasts() {
    // The stack sits outside the workspace, so it steps left of the rail (48 pixels) by looking for it.
    return <ToastStack store={toastStore} footer={footerOf} className="[body:has(.ade-workspace[data-rail])_&]:right-16" />;
}
