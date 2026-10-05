import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Spinner, Tooltip } from '@adecore/ui';

/* An agent in the middle of a turn, or in gray one between turns whose sub-agents go on. `plain` drops the tooltip for a row that already names itself. */
export function WorkingMark({ delegating = false, plain = false }: { delegating?: boolean; plain?: boolean }) {
    const { t } = useTranslation('canvas');
    const label = t(delegating ? 'status.delegating' : 'status.running');
    const mark = <Spinner size={12} label={label} className={clsx('shrink-0', delegating ? 'text-text-faint' : 'text-status-running')} />;
    return plain ? mark : <Tooltip label={label}>{mark}</Tooltip>;
}
