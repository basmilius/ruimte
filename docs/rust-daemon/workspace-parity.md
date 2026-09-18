# Workspace parity

Baseline: `3b46403e130bd4846f8e65998e2e35016c98760a`.

The native `WorkspaceService` owns project state, drawings, diagrams, filesystem access, bytes, Git, canvas/context commands, plans, tasks, lineage, notices and the durable workflow outbox. All registered methods execute native Rust code. None returns a success placeholder or falls back to the TypeScript daemon.

## Projects and view files

| Requests | Native behavior | Evidence |
| --- | --- | --- |
| `project.list`, `project.open`, `project.save`, `project.save-local` | Durable project index, v1/v2 migration, per-project serialization, revision conflicts, unknown-kind roundtrip and atomic writes. External replacement reloads the document and emits `project.changed`. | `project_revisions_and_unknown_kinds_round_trip`; parent project-race wire corpus |
| `project.close`, `project.release`, `project.delete` | Close/release watcher teardown, registry updates and deletion limited to Ruimte-owned files. Project mutations prune lineage, prompts, notices, tasks and outbox entries. | `project_place_changes_owe_child_shutdown_and_prune_removed_agent_state`; workspace wire corpus |
| `project.setIdentity`, `project.setIcon` | No-op identity updates preserve revisions. Icon writes enforce 256 KiB, magic MIME checks, atomic replacement, candidate priority, dark variants and a realpath jail. | `project_icons_keep_failed_replacements_and_jail_symlinks`; media wire corpus |
| `project.settings`, `project.settings-update` | Unknown settings survive. Shared paths are normalized, deduplicated, jailed, required to be ignored/untracked and linked with matching Git exclusions. | workspace wire corpus; worktree share unit coverage |
| `drawing.open/save/close/copy`, `diagram.open/save/close/copy` | Per-view revision locks, atomic compact serialization, consistent single-read watcher reloads, orphan cleanup and client-scoped subscriptions. | `drawing_and_diagram_files_enforce_their_own_revisions`; strict diagram integration case |
| `drawing.paths`, `diagram.layout` | Bounded `spawn_blocking` renderer with native drawing geometry, freehand strokes and deterministic diagram layout. | checked-in 56-scene drawing oracle and 48-scene diagram oracle; parent real daemon graphics corpus |

Unknown project node and view kinds preserve their payloads. Known node updates overlay only the fields they own. Edges whose endpoints no longer share a canvas are removed during normalization.

`WorkspaceService` remains the only project writer. Its internal host API exposes project reads, atomic mutations, node location/title/source lookups, drawing/diagram reads, jailed file/icon asset resolution and typed canvas/context operations.

## Files and bytes

| Requests | Native behavior | Evidence |
| --- | --- | --- |
| `fs.browse`, `fs.list`, `fs.search` | Jailed/absolute path checks, bounded walks, natural depth-first ordering, hidden handling and Git ignore pruning. | `filesystem_search_read_and_chunked_bytes_use_real_files`; parent workspace wire corpus |
| `fs.read`, `bytes.read` | Bounded text/chunk reads, UTF-8 and binary handling, MIME magic/SVG sniffing, ranges, EOF metadata and the same resolver used by authenticated HTTP media routes. | filesystem unit test; parent 29-case media corpus |
| `fs.grep` | Bounded `rg --json` execution with UTF-16 offsets and context lines, plus a native fallback when `rg` is unavailable. | filesystem unit and wire coverage |
| `fs.watch`, `fs.unwatch` | Per-client ownership, event coalescing and cancellation on unwatch, detach or shutdown. | watcher lifecycle tests and project external-edit corpus |
| `fs.reveal` | Existing absolute paths only, launched through platform argument arrays rather than a shell. | native source and platform compile gates |

The fallback grep engine uses Rust regex syntax, so a JavaScript-only regular expression can differ on a machine without `rg`. Windows-specific browse/reveal paths have not been validated on Windows; the platform checks here cover macOS and Linux.

## Git and worktrees

All Git operations invoke `git` or `gh` with argument arrays. No Git operation reimplements repository semantics or builds a shell command.

