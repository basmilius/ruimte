import { z } from 'zod';
import { LIVE_VOICES, VOICE_LANGUAGES, type VoiceLanguage } from './voice-languages.ts';

/*
 * Voice run by the daemon: a phone opens its own media peer to OpenAI and carries only audio and
 * captions, while the daemon mints the session with a key on the machine, runs the tool calls and
 * reports. Every request after `voice.start` names the scene that started it, since the scenes of an
 * iPad share one link: the daemon refuses a request from any other client or scene.
 */

/* An OpenAI API key is a few hundred bytes; more is a paste of something else. */
export const VOICE_KEY_MAX_BYTES = 1024;
/* What a desktop offer with every candidate gathered stays under. */
export const VOICE_SDP_MAX_CHARS = 128_000;

const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);

export const VoiceLanguageSchema = z.enum(VOICE_LANGUAGES.map((language) => language.id) as [VoiceLanguage, ...VoiceLanguage[]]);
export const LiveVoiceSchema = z.enum(LIVE_VOICES);

/* Where a daemon Voice session stands. `closed` and `failed` are the end; a session never comes back from either. */
export const VoicePhaseSchema = z.enum(['starting', 'active', 'stopping', 'closed', 'failed']);
export type VoicePhase = z.infer<typeof VoicePhaseSchema>;

/* The kinds of line the timeline draws, the same as the desktop's; an unknown one draws as a plain line. */
export const VoiceActivityKindSchema = z.enum(['focus', 'rename', 'note', 'terminal', 'chat', 'node', 'view', 'delete', 'git']);
export type VoiceActivityKind = z.infer<typeof VoiceActivityKindSchema>;

export const VoiceActivityStatusSchema = z.enum(['running', 'completed', 'failed']);
export type VoiceActivityStatus = z.infer<typeof VoiceActivityStatusSchema>;

export const VoiceErrorSchema = z.object({ code: z.string().min(1), message: z.string() });
export type VoiceError = z.infer<typeof VoiceErrorSchema>;

export const VoiceKeyStatusSchema = z.object({
    // Whether the machine holds an OpenAI key for Voice; the key itself never leaves the machine.
    present: z.boolean()
});
export type VoiceKeyStatus = z.infer<typeof VoiceKeyStatusSchema>;

export const VoiceSetKeyPayloadSchema = z.object({
    key: z.string().trim().min(1).max(VOICE_KEY_MAX_BYTES)
});
export type VoiceSetKeyPayload = z.infer<typeof VoiceSetKeyPayloadSchema>;

/* How Voice on this machine talks, the machine's own and the same for every client that starts it. */
export const VoicePreferencesSchema = z.object({
    language: VoiceLanguageSchema,
    voice: LiveVoiceSchema
});
export type VoicePreferences = z.infer<typeof VoicePreferencesSchema>;

/* The answer to `voice.preferences` and `voice.setPreferences`, and the `voice.preferences` event every client hears on a change. */
export const VoicePreferencesStateSchema = z.object({
    // Null while the machine stores none, so a client may offer its own first choice.
    preferences: VoicePreferencesSchema.nullable()
});
export type VoicePreferencesState = z.infer<typeof VoicePreferencesStateSchema>;

/* The project a session works in now; Voice moves between the projects of its machine. */
export const VoiceProjectSchema = z.object({
    id: z.string().min(1),
    name: z.string()
});
export type VoiceProject = z.infer<typeof VoiceProjectSchema>;

/* `seq` counts per session, over this event and `voice.activity` together, so a client puts both in one order and drops what it already had. */
export const VoiceStatusEventSchema = z.object({
    sessionId: id,
    sceneId: id,
    seq: z.number().int().nonnegative(),
    phase: VoicePhaseSchema,
    error: VoiceErrorSchema.optional(),
    // Null while no project is current; absent from a machine that binds a session to one project.
    project: VoiceProjectSchema.nullable().optional()
});
export type VoiceStatusEvent = z.infer<typeof VoiceStatusEventSchema>;

