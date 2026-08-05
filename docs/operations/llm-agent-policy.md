# LLM Agent Policy

## Allowed Reads

The agent may read Markdown files, attachments, and Git history inside `/srv/wiki/vault`.

## Default Write Zones

The agent may create and edit files under:

- `/srv/wiki/vault/_llm/drafts/`
- `/srv/wiki/vault/_llm/logs/`
- `/srv/wiki/vault/_llm/indexes/`

## Proposed Edit Zone

When a requested change may rewrite or substantially alter a human-authored note, the agent must write a proposal under:

- `/srv/wiki/vault/_llm/proposed-edits/`

## Direct Human Note Edits

The agent may directly edit notes outside `_llm/` only when the user explicitly asks for that edit.

## Required After Write

After any write, the agent must run:

```bash
git -C /srv/wiki/vault status --short
```

For intentional changes, the agent must commit with a message beginning with one of:

- `[LLM draft]`
- `[LLM edit]`
- `[LLM index]`
- `[LLM log]`
