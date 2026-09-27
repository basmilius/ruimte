import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { useToasts, type Toast } from '@/state/toasts';
import { Button, Icon, Toasts as ToastStack } from '@basmilius/react-ui';

/* Nothing else in the app copies text, so the button says whether it worked instead of a toast about a toast. */
function CopyOutput({ output }: { output: string }) {
    const { t } = useTranslation('shell');
    const [copied, setCopied] = useState(false);
    return (
        <Button
            size="sm"
            variant="secondary"
            onClick={() => {
                void navigator.clipboard.writeText(output).then(() => setCopied(true));
            }}
        >
            <Icon icon={Copy} size={12} /> {copied ? t('toasts.copied') : t('toasts.copyOutput')}
        </Button>
    );
}

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
    return <ToastStack store={useToasts} footer={footerOf} />;
}
