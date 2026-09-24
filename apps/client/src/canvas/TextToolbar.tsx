import { useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Menu } from '@base-ui-components/react/menu';
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, ChevronDown, Italic, Palette, Strikethrough, Underline } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DrawingFont } from '@ruimte/contracts';
import clsx from 'clsx';
import { accentColor, accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { textRect } from '@/canvas/edge-lines';
import { FONT_STACK } from '@/canvas/text-font';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { ACCENT_SWATCH, ACCENT_SWATCH_PICKED, BTN_GROUP, FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const FONTS: readonly DrawingFont[] = ['sans', 'hand', 'mono'];

/* The same steps a drawing offers, so a label and a written word can be set to match. */
const SIZES = [16, 20, 28, 36];

/* How far above the text the bar floats, and the room it needs before it moves below instead. */
const GAP = 10;
const BAR_HEIGHT = 40;

export function TextToolbar() {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const { camera, viewport, text } = useCanvas(
        useShallow((s) => ({
            camera: s.camera,
            viewport: s.viewport,
            text: s.selection.length === 1 ? (s.texts[s.selection[0]!] ?? null) : null
        }))
    );

    const toolbarRef = useRef<HTMLDivElement>(null);
    const [toolbarWidth, setToolbarWidth] = useState(0);
    const [textHeight, setTextHeight] = useState<number | null>(null);

    useLayoutEffect(() => {
        const toolbar = toolbarRef.current;
        if (!toolbar) {
            return;
        }
        const measure = (): void => setToolbarWidth(toolbar.offsetWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(toolbar);
        return () => observer.disconnect();
    }, [text?.id]);

    useLayoutEffect(() => {
        const element = Array.from(toolbarRef.current?.parentElement?.querySelectorAll<HTMLElement>('[data-text-id]') ?? []).find(
            (element) => element.dataset.textId === text?.id
        );
        if (!element) {
            setTextHeight(null);
            return;
        }
        const measure = (): void => setTextHeight(element.offsetHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [text?.id]);

    if (text === null) {
        return null;
    }

    const style = (patch: Parameters<ReturnType<typeof canvasStore.getState>['styleText']>[1]): void => {
        canvasStore.getState().styleText(text.id, patch);
    };
    const left = Math.max(GAP, Math.min(text.x * camera.zoom + camera.x, viewport.w - toolbarWidth - GAP));
    const above = text.y * camera.zoom + camera.y - BAR_HEIGHT - GAP;
    // Near the top of the cell there is no room above the text, so the bar hangs under it instead.
    const below = (text.y + (textHeight ?? textRect(text).h)) * camera.zoom + camera.y + GAP;
    const font = text.font ?? 'sans';

    return (
        <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={t('text.format')}
            className={`pointer-events-auto absolute z-10 flex h-10 items-center gap-1 rounded-xl px-1.5 ${FLOAT}`}
            style={{
                left,
                top: Math.max(GAP, Math.min(above < GAP ? below : above, viewport.h - BAR_HEIGHT - GAP)),
                width: 'max-content',
                maxWidth: `calc(100% - ${GAP * 2}px)`
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            // Keep the caret in the text when applying formatting.
            onMouseDown={(e) => e.preventDefault()}
        >
            <Menu.Root>
                <Tooltip label={t('text.font')} name>
                    <Menu.Trigger className="icon-btn h-8 w-auto gap-1 px-2">
                        <span className="text-xs" style={{ fontFamily: FONT_STACK[font] }}>
                            {t(`text.fonts.${font}`)}
                        </span>
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="start">
                        <Menu.Popup className="menu-popup">
                            <Menu.RadioGroup value={font} onValueChange={(value: DrawingFont) => style({ font: value })}>
                                {FONTS.map((value) => (
                                    <Menu.RadioItem key={value} value={value} className="menu-item">
                                        <span className="grid h-4 w-4 place-items-center">
                                            <Menu.RadioItemIndicator>
                                                <Icon icon={Check} size={14} />
                                            </Menu.RadioItemIndicator>
                                        </span>
                                        <span style={{ fontFamily: FONT_STACK[value] }}>{t(`text.fonts.${value}`)}</span>
                                    </Menu.RadioItem>
                                ))}
                            </Menu.RadioGroup>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <span className="mx-0.5 h-4 w-px bg-border-soft" />
            <Menu.Root>
                <Tooltip label={t('text.size')} name>
                    <Menu.Trigger className="icon-btn h-8 w-auto gap-1 px-2 text-xs tabular-nums">
                        {text.size}
                        <Icon icon={ChevronDown} size={12} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="start">
                        <Menu.Popup className="menu-popup">
                            <Menu.RadioGroup value={text.size} onValueChange={(value: number) => style({ size: value })}>
                                {SIZES.map((size) => (
                                    <Menu.RadioItem key={size} value={size} className="menu-item">
                                        <span className="grid h-4 w-4 place-items-center">
                                            <Menu.RadioItemIndicator>
                                                <Icon icon={Check} size={14} />
                                            </Menu.RadioItemIndicator>
                                        </span>
                                        <span>{size} px</span>
                                    </Menu.RadioItem>
                                ))}
                            </Menu.RadioGroup>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <span className="mx-0.5 h-4 w-px bg-border-soft" />
            <div className={BTN_GROUP}>
                <Tooltip label={t('text.bold')} name>
                    <button className="icon-btn h-8 w-8" aria-pressed={text.bold === true} onClick={() => style({ bold: !text.bold })}>
                        <Icon icon={Bold} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label={t('text.italic')} name>
                    <button className="icon-btn h-8 w-8" aria-pressed={text.italic === true} onClick={() => style({ italic: !text.italic })}>
                        <Icon icon={Italic} size={16} />
                    </button>
                </Tooltip>
                {(
                    [
                        { key: 'underline', icon: Underline },
                        { key: 'strikethrough', icon: Strikethrough }
                    ] as const
                ).map(({ key, icon }) => (
                    <Tooltip key={key} label={t(`text.${key}`)} name>
                        <button className="icon-btn h-8 w-8" aria-pressed={text[key] === true} onClick={() => style({ [key]: !text[key] })}>
                            <Icon icon={icon} size={16} />
                        </button>
                    </Tooltip>
                ))}
            </div>

            <span className="mx-0.5 h-4 w-px bg-border-soft" />
            <Menu.Root>
                <Tooltip label={t('text.alignment')} name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={text.align === 'center' ? AlignCenter : text.align === 'right' ? AlignRight : AlignLeft} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="start">
                        <Menu.Popup className="menu-popup">
                            <Menu.RadioGroup value={text.align ?? 'left'} onValueChange={(align: 'left' | 'center' | 'right') => style({ align })}>
                                {(
                                    [
                                        { value: 'left', icon: AlignLeft },
                                        { value: 'center', icon: AlignCenter },
                                        { value: 'right', icon: AlignRight }
                                    ] as const
                                ).map(({ value, icon }) => (
                                    <Menu.RadioItem key={value} value={value} className="menu-item" closeOnClick={false}>
                                        <Icon icon={icon} size={16} />
                                        {t(`text.align.${value}`)}
                                        <Menu.RadioItemIndicator className="ml-auto">
                                            <Icon icon={Check} size={14} />
                                        </Menu.RadioItemIndicator>
                                    </Menu.RadioItem>
                                ))}
                            </Menu.RadioGroup>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
            <Menu.Root>
                <Tooltip label={t('text.color')} name>
                    <Menu.Trigger className="icon-btn" style={{ color: accentColor(text.color) }}>
                        <Icon icon={Palette} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="end">
                        <Menu.Popup className="menu-popup grid min-w-0 grid-cols-6 gap-1 p-2">
                            <Tooltip label={t('text.defaultColor')}>
                                <Menu.Item
                                    closeOnClick={false}
                                    aria-label={t('text.defaultColor')}
                                    className={clsx(ACCENT_SWATCH, 'border border-border-strong text-text-muted')}
                                    onClick={() => style({ color: undefined })}
                                >
                                    {!text.color && <Icon icon={Check} size={12} />}
                                </Menu.Item>
                            </Tooltip>
                            {NODE_ACCENTS.map((accent) => (
                                <Tooltip key={accent.id} label={accentLabel(accent.id)}>
                                    <Menu.Item
                                        closeOnClick={false}
                                        aria-label={accentLabel(accent.id)}
                                        className={clsx(ACCENT_SWATCH, text.color === accent.id && ACCENT_SWATCH_PICKED)}
                                        style={{ background: accent.color }}
                                        onClick={() => style({ color: accent.id })}
                                    >
                                        {text.color === accent.id && <Icon icon={Check} size={12} />}
                                    </Menu.Item>
                                </Tooltip>
                            ))}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
        </div>
    );
}
