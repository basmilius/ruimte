# Speech to Text

Local dictation under Voice settings, beside Voice Control, on Nemotron streaming only.

- `audio/ownership.ts` allows one microphone listener at a time, shared with Voice Control.
- A run owns one target and one session ID. Cancelling, unmounting its target, replacing its draft or stale IPC must never insert elsewhere.
- Live transcripts are whole replacement previews. Only the final transcript is inserted, once, after stopping. Escape discards.
- A terminal paste sends sanitized text through xterm; never Enter, control characters or partial transcripts.
- The microphone closes on stop, cancellation and every failure. Stop drains the final worklet block before asking the helper for its last result.
- No word substitutions or spoken commands. Recognition errors stay visible for the person to edit.
- A failure reaches a person only through `failure.ts`. Each `DictationError` code is a key under `voice:dictation.errors`; a person never sees a raw code or Chromium message.

`controller.ts` coordinates target and audio ownership. `helper.ts` manages capture and the optional desktop bridge. `editor.ts` tracks CodeMirror insertion ranges and isolates undo history. The desktop shell owns downloads, persisted enablement and the helper's sixty-second idle timeout. IPC shapes: `packages/desktop-bridge/src/speech.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Speech to Text is optional and off by default. Enabling downloads one verified local streaming model and never opens the microphone. Audio is never uploaded or saved.
- Voice Control is the separate cloud feature. Both share the microphone and language settings and never record together.
- Dictation previews text and inserts only after stopping. A terminal gets an editable draft; only an explicit paste writes sanitized text, without Enter. Agents cannot start dictation.
