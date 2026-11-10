import { Icon } from '@adecore/ui';
import { CircleQuestionMark } from 'lucide-react';
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useCanvas } from '@/state/canvas';
import { extensionKeyOf, useContributions } from '@/state/extension-registry';

export function ExtensionNodeBody({ id, contributionKey }: { id: string; contributionKey: string }) {
    const { t } = useTranslation('shell');
    const contribution = useContributions((state) => state.extensionNodes.find((entry) => entry.id === contributionKey));
    const extension = useCanvas((s) => s.nodes[id]?.raw?.extension);

    if (contribution === undefined) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-text-faint">
                <Icon icon={CircleQuestionMark} size={20} />
                <span className="text-sm">{t('extensions.nodeNeeds')}</span>
                <span className="font-mono text-xs">{String(extension)}</span>
            </div>
        );
    }

    return createElement(contribution.component, { nodeId: id });
}

export function ExtensionViewBody({ raw }: { raw: Record<string, unknown> }) {
    const { t } = useTranslation('shell');
    const key = extensionKeyOf(raw);
    const contribution = useContributions((state) => state.extensionViews.find((entry) => entry.id === key));

    if (contribution === undefined) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-text-faint">
                <Icon icon={CircleQuestionMark} size={20} />
                <span className="text-sm">{t('extensions.nodeNeeds')}</span>
                <span className="font-mono text-xs">{String(raw.extension)}</span>
            </div>
        );
    }

    return createElement(contribution.component, { params: raw.params });
}
