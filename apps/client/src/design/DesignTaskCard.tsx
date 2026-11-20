import type { HostTaskRow } from '@adecore/agents-react';
import { TaskRowHead } from '@adecore/agents-react/chat/ui';
import { Button, ErrorBoundary, Icon, Menu, useMeasuredWidth } from '@adecore/ui';
import { ArrowUpRight, ChevronsUpDown, FileCode2, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { openAgentDesign } from '@/design/design-agent';
import { useDesignPages } from '@/design/design-files';
import { cardPage, pageName } from '@/design/design-page';
import { DESIGN_METHODS, designMessage, designPageMessage } from '@/design/design-protocol';
import { DesignPageFrame } from '@/design/DesignPageFrame';
import { useProject } from '@/state/project';

// The size a page is laid out at before it is scaled down to the card, 16:9 like the frame it fills.
const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 675;

function byName(one: string, other: string): number {
    return one.localeCompare(other, undefined, { numeric: true, sensitivity: 'base' });
}

/*
 * A design agent's task in its parent's thread: the row's own line, a 16:9 frame that is there from the start
 * so the thread never jumps, and the pages with the way into the design under it. The frame shows a page itself,
 * scaled and out of reach of the pointer and the keyboard, or a placeholder until a first page is written.
 */
export function DesignTaskCard({ row, agentId, folder }: { row: HostTaskRow; agentId: string; folder: string }) {
    const { t } = useTranslation('shell');
    const endpointId = row.scopeId;
    const projectFolder = useProject((state) => state.current?.folder ?? null);
    const { pages, writtenAt } = useDesignPages(endpointId, folder, projectFolder);
    const [picked, setPicked] = useState<string | null>(null);
    const newestFirst = pages ?? [];
    const names = [...newestFirst].sort(byName);
    // Only a page on disk is known, so the newest one is the page the agent may still be writing while it works.
    const inProgress = row.state === 'running' ? (newestFirst[0] ?? null) : null;
    const shown = cardPage(newestFirst, picked, row.state === 'done' ? row.item.result : null);
    const stopped = row.state === 'failed' || row.state === 'cancelled';

    const line =
        row.state === 'done'
            ? t('design.card.done', { count: names.length })
            : row.state === 'running' && inProgress !== null
              ? t('design.card.wrote', { name: pageName(inProgress) })
              : undefined;

    const open = (): void => {
        const design = { agentId, title: row.item.description, folder, watched: projectFolder ?? folder, taskId: row.item.id };

        void openAgentDesign(endpointId, row.chatId, design, { file: shown, picked: shown !== null && shown === picked }, t('design.card.gone'));
    };

    const pageIcon = (file: string): ReactNode =>
        file === inProgress ? (
            <span role="img" aria-label={t('design.card.inProgress')} className="flex shrink-0">
                <Icon icon={LoaderCircle} size={14} className="animate-spin text-accent" />
            </span>
        ) : (
            <Icon icon={FileCode2} size={14} className="shrink-0 text-text-muted" />
        );

    return (
        <div data-design-card={row.item.id} className="mb-1 flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised bg-clip-padding">
            <div className="px-3 pt-2 pb-1">
                <TaskRowHead item={row.item} task={row.task} open={row.open} onPress={row.onPress} {...(line === undefined ? {} : { line })} />
            </div>
            <div className="px-3">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-sunken bg-clip-padding">
                    {shown === null ? (
                        <PagePlaceholder />
                    ) : (
                        <ErrorBoundary label={t('design.failed')} resetKeys={[shown]}>
                            <PagePreview endpointId={endpointId} agentId={agentId} folder={folder} file={shown} writtenAt={writtenAt[shown] ?? 0} />
                        </ErrorBoundary>
                    )}
                </div>
            </div>
            <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2.5">
                {names.length === 0 && <span className="text-xs text-text-faint">{stopped ? t('design.card.stoppedEmpty') : t('design.card.firstPage')}</span>}
                {names.length === 1 && (
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-text">
                        {pageIcon(names[0]!)}
                        <span className="truncate">{pageName(names[0]!)}</span>
                    </span>
                )}
                {names.length > 1 && shown !== null && (
                    <Menu.Root>
                        <Menu.Trigger aria-label={`${t('design.card.pages')}: ${pageName(shown)}`} className="project-switcher-trigger max-w-70">
                            {pageIcon(shown)}
                            <span className="truncate text-sm text-text">{pageName(shown)}</span>
                            <Icon icon={ChevronsUpDown} size={14} className="shrink-0 text-text-muted" />
                        </Menu.Trigger>
                        <Menu.Popup side="top" className="min-w-60">
                            <Menu.RadioGroup value={shown} onValueChange={(file: string) => setPicked(file)}>
                                {names.map((file) => (
                                    <Menu.RadioItem key={file} value={file} label={pageName(file)}>
                                        {pageIcon(file)}
                                        <span className="truncate">{pageName(file)}</span>
                                    </Menu.RadioItem>
                                ))}
                            </Menu.RadioGroup>
                        </Menu.Popup>
                    </Menu.Root>
                )}
                <span className="grow" />
                {names.length > 0 && (
                    <Button size="sm" variant="secondary" data-open-design onClick={open}>
                        <Icon icon={ArrowUpRight} size={14} />
                        {t('design.card.open')}
                    </Button>
                )}
            </div>
        </div>
    );
}

/*
 * A page that is not there yet: a bar, a heading beside an image, a row of three, under a slow light. It looks
 * like no design on purpose, so nothing in it is mistaken for what the agent makes.
 */
function PagePlaceholder() {
    const block = 'block rounded-md bg-surface-active';

    return (
        <div className="design-shine absolute inset-0 flex flex-col" style={{ padding: '4% 5%', gap: '6%' }} aria-hidden>
            <div className="flex items-center gap-3">
                <span className={block} style={{ width: '11%', height: 8 }} />
                <span className="grow" />
                <span className={block} style={{ width: '5%', height: 6 }} />
                <span className={block} style={{ width: '5%', height: 6 }} />
                <span className={block} style={{ width: '5%', height: 6 }} />
            </div>
            <div className="flex min-h-0 grow" style={{ gap: '4%' }}>
                <div className="flex flex-col justify-center gap-2" style={{ width: '44%' }}>
                    <span className={block} style={{ width: '90%', height: 16 }} />
                    <span className={block} style={{ width: '68%', height: 16 }} />
                    <span className={`${block} mt-1`} style={{ width: '82%', height: 6 }} />
                    <span className={block} style={{ width: '56%', height: 6 }} />
                    <span className={`${block} mt-2`} style={{ width: '30%', height: 20 }} />
                </div>
                <span className={`${block} grow rounded-xl`} />
            </div>
            <div className="flex gap-3" style={{ height: '16%' }}>
                <span className={`${block} grow rounded-lg`} />
                <span className={`${block} grow rounded-lg`} />
                <span className={`${block} grow rounded-lg`} />
            </div>
        </div>
    );
}

/*
 * One page laid out at a desktop's width and scaled into the frame, in the sandbox a Design view draws it in. It
 * is only a look: no pointer, focus or scroll reaches it, and a board shows fitted, without its pan and zoom.
 */
function PagePreview({
    endpointId,
    agentId,
    folder,
    file,
    writtenAt
}: {
    endpointId: string;
    agentId: string;
    folder: string;
    file: string;
    writtenAt: number;
}) {
    const { t } = useTranslation('shell');
    const [measure, width] = useMeasuredWidth();
    const page = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fit = (event: MessageEvent): void => {
            const frame = page.current?.querySelector('iframe')?.contentWindow ?? null;
            const message = frame !== null && event.source === frame ? designPageMessage(event.data) : null;

            if (message?.method === DESIGN_METHODS.ready && message.params.canvas) {
                frame?.postMessage(designMessage(DESIGN_METHODS.zoom, { action: 'fit' }), '*');
            }
        };

        window.addEventListener('message', fit);

        return () => window.removeEventListener('message', fit);
    }, []);

    return (
        <div ref={measure} role="img" aria-label={t('design.card.preview', { name: pageName(file) })} className="absolute inset-0">
            <div
                ref={page}
                inert
                className="pointer-events-none absolute top-0 left-0 overflow-hidden"
                style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${width / PAGE_WIDTH})`, transformOrigin: '0 0' }}
            >
                {/* Keyed on when the page was written, since the frame takes a page only as it opens. */}
                {width > 0 && <DesignPageFrame key={`${file}:${writtenAt}`} endpointId={endpointId} designId={agentId} folder={folder} file={file} />}
            </div>
        </div>
    );
}
