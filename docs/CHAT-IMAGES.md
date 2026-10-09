# Generated chat images

Codex image generation saves an attachment before its tool call settles. The thread keeps the attachment metadata, dimensions and revised prompt. Image bytes never enter the event log. A fork copies its attachments so deleting the original chat does not remove the fork's images.

ADE CORE draws `ImageGeneration` as a thumbnail outside tool groups and completed turn folds. The image aligns with the reply text. Copy prompt lives in the image's menu. The host supplies Open and Save to project.

## Project copies

`chat.imageTarget` takes `chatId`, `attachmentId` and an optional destination `path`. The daemon finds the chat's project, requires the client to hold that project, and returns its folder, display name and attachment name. With a path, it checks the destination and returns whether a regular file exists and its revision.

`chat.saveImage` takes the same identity and a destination path. Without `replace`, it publishes a complete file without overwriting a name that already exists. An explicit Replace supplies the revision from `chat.imageTarget`. A changed destination refuses the write and the dialog checks again. Copies stay inside the canonical project folder, outside Git, project and machine state. Symlinks at the destination are refused. Replacement publishes a new file, so it does not write through a hard link to another location.

The client captures the originating transport and attachment identity when opening the dialog. Folder and name changes invalidate the previous check; late replies cannot approve a different path. Enter uses Save only. A pending write blocks repeated submissions and cancellation.

## Opening

The client reads an attachment through `bytes.read`. The desktop's `image:open` bridge validates the supported image type and byte limit, writes a temporary copy with an image extension, and opens that copy in the system viewer. A failed open removes the copy; the shell removes its image folder on exit. A browser or older desktop shell downloads the image instead.

The bridge never receives an attachment source path. The server resolves image sources from the thread's metadata rather than accepting a path or image bytes from the save request.
