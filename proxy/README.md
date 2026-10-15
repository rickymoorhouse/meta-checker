# Meta Checker proxy

A small fetch proxy for Meta Checker, built to run on [Bunny Edge Scripting](https://docs.bunny.net/docs/edge-scripting-overview). The checker runs in the browser, and most sites don't let other origins read their HTML. This script fetches the page for the checker and returns a JSON report, so the checker can see the target's real response headers.

```
GET /fetch?url=https://example.com/&accept=text/markdown
```

```json
{
  "url": "https://example.com/",
  "finalUrl": "https://example.com/index.md",
  "status": 200,
  "redirects": [{ "url": "https://example.com/", "status": 301, "headers": { "location": "/index.md", "vary": "Accept" } }],
  "headers": { "content-type": "text/markdown", "access-control-allow-origin": "*" },
  "body": "…",
  "truncated": false,
  "elapsedMs": 180
}
```

`GET /` returns the name and version. Errors come back as `{ "error": "…" }` with a 4xx status for bad or disallowed targets, and 502 if the target can't be reached.

## Limits

The proxy is narrow on purpose, so it can't be used as an open relay:

- GET only. Only the `accept` value (query parameter or `x-forward-accept` header) and `x-forward-accept-language` are passed on. Cookies and auth headers are never sent, and `set-cookie` is removed from responses.
- Only http and https, on ports 80 and 443, with no credentials in the URL.
- No localhost, `.local` or `.internal` names, and no private, loopback, link-local (including cloud metadata), CGNAT or multicast addresses. Hostnames are resolved, and the request is refused if any address is private.
- Redirects are followed by hand, up to 5, and each hop is checked again.
- Text bodies only (HTML, XML, JSON, Markdown, vCard, OPML and so on), capped at `MAX_BYTES`. For other types, the report includes the headers but no body.
- The request times out after `TIMEOUT_MS`.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `*` | Origins allowed to call the proxy from a browser, such as `https://rickymoorhouse.github.io,https://rickymoorhouse.uk`. Separate entries with commas, semicolons or spaces. Each entry is reduced to its origin, so quotes, trailing slashes and paths are ignored, and a bare hostname means its `https://` origin. Requests from any other origin get a 403 that names the allowed origins, with CORS headers so the checker can show it. |
| `MAX_BYTES` | `2000000` | Maximum body size returned |
| `TIMEOUT_MS` | `10000` | Total time allowed for the fetch, including redirects |
| `PORT` | unset | Local runs only; Bunny ignores it |

Once the checker has a permanent home, set `ALLOWED_ORIGINS` to it. For extra protection, add a rate limit in the pull zone's Bunny Shield settings.

## Running locally

```bash
cd proxy
PORT=8767 deno task dev
curl -s 'http://127.0.0.1:8767/fetch?url=https://rickymoorhouse.uk/llms.txt' | jq '.status, .headers["content-type"]'
```

Then enter `http://127.0.0.1:8767` as the proxy under *Fetching options* in the checker.

## Deploying to Bunny Edge Scripting

1. In the Bunny dashboard, go to Edge Platform → Scripts → Add script, and choose a Standalone script.
2. Set `ALLOWED_ORIGINS` if you want to restrict which origins can use it.
3. Optionally, add a custom hostname such as `meta-proxy.rickymoorhouse.uk`.
4. To deploy from GitHub, set the repository variable `BUNNY_PROXY_SCRIPT_ID` to the script's ID. `.github/workflows/deploy-proxy.yml` then publishes `proxy/main.ts` whenever anything under `proxy/` changes on `main`.
5. Put the script's URL in `DEFAULT_PROXY` near the top of the script in `index.html`, so the checker uses it by default. The live proxy is `https://meta-checker-proxy-y667o.bunny.run`.
