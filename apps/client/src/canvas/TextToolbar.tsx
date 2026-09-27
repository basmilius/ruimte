import { useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Italic, Palette, Strikethrough, Underline } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DrawingFont } from '@ruimte/contracts';
import { accentColor, accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { textRect } from '@/canvas/edge-lines';
import { FONT_STACK } from '@/canvas/text-font';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { ButtonGroup, ColorSwatch, Icon, IconButton, Menu, Surface, Tooltip } from '@basmilius/react-ui';

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
        <Surface
            ref={toolbarRef}
            role="toolbar"
            aria-label={t('text.format')}
            className="pointer-events-auto absolute z-10 flex h-10 items-center gap-1 rounded-xl px-1.5"
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
                <IconButton render={<Menu.Trigger />} label={t('text.font')} className="w-auto gap-1 px-2">
                    <span className="text-xs" style={{ fontFamily: FONT_STACK[font] }}>
                        {t(`text.fonts.${font}`)}
                    </span>
                </IconButton>
                <Menu.Popup side="top" sideOffset={8}>
                    <Menu.RadioGroup value={font} onValueChange={(value: DrawingFont) => style({ font: value })}>
                        {FONTS.map((value) => (
                            <Menu.RadioItem key={value} value={value}>
                                <span style={{ fontFamily: FONT_STACK[value] }}>{t(`text.fonts.${value}`)}</span>
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </Menu.Popup>
            </Menu.Root>

            <span className="mx-0.5 h-4 w-px bg-border-soft" />
            <Menu.Root>
                <IconButton render={<Menu.Trigger />} label={t('text.size')} className="w-auto gap-1 px-2 text-xs tabular-nums">
                    {text.size}
                    <Icon icon={ChevronDown} size={12} />
                </IconButton>
                <Menu.Popup side="top" sideOffset={8}>
                    <Menu.RadioGroup value={text.size} onValueChange={(value: number) => style({ size: value })}>
                        {SIZES.map((size) => (
                            <Menu.RadioItem key={size} value={size}>
                                <span>{size} px</span>
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </Menu.Popup>
            </Menu.Root>

            <span className="mx-0.5 h-4 w-px bg-border-soft" />
            <ButtonGroup>
                <IconButton icon={Bold} label={t('text.bold')} aria-pressed={text.bold === true} onClick={() => style({ bold: !text.bold })} />
                <IconButton icon={Italic} label={t('text.italic')} aria-pressed={text.italic === true} onClick={() => style({ italic: !text.italic })} />
                {(
                    [
                        { key: 'underline', icon: Underline },
                        { key: 'strikethrough', icon: Strikethrough }
                    ] as const
                ).map(({ key, icon }) => (
                    <IconButton key={key} icon={icon} label={t(`text.${key}`)} aria-pressed={text[key] === true} onClick={() => style({ [key]: !text[key] })} />
                ))}
            </ButtonGroup>

            <span className="mx-0.5 h-4 w-px bg-border-soft" />
            <Menu.Root>
                <IconButton
                    render={<Menu.Trigger />}
                    icon={text.align === 'center' ? AlignCenter : text.align === 'right' ? AlignRight : AlignLeft}
                    label={t('text.alignment')}
                />
                <Menu.Popup side="top" sideOffset={8}>
                    <Menu.RadioGroup value={text.align ?? 'left'} onValueChange={(align: 'left' | 'center' | 'right') => style({ align })}>
                        {(
                            [
                                { value: 'left', icon: AlignLeft },
                                { value: 'center', icon: AlignCenter },
                                { value: 'right', icon: AlignRight }
                            ] as const
                        ).map(({ value, icon }) => (
                            <Menu.RadioItem key={value} value={value} closeOnClick={false}>
                                <Icon icon={icon} size={16} />
                                {t(`text.align.${value}`)}
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </Menu.Popup>
            </Menu.Root>
            <Menu.Root>
                <IconButton render={<Menu.Trigger />} icon={Palette} label={t('text.color')} style={{ color: accentColor(text.color) }} />
                <Menu.Popup side="top" sideOffset={8} align="end" className="grid min-w-0 grid-cols-6 gap-1 p-2">
                    <Tooltip label={t('text.defaultColor')}>
                        <ColorSwatch
                            render={<Menu.Item unstyled closeOnClick={false} />}
                            aria-label={t('text.defaultColor')}
                            picked={!text.color}
                            onClick={() => style({ color: undefined })}
                        />
                    </Tooltip>
                    {NODE_ACCENTS.map((accent) => (
                        <Tooltip key={accent.id} label={accentLabel(accent.id)}>
                            <ColorSwatch
                                render={<Menu.Item unstyled closeOnClick={false} />}
                                aria-label={accentLabel(accent.id)}
                                color={accent.color}
                                picked={text.color === accent.id}
                                on="popup"
                                onClick={() => style({ color: accent.id })}
                            />
                        </Tooltip>
                    ))}
                </Menu.Popup>
            </Menu.Root>
        </Surface>
    );
}
