import { z } from 'zod';
import { assetPathOf, isPagePath } from '@/design/design-page';

/* The methods between the stage and the runtime in a design page, beside the bridge of every visual. */
export const DESIGN_METHODS = {
    // From the page: laid out and listening, whether it is a canvas, and the tweaks it declares.
    ready: 'ruimte/design/ready',
    // Both ways: where the camera of a canvas stands. The stage keeps it per page, so a write of the chat does not move it.
    camera: 'ruimte/design/camera',
    // From the stage: a zoom a person asked for.
    zoom: 'ruimte/design/zoom',
    // From the stage: the tool a person holds.
    tool: 'ruimte/design/tool',
    // From the page: the element a person picked with Comment or Edit.
    pick: 'ruimte/design/pick',
    // From the page: text a person changed in place with Edit.
    text: 'ruimte/design/text',
    // From the stage: a style a person set on the picked element, shown at once.
    style: 'ruimte/design/style',
    // From the stage: the comments waiting to be sent, drawn as numbered pins.
    pins: 'ruimte/design/pins',
    // From the stage: the values of the tweaks.
    tweaks: 'ruimte/design/tweaks',
    // From the stage: nothing picked any more.
    clear: 'ruimte/design/clear',
    // From the stage: what lies under a drawing, in the frame's coordinates.
    locate: 'ruimte/design/locate',
    // From the page: the options and the element under that drawing.
    located: 'ruimte/design/located',
    // Both ways: a file of the folder a page's script named while it ran, and its bytes, or null when it gets none.
    asset: 'ruimte/design/asset'
} as const;

export type DesignTool = 'view' | 'comment' | 'edit' | 'draw';

export const DesignCameraSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().min(0.01).max(16)
});
export type DesignCamera = z.infer<typeof DesignCameraSchema>;

/* A zoom around the middle of the stage, or the whole board fitted into it. */
export type DesignZoom = { action: 'set'; zoom: number } | { action: 'fit' };

const TweakValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
export type TweakValue = z.infer<typeof TweakValueSchema>;

// One control of the tweaks a page declares, with the value it holds now.
export const TweakSchema = z.object({
    label: z.string().max(80).optional(),
    type: z.enum(['color', 'range', 'select', 'toggle', 'text']),
    value: TweakValueSchema,
    options: z.array(z.string().max(200)).max(12).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    unit: z.string().max(8).optional()
});
export type Tweak = z.infer<typeof TweakSchema>;

// Names a CSS custom property and an attribute can carry.
const TweaksSchema = z.record(z.string().regex(/^[a-zA-Z][\w-]{0,39}$/), TweakSchema).refine((tweaks) => Object.keys(tweaks).length <= 24);
export type Tweaks = z.infer<typeof TweaksSchema>;

const RectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() });

export const DesignElementSchema = z.object({
    selector: z.string().min(1).max(1000),
    option: z.string().max(16).nullable(),
    name: z.string().max(200),
    html: z.string().max(2000),
    text: z.string().max(2000),
    rect: RectSchema,
    style: z.record(z.string().max(40), z.string().max(200))
});
export type DesignElement = z.infer<typeof DesignElementSchema>;

const message = <Method extends string, Params extends z.ZodType>(method: Method, params: Params) =>
    z.object({ jsonrpc: z.literal('2.0'), method: z.literal(method), params });

const PageMessageSchema = z.discriminatedUnion('method', [
    message(DESIGN_METHODS.ready, z.object({ canvas: z.boolean(), tweaks: z.unknown() })),
    message(DESIGN_METHODS.camera, DesignCameraSchema),
    message(DESIGN_METHODS.pick, z.object({ tool: z.enum(['comment', 'edit']), element: DesignElementSchema })),
    message(DESIGN_METHODS.text, z.object({ element: DesignElementSchema, before: z.string().max(2000), after: z.string().max(2000) })),
    message(DESIGN_METHODS.located, z.object({ elements: z.array(DesignElementSchema).max(4) })),
    // Only a file the folder holds, by the path `assetPathOf` makes of it, and never a page, which frames as a page of its own.
    message(
        DESIGN_METHODS.asset,
        z.object({
            path: z
                .string()
                .max(1024)
                .refine((path) => assetPathOf(path) === path && !isPagePath(path))
        })
    )
]);
export type DesignPageMessage = z.infer<typeof PageMessageSchema>;

/* What a design page said, checked: it is an agent's page, so anything else is ignored. */
export function designPageMessage(data: unknown): DesignPageMessage | null {
    const parsed = PageMessageSchema.safeParse(data);

    return parsed.success ? parsed.data : null;
}

/* The tweaks a page declared, or none when they do not hold: a bad declaration leaves the panel empty rather than the page broken. */
export function tweaksOf(declared: unknown): Tweaks | null {
    const parsed = TweaksSchema.safeParse(declared);

    return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : null;
}

/* One message for the page. */
export function designMessage(method: (typeof DESIGN_METHODS)[keyof typeof DESIGN_METHODS], params?: object): object {
    return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}