/* The question of an action that asks first; the phone answers it with `voice.confirm` and this token. */
export const VoiceActivityConfirmationSchema = z.object({
    token: z.string().min(1).max(128),
    title: z.string().max(200),
    consequences: z.array(z.string().max(500)).max(4)
});
export type VoiceActivityConfirmation = z.infer<typeof VoiceActivityConfirmationSchema>;

/* A short line of what Voice did. Never audio, a whole transcript, raw tool arguments or a key. */
export const VoiceActivityEntrySchema = z.object({
    id: z.string().min(1).max(128),
    at: z.number(),
    kind: VoiceActivityKindSchema,
    status: VoiceActivityStatusSchema,
    label: z.string().max(200),
    detail: z.string().max(500),
    // Only on a running line whose action waits on the person; the next line of that id, once answered, has none.
    confirmation: VoiceActivityConfirmationSchema.optional()
});
export type VoiceActivityEntry = z.infer<typeof VoiceActivityEntrySchema>;

export const VoiceActivityEventSchema = z.object({
    sessionId: id,
    sceneId: id,
    seq: z.number().int().nonnegative(),
    entry: VoiceActivityEntrySchema
});
export type VoiceActivityEvent = z.infer<typeof VoiceActivityEventSchema>;

/*
 * `startId` is the client's, so a retry after a lost answer is the same start: the daemon keeps one per
 * client, scene and start id, and refuses the same id with other fields. `projectId` is only where the
 * session starts, the project on the phone's screen; without it the session starts in the project opened
 * last. `viewId` is the canvas on the phone's screen, without which actions land on the project's first canvas.
 */
export const VoiceStartPayloadSchema = z.object({
    startId: id,
    sceneId: id,
    projectId: z.string().min(1).optional(),
    sdp: z.string().min(1).max(VOICE_SDP_MAX_CHARS),
    // The machine's stored preferences come first; these count only while it stores none, and English and marin after them.
    language: VoiceLanguageSchema.optional(),
    voice: LiveVoiceSchema.optional(),
    // IANA, for the clock the daemon gives the model.
    timeZone: z.string().min(1).max(64),
    viewId: z.string().min(1).optional()
});
export type VoiceStartPayload = z.infer<typeof VoiceStartPayloadSchema>;

/* The answer comes once the daemon can run tools; `status` is where the session stands then, so the client misses no early event. */
export const VoiceStartResultSchema = z.object({
    sessionId: id,
    sdp: z.string().min(1).max(VOICE_SDP_MAX_CHARS),
    status: VoiceStatusEventSchema
});
export type VoiceStartResult = z.infer<typeof VoiceStartResultSchema>;

/*
 * Stops a session, or by `startId` a start that has not answered yet. The cancel is kept, so a mint that
 * answers late never makes a session after all. One of the two ids, never both.
 */
export const VoiceStopPayloadSchema = z
    .object({
        sceneId: id,
        sessionId: id.optional(),
        startId: id.optional()
    })
    .refine((payload) => (payload.sessionId === undefined) !== (payload.startId === undefined), {
        message: 'Name the session or the start to stop, not both'
    });
export type VoiceStopPayload = z.infer<typeof VoiceStopPayloadSchema>;

// False when nothing of that id ran any more.
export const VoiceStopResultSchema = z.object({
    stopped: z.boolean()
});
export type VoiceStopResult = z.infer<typeof VoiceStopResultSchema>;

/* The person's answer to an action that asked first, from the phone; the model's goes through its own tool to the same confirmation. */
export const VoiceConfirmPayloadSchema = z.object({
    sceneId: id,
    sessionId: id,
    token: z.string().min(1).max(128),
    decision: z.enum(['confirm', 'cancel'])
});
export type VoiceConfirmPayload = z.infer<typeof VoiceConfirmPayloadSchema>;

// False when the confirmation was gone: answered already, the session ended, or what it was about changed.
export const VoiceConfirmResultSchema = z.object({
    accepted: z.boolean()
});
export type VoiceConfirmResult = z.infer<typeof VoiceConfirmResultSchema>;
