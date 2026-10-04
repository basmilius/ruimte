import { Fragment, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Lightbulb, LocateFixed, MapPin, Blocks, Type, Rows3, TextCursorInput, AlignLeft, Scissors, ClipboardPaste, Wand2 } from 'lucide-react';
import { ContextMenu, Icon, Kbd } from '@basmilius/desktop-ui';
import type { Shortcut } from '@basmilius/desktop-ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import type { EditorLanguage } from './editor-language';
import type { MenuView } from './popups';
import type { NavigationKind } from './navigation';

interface Row {
    readonly id: string;
    readonly label: string;
    readonly icon: typeof Copy;
    readonly shortcut?: Shortcut;
    run(): void;
}

/* The menu's rows in their groups, left out where no server answers the request behind one. */
function groupsOf(language: EditorLanguage, t: (key: string) => string): Row[][] {
    const { service } = language.project;
    const { uri } = language;
    const navigation = (kind: NavigationKind, method: string, label: string, icon: typeof Copy, shortcut?: Shortcut): Row[] =>
        service.supports(method, uri) ? [{ id: kind, label: t(label), icon, shortcut, run: () => void language.navigation.go(kind) }] : [];
    const go = [
        ...navigation('definition', 'textDocument/definition', 'goToDefinition', LocateFixed, CANVAS_SHORTCUTS.goToDefinition),
        ...navigation('declaration', 'textDocument/declaration', 'goToDeclaration', MapPin),
        ...navigation('typeDefinition', 'textDocument/typeDefinition', 'goToTypeDefinition', Type, CANVAS_SHORTCUTS.goToTypeDefinition),
        ...navigation('implementation', 'textDocument/implementation', 'goToImplementation', Blocks, CANVAS_SHORTCUTS.goToImplementation),
        ...(service.supports('textDocument/references', uri)
            ? [{ id: 'peek', label: t('peekReferences'), icon: Rows3, shortcut: CANVAS_SHORTCUTS.peekReferences, run: () => void language.peek.open() }]
            : [])
    ];
    const refactor = [
        ...(service.supports('textDocument/rename', uri)
            ? [{ id: 'rename', label: t('renameSymbol'), icon: TextCursorInput, shortcut: CANVAS_SHORTCUTS.rename, run: () => void language.rename.start() }]
            : []),
        ...(service.supports('textDocument/codeAction', uri)
            ? [{ id: 'actions', label: t('codeActions'), icon: Lightbulb, shortcut: CANVAS_SHORTCUTS.codeActions, run: () => void language.codeActions.open() }]
            : [])
    ];
    return [go, refactor].filter((group) => group.length > 0);
}

function Rows({ rows }: { rows: readonly Row[] }) {
    return (
        <>
            {rows.map((row) => (
                <ContextMenu.Item key={row.id} onClick={row.run}>
                    <Icon icon={row.icon} size={14} /> {row.label} {row.shortcut !== undefined && <Kbd shortcut={row.shortcut} />}
                </ContextMenu.Item>
            ))}
        </>
    );
}

/*
 * The right-click menu of the editor: where to go, what to change at the caret, the clipboard and the
 * formatter, with what the language servers do not offer left out. The menu opens at the point the
 * editor reported, through the same synthesized event the browser node's menu uses.
 */
export function EditorContextMenu({ language, view }: { language: EditorLanguage; view: MenuView }) {
    const { t } = useTranslation('shell');
    const { t: panels } = useTranslation('panels');
    const trigger = useRef<HTMLDivElement>(null);

    useEffect(() => {
        trigger.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: view.x, clientY: view.y }));
    }, [view.x, view.y]);

    const groups = groupsOf(language, (key) => t(`menu.${key}`));
    const formatting = language.project.service.supports('textDocument/formatting', language.uri);
    return (
        <ContextMenu.Root onOpenChange={(open) => !open && language.contextMenu.close()}>
            <ContextMenu.Trigger ref={trigger} className="fixed top-0 left-0 h-0 w-0" aria-hidden />
            <ContextMenu.Popup>
                {groups.map((rows, index) => (
                    <Fragment key={rows[0]!.id}>
                        {index > 0 && <ContextMenu.Separator />}
                        <Rows rows={rows} />
                        {index === 1 && view.refactors.length > 0 && (
                            <ContextMenu.SubmenuRoot>
                                <ContextMenu.SubmenuTrigger>
                                    <Icon icon={Wand2} size={14} /> {panels('language.context.refactor')}
                                </ContextMenu.SubmenuTrigger>
                                <ContextMenu.Popup className="min-w-48">
                                    {view.refactors.map((entry) => (
                                        <ContextMenu.Item key={entry.id} onClick={() => void language.codeActions.apply(entry)}>
                                            {entry.action.title}
                                        </ContextMenu.Item>
                                    ))}
                                </ContextMenu.Popup>
                            </ContextMenu.SubmenuRoot>
                        )}
                    </Fragment>
                ))}
                {groups.length > 0 && <ContextMenu.Separator />}
                <ContextMenu.Item onClick={() => language.contextMenu.clipboard('cut')}>
                    <Icon icon={Scissors} size={14} /> {panels('language.context.cut')}
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => language.contextMenu.clipboard('copy')}>
                    <Icon icon={Copy} size={14} /> {panels('language.context.copy')}
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => language.contextMenu.clipboard('paste')}>
                    <Icon icon={ClipboardPaste} size={14} /> {panels('language.context.paste')}
                </ContextMenu.Item>
                {formatting && (
                    <>
                        <ContextMenu.Separator />
                        <ContextMenu.Item onClick={() => void language.codeActions.formatDocument()}>
                            <Icon icon={AlignLeft} size={14} /> {t('menu.formatDocument')} <Kbd shortcut={CANVAS_SHORTCUTS.formatDocument} />
                        </ContextMenu.Item>
                    </>
                )}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}
