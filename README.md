# effective-doodle

effective-doodle is a local Project Knowledge Engine for Git repositories. It observes one source repository per doodle project and builds deterministic, disposable knowledge from source files, configuration, documentation, and Git history. The source repository does not need to know about doodle: registration adds no files or dependencies and does not run its build or tests.

The Git repository is the source of truth. `DOODLE_HOME` contains derived knowledge that can be deleted and regenerated. Source precedence for context is machine-readable configuration, current source code, explicit decisions, README and docs, then derived knowledge. Current repository facts and the working tree are reported separately; a changed file is not treated as a committed fact. Doodle does not infer unverified business meaning.

## Install and use

Requires Node.js 20 or newer and Git. From this repository, run `npm link` to expose the `doodle` command globally, or call `node /path/to/effective-doodle/bin/doodle.js` directly. Neither approach installs anything in a repository being analyzed.

`DOODLE_HOME` defaults to `~/.doodle`. Set it to an external directory to isolate a run:

```bash
export DOODLE_HOME=/path/to/doodle-data
doodle register /path/to/git-repository --id sample
doodle list
doodle sync sample
doodle current sample
doodle changes sample
doodle changes sample --since HEAD~10
doodle context sample --task "authentication"
doodle sync sample --rebuild
doodle unregister sample
```

Every command accepts `--json` for machine-readable stdout; errors go to stderr with a nonzero exit code. For example, `doodle current sample --json` returns the versioned current-state object. Commands that take a project ID also accept `--id sample` in place of the positional ID. `sync` accepts `--since <git-ref>`; `context` requires `--task <text>`.

The first `sync` uses the current `HEAD` as both its base and head, so its initial change set is empty. Later syncs compare against the stored `lastSyncRevision`. An explicit `--since` overrides that baseline. `sync --rebuild` discards the existing derived current, changes, and decisions snapshots and regenerates them; without `--since`, its change baseline resets to the current `HEAD`. `changes --since` analyzes that ref directly without changing the saved snapshot. Run `sync` before `current`, default `changes`, or `context`.

## Storage and architecture

```text
DOODLE_HOME/
  registry.json
  projects/<id>/
    project.json       # source path and last successful sync revision
    current.json       # committed state, working tree, and detected facts
    changes.json       # last sync change snapshot
    decisions.json     # explicitly written Markdown decisions
```

All persisted JSON has `schemaVersion: 1`. `KnowledgeProvider` is the core application API exported from the package; the CLI only parses commands, calls it, and formats results. Future orchestrators can import the provider without invoking the CLI:

```js
import { KnowledgeProvider } from 'effective-doodle';

const knowledge = new KnowledgeProvider();
knowledge.register('/path/to/git-repository', { id: 'sample' });
knowledge.sync('sample');
const context = knowledge.getContext('sample', 'authentication');
```

The engine uses local, deterministic inspection. It excludes sensitive paths and redacts recognized secret-like values in derived output; it is not a general secret scanner. v0.2 does not use an external LLM, embeddings, a vector database, LangChain, LangGraph, an MCP server, or an orchestrator. Registry updates currently assume a single writer; concurrent update locking is tracked separately in DEV-83.

Run `npm test` for the Node integration/unit suite and the existing shell suite. The local `congenial-pancake` smoke validation and test counts are recorded in Linear DEV-80.

## Legacy Wiki capability

The earlier Obsidian/Syncthing/Git/Quartz wiki scaffold remains in `scripts/`, `config/`, `vault/`, and `docs/operations/`. It is an independent legacy or experimental capability, not the Project Knowledge Engine's storage or execution path. Its operational starting point is [server bootstrap](docs/operations/server-bootstrap.md); the [project wiki mode](docs/operations/project-wiki-mode.md), [agent policy](docs/operations/llm-agent-policy.md), and [verification checklist](docs/operations/verification-checklist.md) remain available. The shell tests continue to cover these tools.
