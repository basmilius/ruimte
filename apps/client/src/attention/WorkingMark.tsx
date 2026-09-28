import { useTranslation } from 'react-i18next';
import { Spinner, Tooltip } from '@basmilius/react-ui';

/* An agent in the middle of a turn. `plain` drops the tooltip for a row that already names itself. */
export function WorkingMark({ plain = false }: { plain?: boolean }) {
    const { t } = useTranslation('canvas');
    const mark = <Spinner size={12} label={t('status.running')} className="shrink-0 text-status-running" />;
    return plain ? mark : <Tooltip label={t('status.running')}>{mark}</Tooltip>;
}