| Requests | Native behavior | Evidence |
| --- | --- | --- |
| `git.status`, `git.diff`, `git.stage`, `git.discard`, `git.refs`, `git.log` | Porcelain v2 status, staged rename/untracked counts, bounded tracked and untracked diffs, real staging/discard and commit/ref metadata. | `git_status_stage_and_log_run_against_a_temporary_repository`; `checkpoint_diff_includes_modified_and_untracked_files`; parent wire corpus |
| `git.watch`, `git.unwatch` | Repository notifications coalesce before status and belong to the requesting client. | watcher lifecycle tests |
| `git.action`, `git.cancel` | Real cancellable Git/gh processes, bounded output and typed progress. Owned process groups are reaped on cancel and timeout. | action/cancellation unit coverage and all-target checks |
| `git.capabilities`, `git.suggestMessage` | Installed provider probing and bounded one-shot Claude/Codex commit-message generation. The child environment removes all inherited Ruimte bearer keys. | `one_shot_provider_bounds_io_clears_agent_env_and_kills_its_group` |
| `git.worktree-add/list/remove` | Canonical durable registry, origin/ownership metadata, exact work counts, safe shared links, dirty/locked refusal, missing checkout pruning, checkpoint-index cleanup and created/existing/kept branch rules. | `worktree_register_counts_work_and_protects_daemon_created_branches`; worktree canvas wire corpus |
| `git.worktree-merge/abort` | Per-repository serialization, target preflight, merge/squash/rebase, conflict/rollback handling, active-agent refusal and authorized stop-before-merge. | `workspace-canvas.integration.test.ts`; parent person/worktree wire corpora |

The direct `git.worktree-remove` contract has no agent-stop field in TypeScript or Rust. Agent stopping is part of merge and the UI's explicit agent-ending flow. Network-backed Git/gh actions still depend on the machine's configured remotes and credentials; tests use local repositories and fake providers.

## Canvas, context and workflow

Native HTTP canvas verbs cover node/view listing and mutation, linking, grouping, arranging, teams, worktree inspection/merge, task completion and notices. Agent diagram writes use the strict schema and reject unknown fields before revision changes. Team placement runs read-only Git/path preflight before dry-run and applies all roles in one project mutation.

Context reads enforce project identity and linked-source visibility. Drawing and diagram context rendering uses the same bounded CPU executor as public rendering. Notices display immediately in plain terminals and queue once for the next agent hook turn.

Lineage, prompts, plans, tasks, notices and outbox entries use private atomic files compatible with TypeScript records. The coordinator persists before publishing state, serializes target lanes, survives restart, resumes eligible interrupted parent turns, settles natural child completion, batches team wakes, delivers fork summaries and reconciles dropped runtime facts through snapshots. Runtime calls carry real identity/authority and stable operation ids.

Evidence:

- `workspace-canvas.integration.test.ts`: team transaction boundaries, active-agent worktree merge, strict diagrams, immediate terminal notice and one-shot hook notice.
- `workspace-workflow.integration.test.ts`: natural task settlement, synthetic task row, headless TypeScript→Rust→TypeScript resume, summary delivery and unused-fork cleanup.
- `plan_operations_match_typescript_oracle`, `workflow_rules_match_typescript_oracle` and durable store/coordinator race tests.
- Parent actual canvas, team, worktree, task, fork-summary, pending-switch and notice wire corpora, all contract-validated.

Summary reconciliation checks durable fork lineage before reading a runtime thread, so ordinary chat lifecycle facts do not clone full histories. Headless summary recovery remains covered by `completed_summary_turn_is_delivered_without_an_open_task`.

## Checks at this checkpoint

- `cargo test --locked --lib workspace:: -- --nocapture`: 50 passed, 0 failed.
- `cargo check --locked --all-targets`: passed.
- `cargo clippy --locked --all-targets -- -D warnings`: passed.
- `bun test tests/workspace-workflow.integration.test.ts tests/workspace-canvas.integration.test.ts tests/chat-lifecycle.integration.test.ts tests/terminal-replay.integration.test.ts`: 10 passed, 0 failed, 107 assertions.
- `terminal-replay.integration.test.ts` compares live output and reconstructed snapshot state for 15 xterm cases. Fourteen match directly; the leading-combining case asserts the same known serializer limitation as TypeScript.
