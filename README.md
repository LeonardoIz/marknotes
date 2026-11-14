# marknotes

A small self-hosted notes app. Notes are plain Markdown files in folders, so you can edit them from anywhere; the app adds rich rendering, wikilinks and backlinks, tags, search (also by meaning), and an MCP server so AI agents can read and write them.

## Run

```bash
mkdir -p data
curl -O https://raw.githubusercontent.com/LeonardoIz/marknotes/main/compose.yaml
docker compose up -d        # http://localhost:3000
docker compose logs         # the setup code
```

The first start opens a setup screen. Enter the code from the log, then choose how to sign in (username and password, single sign-on with any OpenID Connect provider, or off) and whether agents may connect. All of it can be changed later in Settings.

Notes are stored in `./data` as `.md` files. The app's own state lives in `./data/.notes`. Compose runs as uid 1000 so the files stay yours; set `NOTES_UID`/`NOTES_GID` if your user is different.

| Variable              | Default  | Meaning                                                              |
| --------------------- | -------- | -------------------------------------------------------------------- |
| `NOTES_PATH`          | `./data` | Notes folder (`/data` in the image)                                  |
| `NOTES_URL`           | (none)   | Public address, needed behind a proxy without `X-Forwarded-*` headers |
| `NOTES_MAX_UPLOAD_MB` | `25`     | Attachment size limit                                                |

Locked out? Create an empty file `data/.notes/reset-access` and setup runs again. Your notes are kept.

Docker tags use the version in `package.json` (for example, `:0.1.0`). `:latest` always points to the highest published version. Pushes to `main` publish images; rebuilding the same version replaces its previous image. To rebuild an older release, run CI manually against its Git tag (`0.1.0`, etc.).

## Agents (MCP)

Turn agents on in Settings. Then point your agent at `/api/mcp`. Agents sign in with OAuth through your browser, or with a token you create in Settings.

```bash
claude mcp add --transport http marknotes http://localhost:3000/api/mcp
```

## Develop

```bash
npm install
npm run dev     # http://localhost:3000
npm test && npm run lint && npx tsc --noEmit
```

[docs/markdown-showcase.md](docs/markdown-showcase.md) shows all the supported Markdown.
