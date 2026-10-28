import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FileCode2, MessageSquarePlus, MousePointer2, PenLine, Send, SquareMousePointer, SwatchBook, Trash2 } from 'lucide-react';
import type { ChatAttachmentUpload, FsEntry } from '@ruimte/contracts';
import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import { Button, EmptyState, Icon, Menu, PromptDialog, Segmented, Separator, ZoomControls } from '@adecore/ui';
import { perform } from '@/actions/client-actions';
import { DesignCommentPopover } from '@/design/DesignCommentPopover';
import { DesignDrawLayer } from '@/design/DesignDrawLayer';
import { DesignEditPanel } from '@/design/DesignEditPanel';
import { DesignTweaks } from '@/design/DesignTweaks';
import { useDesignChat } from '@/design/design-chat';
import { editsCss, editsOf, withEdits, withTweakValues, type DesignEdits } from '@/design/design-file';
import { bakePrompt, commentsPrompt, drawPrompt, textEditPrompt, type DesignComment } from '@/design/design-messages';
import { changeReaches, designFiles, pageMtime, pageName, pagesByChange } from '@/design/design-page';
import {
    DESIGN_METHODS,
    designMessage,
    designPageMessage,
    tweaksOf,
    type DesignCamera,
    type DesignElement,
    type DesignTool,
    type DesignZoom,
    type Tweaks,
    type TweakValue
} from '@/design/design-protocol';
import { runtimeAssets } from '@/design/design-inline';
import { listDesignFolder, readDesignAsset, readDesignPage, rewriteDesignFile } from '@/design/design-read';
import { useFolderWatch } from '@/state/fs-watch';
import { useToasts } from '@/state/toasts';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';

const TOOL_ICONS = { view: MousePointer2, comment: MessageSquarePlus, edit: SquareMousePointer, draw: PenLine } as const;

/* The comments waiting to be sent, as the numbered pins the page draws on their elements. */
function pinsOf(comments: readonly DesignComment[]): { selector: string; number: number }[] {
    return comments.map((comment, index) => ({ selector: comment.element.selector, number: index + 1 }));
}

/*
 * The tweaks of a page that opened again: a value a person set and did not save stays over what the
 * page declares, as long as the page still declares that tweak with a value of its kind.
 */
function heldTweakValues(declared: Tweaks | null, held: Readonly<Record<string, TweakValue>>): { values: Record<string, TweakValue>; changed: boolean } {
    if (declared === null) {
        return { values: {}, changed: false };
    }

    let changed = false;

    const values = Object.fromEntries(
        Object.entries(declared).map(([name, tweak]) => {
            const value = held[name];

            if (value === undefined || typeof value !== typeof tweak.value) {
                return [name, tweak.value];
            }

            changed ||= value !== tweak.value;

            return [name, value];
        })
    );

    return { values, changed };
}

/* One reader per page: the frame opens its bridge again for every new one, so a fresh one each render never finishes loading. */
function usePageReader(endpointId: string, folder: string, file: string | null): (() => Promise<string>) | null {
    return useMemo(() => (file === null ? null : () => readDesignPage(endpointId, folder, file)), [endpointId, folder, file]);
}

interface StageProps {
    designId: string;
    chatId: string;
    folder: string;
    watched: string;
    /* The one page a card on a canvas shows, which offers no other; absent, the bar picks among them all. */
    pinned?: string;
}

/*
 * The pages of the folder over one sandboxed frame, the frame the visuals of a chat run in, with the
 * runtime of the page drawing the canvas, the outlines and the pins. A write in the folder reads the
 * list again and a write of the page in front opens it again, with the camera a person left it at and
 * the tweaks and edits not saved yet. What the tools
 * gather goes to the chat in front as an ordinary message; only Edit and Tweaks write the file.
 */
