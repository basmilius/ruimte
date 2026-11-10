import type { ChatItem, GitDiffResult, Worktree } from '@ruimte/contracts';

/* The questions and approvals a chat waits on, as `chat.inspect` and the daemon's chat read show them. */
export function pendingRequestsOf(items: readonly ChatItem[]) {
    return {
        questions: items.flatMap((item) =>
            item.kind === 'question' && item.state === 'pending'
                ? [
                      {
                          requestId: item.requestId,
                          itemId: item.id,
                          optional: item.async === true,
                          questions: item.questions.map((question) => ({
                              questionId: question.id,
                              header: question.header,
                              question: question.question,
                              choices: question.choices.map((choice) => choice.label),
                              multiSelect: question.multiSelect
                          }))
                      }
                  ]
                : []
        ),
        // An approval by its tool and the description it came with, never by its input: that is a command or a path, which may hold a secret.
        approvals: items.flatMap((item) =>
            item.kind === 'approval' && item.decision === 'pending' ? [{ requestId: item.requestId, tool: item.toolName, description: item.description }] : []
        )
    };
}

export function worktreeDiffOutput(branch: string, worktree: Pick<Worktree, 'from'>, diff: Pick<GitDiffResult, 'files'>) {
    return {
        branch,
        from: worktree.from?.branch ?? null,
        files: (diff.files ?? []).map((file) => ({
            path: file.path,
            added: file.added,
            deleted: file.deleted,
            diff: file.diff,
            omitted: file.omitted ?? null
        }))
    };
}
