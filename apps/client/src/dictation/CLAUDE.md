# Speech to Text

Optional local dictation, under Voice settings beside Voice Control. Only Nemotron streaming is used. The setting defaults to off; enabling it downloads and verifies the model, never opens a microphone. Disabling cancels audio and shuts down the helper. Removing the model is a separate action.

- Only a person starts a recording. No agent action exposes the microphone.
- Audio stays in memory on this computer. No audio files, API keys or remote recognition.
- Voice Control and dictation share the microphone and language settings. `audio/ownership.ts` permits one listener at a time.
- A run owns one target and one session ID. Cancelling, unmounting its target, replacing its draft or receiving stale IPC must never insert elsewhere.
- Live transcripts are complete replacement previews. Only the final transcript is inserted, once, after stopping. Escape discards.
- A terminal gets an editable draft. Only an explicit paste sends sanitized text through xterm; never Enter, control characters or partial transcripts.
- The microphone closes on normal stop, cancellation and every failure. Stop drains the final worklet block before asking the helper for its last result.
- No word substitutions or spoken commands. Recognition errors remain visible for the person to edit.

`controller.ts` coordinates the target and audio ownership. `helper.ts` manages capture and the optional desktop bridge. `editor.ts` tracks CodeMirror insertion ranges and isolates undo history. The desktop shell owns downloads, persisted enablement and the helper's sixty-second idle timeout. IPC shapes live in `packages/desktop-bridge/src/speech.ts`.
