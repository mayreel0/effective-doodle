# Verification Checklist

- [ ] A note created on the main PC appears under `/srv/wiki/vault`.
- [ ] `.obsidian/workspace*` files do not sync to the server vault.
- [ ] `scripts/wiki-conflicts.sh /etc/wiki/wiki.env` reports no conflicts.
- [ ] `scripts/wiki-snapshot.sh /etc/wiki/wiki.env` creates a Git commit when a note changes.
- [ ] `scripts/wiki-build.sh /etc/wiki/wiki.env` creates `/srv/wiki/public/index.html`.
- [ ] The local web server opens the Quartz home page.
- [ ] A wikilink renders as a link in the web wiki.
- [ ] Quartz search can find a known note title.
- [ ] The LLM agent can create a note under `_llm/drafts/`.
- [ ] The LLM agent does not modify human-authored notes without explicit instruction.
