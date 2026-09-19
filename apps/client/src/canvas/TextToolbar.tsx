import { useShallow } from 'zustand/react/shallow';
import { Menu } from '@base-ui-components/react/menu';
import { Bold, Check, Italic, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DrawingFont } from '@ruimte/contracts';
import { FONT_STACK } from '@/canvas/TextElementView';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { BTN_GROUP, FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const FONTS: readonly DrawingFont[] = ['sans', 'hand', 'mono'];

/* The same steps a drawing offers, so a label and a written word can be set to match. */
const SIZES = [16, 20, 28, 36];

/* How far above the text the bar floats, and the room it needs before it moves below instead. */
const GAP = 10;
const BAR_HEIGHT = 40;

/*
 * The style of the one text element that is selected: its face, its weight, its slant and its size,
 * all of it the whole element's. It is drawn outside the camera transform, so it stays the same
 * size at every zoom, and it keeps the caret where it is: the press never reaches the canvas.
 */
export function TextToolbar() {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const { camera, text } = useCanvas(
        useShallow((s) => ({
            camera: s.camera,
            text: s.selection.length === 1 ? (s.texts[s.selection[0]!] ?? null) : null
        }))
    );

    if (text === null) {
        return null;
    }

    const style = (patch: Parameters<ReturnType<typeof canvasStore.getState>['styleText']>[1]): void => {
        canvasStore.getState().styleText(text.id, patch);
    };
    const left = text.x * camera.zoom + camera.x;
    const above = text.y * camera.zoom + camera.y - BAR_HEIGHT - GAP;
    // Near the top of the cell there is no room above the text, so the bar hangs under it instead.
    const below = (text.y + text.size * 1.5) * camera.zoom + camera.y + GAP;
    const font = text.font ?? 'sans';

    return (
        <div
            className={`absolute z-10 flex h-10 items-center gap-1 rounded-xl px-1.5 ${FLOAT}`}
            style={{ left, top: above < GAP ? below : above }}
            onPointerDown={(e) => e.stopPropagation()}
            // Keeps the caret in the text: without this the press blurs it and ends the edit.
            onMouseDown={(e) => e.preventDefault()}
        >
            <Menu.Root>
                <Tooltip label={t('text.font')} name>
                    <Menu.Trigger className="icon-btn h-8 gap-1.5 px-2">
                        <Icon icon={Type} size={16} />
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

            <Menu.Root>
                <Tooltip label={t('text.size')} name>
                    <Menu.Trigger className="icon-btn h-8 px-2 text-xs tabular-nums">{text.size}</Menu.Trigger>
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
            </div>
        </div>
    );
}
