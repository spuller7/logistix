# Examples

Illustrative discovery files for a reference seller (Open Gate) and a generic in-memory mount. URLs use `tickets.example.com`. This directory is not the Open Gate application.

| Path | What it is |
|------|------------|
| `well-known/linguistix.json` | Example `/.well-known/linguistix.json` for Open Gate |
| `llms.txt` | Example site index that points agents at that document |
| `event-page.html` | Event page linking the discovery document and an event id |
| `seller-stub/` | Generic adapter + handler + discovery builder |

The OpenAPI description agents follow is `openapi/linguistix.openapi.yaml`. Sellers host a copy at the URL in `api.openapi`.