export function DesignStage({ designId, chatId, folder, watched, pinned }: StageProps) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const transport = useTransport();
    const [entries, setEntries] = useState<FsEntry[] | null>(null);
    const [listed, setListed] = useState(false);
    const shownPage = useDesignChat((state) => state.pages[designId] ?? null);
    const chosen = pinned ?? shownPage;
    const showPage = useDesignChat((state) => state.showPage);
    const [version, setVersion] = useState(0);
    const [reloads, setReloads] = useState(0);
    const [tool, setTool] = useState<DesignTool>('view');
    const [zoom, setZoom] = useState(1);
    const [canvas, setCanvas] = useState(false);
    const [tweaks, setTweaks] = useState<Tweaks | null>(null);
    const [values, setValues] = useState<Record<string, TweakValue>>({});
    const [picked, setPicked] = useState<DesignElement | null>(null);
    const [comments, setComments] = useState<DesignComment[]>([]);
    const [edits, setEdits] = useState<DesignEdits>({});
    const [heldFor, setHeldFor] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const frameBox = useRef<HTMLDivElement>(null);
    // Per page and for as long as the view is open: a person's place on the canvas is no one else's business.
    const cameras = useRef(new Map<string, DesignCamera>());
    const located = useRef<((elements: DesignElement[]) => void) | null>(null);
    const assets = useRef<{ opened: string; read: (path: string) => Promise<Blob | null> } | null>(null);

    const files = entries === null ? null : designFiles(entries);
    const found = entries !== null;

    // The folder may not be there yet, so the project's watch is the one that sees the chat make it.
    useFolderWatch(endpointId, watched);

    useEffect(() => {
        let current = true;

        void listDesignFolder(endpointId, folder).then((found) => {
            if (current) {
                setEntries(found);
                setListed(true);
            }
        });

        return () => {
            current = false;
        };
    }, [endpointId, folder, version]);

    useEffect(
        () =>
            transport.on('fs.changed', (payload) => {
                if (payload.paths.some((changed) => changeReaches(changed, folder, found))) {
                    setVersion((previous) => previous + 1);
                }
            }),
        [transport, folder, found]
    );

    // A pinned page that went shows nothing rather than another page under its card; without a choice the page last worked on opens.
    const latest = entries === null ? null : (pagesByChange(entries)[0] ?? null);
    const active = chosen !== null && files?.includes(chosen) ? chosen : pinned === undefined ? latest : null;
    const mtime = active === null || entries === null ? null : pageMtime(entries, active);
    const page = usePageReader(endpointId, folder, active);
    const opened = `${active}:${mtime}:${reloads}`;

    // What a person tweaked or edited and did not save belongs to the page it was done on.
    if (heldFor !== active) {
        setHeldFor(active);
        setValues({});
        setEdits({});
    }

    // The bar of the view acts on the page the stage shows, also when no person picked one.
    useEffect(() => {
        if (pinned === undefined && listed) {
            showPage(designId, active);
        }
    }, [pinned, listed, designId, active, showPage]);

    const frameWindow = (): Window | null => frameBox.current?.querySelector('iframe')?.contentWindow ?? null;

    const send = (method: (typeof DESIGN_METHODS)[keyof typeof DESIGN_METHODS], params?: object): void => {
        frameWindow()?.postMessage(designMessage(method, params), '*');
    };

    const failed = (error: unknown): void => {
        useToasts.getState().show({ kind: 'error', title: t('design.failedAction'), description: error instanceof Error ? error.message : String(error) });
    };

    const tell = async (prompt: string, attachments?: ChatAttachmentUpload[]): Promise<boolean> => {
        try {
            await perform('chat.send', { chatId, prompt, ...(attachments === undefined ? {} : { attachments }) });
            return true;
        } catch (error) {
            failed(error);
            return false;
        }
    };

    // Read at every message, so the listener always acts on the page, tool and chat of this render.
    const onPageMessage = useEffectEvent((event: MessageEvent): void => {
        const frame = frameWindow();

        if (frame === null || event.source !== frame || active === null) {
            return;
        }

        const message = designPageMessage(event.data);

        if (message === null) {
            return;
        }

        switch (message.method) {
            case DESIGN_METHODS.ready: {
                const declared = tweaksOf(message.params.tweaks);
                const kept = cameras.current.get(active);
                const held = heldTweakValues(declared, values);
                setCanvas(message.params.canvas);
                setTweaks(declared);
                setValues(held.values);
                setPicked(null);
                // A page drawn again knows nothing yet: the tool, the pins, what a person changed and did not save, and the camera go to it once more.
                frame.postMessage(designMessage(DESIGN_METHODS.tool, { tool }), '*');
                frame.postMessage(designMessage(DESIGN_METHODS.pins, { pins: pinsOf(comments) }), '*');
                if (held.changed) {
                    frame.postMessage(designMessage(DESIGN_METHODS.tweaks, { values: held.values }), '*');
                }
                for (const [selector, styles] of Object.entries(edits)) {
                    frame.postMessage(designMessage(DESIGN_METHODS.style, { selector, styles }), '*');
                }
                if (kept !== undefined && message.params.canvas) {
                    frame.postMessage(designMessage(DESIGN_METHODS.camera, kept), '*');
                    setZoom(kept.zoom);
                }
                return;
            }
            case DESIGN_METHODS.camera:
                cameras.current.set(active, message.params);
                setZoom(message.params.zoom);
                return;
            case DESIGN_METHODS.pick:
                setPicked(message.params.element);
                return;
            case DESIGN_METHODS.text:
                void tell(textEditPrompt(active, message.params.element, message.params.before, message.params.after));
                return;
            case DESIGN_METHODS.located:
                located.current?.(message.params.elements);
                located.current = null;
                return;
            case DESIGN_METHODS.asset: {
                const { path } = message.params;

                // Bounded per page the frame opened, which may ask as often as it likes.
                if (assets.current?.opened !== opened) {
                    assets.current = { opened, read: runtimeAssets((file) => readDesignAsset(endpointId, folder, file)) };
                }

                void assets.current.read(path).then((bytes) => frame.postMessage(designMessage(DESIGN_METHODS.asset, { path, bytes }), '*'));
                return;
            }
        }
    });

    useEffect(() => {
        const listen = (event: MessageEvent): void => onPageMessage(event);

        window.addEventListener('message', listen);

        return () => window.removeEventListener('message', listen);
    }, []);

    useEffect(() => {
        send(DESIGN_METHODS.pins, { pins: pinsOf(comments) });
    }, [comments]);

    const pickTool = (next: DesignTool): void => {
        setTool(next);
        setPicked(null);
        send(DESIGN_METHODS.tool, { tool: next });
    };

    const zoomTo = (next: DesignZoom): void => send(DESIGN_METHODS.zoom, next);

    const dismiss = (): void => {
        setPicked(null);
        send(DESIGN_METHODS.clear);
    };

    const sendComments = async (): Promise<void> => {
        if (active !== null && comments.length > 0 && (await tell(commentsPrompt(active, comments)))) {
            setComments([]);
        }
    };

    const saveEdits = async (): Promise<void> => {
        if (active === null) {
            return;
        }

        try {
            await rewriteDesignFile(endpointId, folder, active, (html) => withEdits(html, edits));
            setEdits({});
        } catch (error) {
            failed(error);
        }
    };

    const discardEdits = (): void => {
        setEdits({});
        dismiss();
        setReloads((previous) => previous + 1);
    };

    const bake = async (): Promise<void> => {
        if (active === null) {
            return;
        }

        try {
            const read = await transport.request('fs.read', { path: `${folder}/${active}` });
            const css = read.kind === 'text' ? editsCss(editsOf(read.text)) : '';

            if (css !== '') {
                await tell(bakePrompt(active, css));
            }
        } catch (error) {
            failed(error);
        }
    };

    const saveTweaks = async (): Promise<void> => {
        if (active === null) {
            return;
        }

        try {
            await rewriteDesignFile(endpointId, folder, active, (html) => withTweakValues(html, values));
        } catch (error) {
            failed(error);
        }
    };

    const locate = (rect: { x: number; y: number; width: number; height: number }): Promise<DesignElement[]> =>
        new Promise((resolve) => {
            located.current = resolve;
            send(DESIGN_METHODS.locate, rect);
            // A page that does not answer still lets the drawing go, about nothing in particular.
            window.setTimeout(() => {
                if (located.current === resolve) {
                    located.current = null;
                    resolve([]);
                }
            }, 800);
        });

    const sendDrawing = async (image: ChatAttachmentUpload, rect: { x: number; y: number; width: number; height: number }, note: string): Promise<boolean> =>
        active !== null && tell(drawPrompt(active, await locate(rect), note), [image]);

    // The listing reads again once the page went, and the stage moves on to the page last worked on.
    const deletePage = async (): Promise<void> => {
        if (deleting === null) {
            return;
        }

        setDeleteBusy(true);
        try {
            await perform('file.delete', { paths: [`${folder}/${deleting}`] });
            setDeleting(null);
        } catch (error) {
            failed(error);
        } finally {
            setDeleteBusy(false);
        }
    };

    if (!listed) {
        return (
            <EmptyState busy className="grow">
                {t('design.loading')}
            </EmptyState>
        );
    }

    if (files === null || files.length === 0 || active === null || page === null) {
        return (
            <EmptyState icon={SwatchBook} className="grow">
                {t('design.empty')}
            </EmptyState>
        );
    }

    return (
        <div className="flex min-h-0 grow flex-col">
            {/* Built like the bar of a cell, so its last control stands under the cell's own. */}
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface bg-clip-padding pr-1.5 pl-2 text-xs">
                {pinned === undefined && (
                    // Drawn like a switcher, with a row of its own per page so each carries its delete beside it.
                    <Menu.Root>
                        <Menu.Trigger aria-label={`${t('design.pages')}: ${pageName(active)}`} className="project-switcher-trigger">
                            <Icon icon={FileCode2} size={14} className="shrink-0 text-text-muted" />
                            <span className="truncate text-sm font-medium text-text">{pageName(active)}</span>
                            <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
                        </Menu.Trigger>
                        <Menu.Popup className="min-w-60">
                            {files.map((file) => (
                                <Menu.Row key={file} aria-label={pageName(file)}>
                                    <Menu.Item className="min-w-0" label={pageName(file)} onClick={() => showPage(designId, file)}>
                                        <Icon icon={FileCode2} size={14} className="shrink-0 text-text-muted" />
                                        <span className="min-w-0 truncate">{pageName(file)}</span>
                                    </Menu.Item>
                                    <Menu.RowAction
                                        icon={Trash2}
                                        label={t('design.deletePage.action', { name: pageName(file) })}
                                        onClick={() => setDeleting(file)}
                                    />
                                </Menu.Row>
                            ))}
                        </Menu.Popup>
                    </Menu.Root>
                )}
                {comments.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => void sendComments()}>
                        <Icon icon={Send} size={14} />
                        {t('design.comment.sendAll', { count: comments.length })}
                    </Button>
                )}
                <span className="grow" />
                <Segmented<DesignTool>
                    iconOnly
                    size="sm"
                    label={t('design.tools.label')}
                    value={tool}
                    onValueChange={pickTool}
                    options={(Object.keys(TOOL_ICONS) as DesignTool[]).map((id) => ({ id, label: t(`design.tools.${id}`), icon: TOOL_ICONS[id] }))}
                />
                <DesignTweaks
                    tweaks={tweaks}
                    values={values}
                    onChange={(name, value) => {
                        const next = { ...values, [name]: value };
                        setValues(next);
                        send(DESIGN_METHODS.tweaks, { values: next });
                    }}
                    onSave={() => void saveTweaks()}
                />
                {canvas && (
                    <>
                        <Separator />
                        <ZoomControls
                            size="sm"
                            side="bottom"
                            zoom={zoom}
                            onZoomChange={(next) => zoomTo({ action: 'set', zoom: next })}
                            onFitAll={() => zoomTo({ action: 'fit' })}
                        />
                    </>
                )}
            </div>
            <div ref={frameBox} className="relative min-h-0 grow overflow-hidden">
                {/* Keyed on the page and when it was written: the frame takes a page only as it opens, so another page or a write of this one opens it again, and nothing else in the folder does. */}
                <VisualPageFrame key={opened} page={page} title={active} fill />
                {tool === 'comment' && picked !== null && (
                    <DesignCommentPopover
                        element={picked}
                        onCancel={dismiss}
                        onQueue={(text) => {
                            setComments((previous) => [...previous, { element: picked, text }]);
                            dismiss();
                        }}
                    />
                )}
                {tool === 'edit' && (
                    <DesignEditPanel
                        element={picked}
                        pending={Object.keys(edits).length > 0}
                        onStyle={(property, value) => {
                            if (picked === null) {
                                return;
                            }
                            setEdits((previous) => ({ ...previous, [picked.selector]: { ...previous[picked.selector], [property]: value } }));
                            send(DESIGN_METHODS.style, { selector: picked.selector, styles: { [property]: value } });
                        }}
                        onSave={() => void saveEdits()}
                        onDiscard={discardEdits}
                        onBake={() => void bake()}
                    />
                )}
                {tool === 'draw' && <DesignDrawLayer onSend={sendDrawing} />}
            </div>
            <PromptDialog
                open={deleting !== null}
                title={t('design.deletePage.title', { name: deleting === null ? '' : pageName(deleting) })}
                description={t('design.deletePage.description')}
                confirmLabel={t('design.deletePage.confirm')}
                danger
                busy={deleteBusy}
                onConfirm={() => void deletePage()}
                onOpenChange={() => setDeleting(null)}
            />
        </div>
    );
}
