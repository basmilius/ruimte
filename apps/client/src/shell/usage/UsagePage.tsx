import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useUi } from '@/state/ui';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { isInFloatingLayer } from '@/ui/floating';

const closePage = (): void => useUi.getState().setPage(null);

/* Escape leaves the page, unless a popup or a dialog is up and owns the key itself. */
const useCloseOnEscape = (): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || isInFloatingLayer(e.target)) {
                return;
            }
            e.preventDefault();
            closePage();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
};

/*
 * What both CLIs cost and how much of the plan is left, over the whole machine. It is a page and not
 * a view: a view lives in the project file, and none of this belongs to a project.
 */
export function UsagePage() {
    useCloseOnEscape();
    return (
        <div className="absolute inset-0 overflow-y-auto bg-surface">
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-4">
                <header className="flex h-12 items-center gap-3">
                    <Tooltip label="Back" kbd="Esc" name>
                        <button className="icon-btn" onClick={closePage}>
                            <Icon icon={ArrowLeft} size={16} />
                        </button>
                    </Tooltip>
                    <h1 className="text-base font-semibold">Usage</h1>
                </header>
            </div>
        </div>
    );
}
