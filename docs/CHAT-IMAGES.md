# Generated chat images

When Codex generates an image, the daemon saves it as an attachment before the tool call settles. The thread keeps the attachment's metadata, dimensions and revised prompt. Image bytes never enter the event log. A fork copies its attachments so deleting the original chat does not remove the fork's images.

ADE CORE draws `ImageGeneration` as a thumbnail outside tool groups and completed turn folds, aligned with the reply text. Copy prompt is in the image's menu. The host supplies Open and Save to project.

## Project copies

`chat.imageTarget` takes `chatId`, `attachmentId` and an optional destination `path`. The daemon finds the chat's project, requires the client to hold that project, and returns its folder, display name and attachment name. With a path, it also checks the destination and returns whether a regular file is there, with its revision.

`chat.saveImage` takes the same identity and a destination path. Without `replace`, it publishes a complete file without overwriting a name that already exists. An explicit Replace supplies the revision from `chat.imageTarget`. If the destination changed since, the write is refused and the dialog checks again. A copy lands inside the canonical project folder, never in Git, project or machine state. Symlinks at the destination are refused. A replacement publishes a new file, so it never writes through a hard link to another location.

The client captures the transport and the attachment identity when it opens the dialog. Changing the folder or the name invalidates the previous check, so a late reply cannot approve a different path. Enter only triggers Save. While a write is pending, the dialog can be neither submitted again nor cancelled.

## Opening

The client reads an attachment through `bytes.read`. The desktop's `image:open` bridge validates the supported image type and byte limit, writes a temporary copy with an image extension, and opens that copy in the system viewer. A failed open removes the copy; the shell removes its image folder on exit. A browser or older desktop shell downloads the image instead.

The bridge never receives an attachment source path. The server finds the image source in the thread's metadata and never takes a path or image bytes from the save request.
