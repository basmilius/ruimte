# Output

- Bytes are read only by artifact id and version id (`artifact.get`, `bytes.read` kind `artifact`), a file by its index, never its name, which is only a label. `$RUIMTE_HOME/artifacts` is not in `OPEN_FOLDERS` (`src/fs/machine-home.ts`).
- Provenance comes from the call's context (chat, turn, task, node, CLI, model, machine), never an argument.
- A publish never shows half: bytes to `.staging` with fsync, the manifest, one `rename`, then `register.json`. Every start clears staging and rebuilds the register.
- A version joins an artifact by key, by origin for a copy from another machine, or for a keyless agent publish by a name its own chat published before (`republished`).
- A request id makes a retry answer the version it made. A full disk refuses (`disk-full`) and leaves older versions alone.
- Nothing deletes a version on its own. Cleanup proposes at ask time and removes exactly the versions a person confirmed, checked again, never the latest, a copied one or a pinned one (`ProjectIndex.pinnedArtifactVersions`).
- `artifact.remove` after a person confirms may remove anything, the last version taking the artifact; the project copy stays. Agents and peers never remove: no verb, action or peer request reaches it.
- An artifact node's reference (`artifact`, a pin only with `version`) lives in the private overlay (`OVERLAY_FIELDS`). An artifact view is never shared (`stays-on-machine`), and an agent cannot make one.
- Another machine reads only its linked project's Output (`handlers/peer-artifacts.ts`). A copy from one (`artifact.importFrom`) is a person's: it goes through staging, every file must match the other manifest's size and hash, its provenance is this machine's person, `origin` keeps the other record, and its request id comes from the origin version.
- Copy to project writes only inside the project folder, refuses an existing name (`wx`) and a link on the way or at the target.
- No artifact content (titles, names, bytes) goes into an error, telemetry, a usage count or a push.
