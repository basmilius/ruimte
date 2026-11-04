import { Icon, Tooltip } from '@adecore/ui';
import clsx from 'clsx';
import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The camera clears unseen state, so this mark is not another button for the same action.
export function UnseenMark({ className }: { className?: string }) {
    const { t } = useTranslation();
    return (
        <Tooltip label={t('unseen')}>
            <span className={clsx('inline-flex shrink-0 items-center text-status-idle', className)}>
                <Icon icon={CircleCheck} size={12} />
            </span>
        </Tooltip>
    );
}
