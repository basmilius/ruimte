import { Menu } from '@base-ui-components/react/menu';
import { useTranslation } from 'react-i18next';
import { ChevronRight, GitFork } from 'lucide-react';
import { useForkIdsAfter } from '../../forks';
import { ROW_GUTTER } from '../icons';
import { chatHost } from '../../../host';
import { Icon } from '@ruimte/ui/Icon';
import { MenuPopup } from '@ruimte/ui/MenuPopup';

const LINE = '-mx-1 mb-0.5 flex h-7 items-center gap-2 rounded-md px-1 text-xs text-text-muted';
const LINK = `${LINE} hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-hover data-[popup-open]:text-text`;

/*
 * Under a turn that forks went on after, the way over to them: one fork opens at once, more open a
 * menu of them by name.
 */
export function ForksRow({ chatId, turnId }: { chatId: string; turnId: string }) {
    const { t } = useTranslation('agent-chat');
    const forks = useForkIdsAfter(chatId, turnId);
    const label = t('work.forksAfter', { count: forks.length });
    if (forks.length === 0) {
        return null;
    }
    if (forks.length === 1) {
        return <OneFork forkId={forks[0]!} label={label} />;
    }
    return (
        <div className="flex">
            <Menu.Root>
                <Menu.Trigger className={LINK}>
                    <ForksLabel label={label} />
                </Menu.Trigger>
                <MenuPopup className="min-w-48">
                    {forks.map((forkId) => (
                        <ForkItem key={forkId} forkId={forkId} />
                    ))}
                </MenuPopup>
            </Menu.Root>
        </div>
    );
}

function ForksLabel({ label, link = true }: { label: string; link?: boolean }) {
    return (
        <>
            <span className={ROW_GUTTER}>
                <Icon icon={GitFork} size={12} />
            </span>
            {label}
            {link && <Icon icon={ChevronRight} size={12} />}
        </>
    );
}

// A fork no longer in this project has nowhere to lead, so it only says it is there.
function OneFork({ forkId, label }: { forkId: string; label: string }) {
    const place = chatHost().useChatPlace(forkId);
    return (
        <div className="flex">
            {place.title === null ? (
                <span className={LINE}>
                    <ForksLabel label={label} link={false} />
                </span>
            ) : (
                <button className={LINK} onClick={place.go}>
                    <ForksLabel label={label} />
                </button>
            )}
        </div>
    );
}

function ForkItem({ forkId }: { forkId: string }) {
    const { t } = useTranslation('agent-chat');
    const place = chatHost().useChatPlace(forkId);
    return (
        <Menu.Item className="menu-item" disabled={place.title === null} onClick={place.go}>
            <Icon icon={GitFork} size={14} /> <span className="truncate">{place.title ?? t('fork.pill.label')}</span>
        </Menu.Item>
    );
}
