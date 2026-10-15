# Meta Checker

A single-file, browser-only checker for how machine-readable a web page is. Enter a URL and it returns a checklist and a score covering:

- **Page basics**: title, `lang`, meta description, canonical URL, `rel=me`
- **Feeds**: auto-discovery, RSS/Atom, JSON Feed
- **Structured data**: h-entry and author h-card, JSON-LD, Article/TechArticle schema
- **Social previews**: OpenGraph and Twitter card
- **standard.site**: `/.well-known/site.standard.publication`, the publication and document records (resolved over AT Protocol), and the link tags
- **SocialSpec**: `/feed.xml` or `/feed.json`, plus `following.opml`, `about.md` and `contact.vcf` (status, Content-Type, CORS, parsing)
- **Agent accessibility** (optional, scored separately): Markdown alternate, `Accept: text/markdown` negotiation, `llms.txt`, AI catalog

Based on [Machine-readable?](https://rickymoorhouse.uk/blog/2026/machine-readability/) and [socialspec.org](https://socialspec.org).

## Usage

Live at https://rickymoorhouse.github.io/meta-checker/.

After a check, **Copy fix prompt for an agent** copies a prompt for a coding agent working in the site's repository. It lists every failing or warning item with what was found, the fix and spec references. Fixes for templates and content are listed separately from those that need server or CDN config, such as Content-Type, CORS and content negotiation.

Open `index.html` in a browser, or host it anywhere static (for example GitHub Pages). To run a check on load, add `?url=https://example.com/post/` to the page address.

## CORS and the proxy

Everything runs client-side. Each request is tried directly first. If the browser blocks it, the request is retried through a proxy, set under *Fetching options* or through `DEFAULT_PROXY` in `index.html`:

- **The Meta Checker proxy** (`proxy/`, for Bunny Edge Scripting). Enter its base URL. It returns the target's real status and headers, so CORS (`Access-Control-Allow-Origin`) and Content-Type are reported accurately, and the `Accept: text/markdown` negotiation check works. See [proxy/README.md](proxy/README.md).
- **A generic CORS proxy.** Enter a URL template containing `{url}`. Free public proxies are unreliable, and their headers may not be the target's.

If neither works, paste the page's HTML into *Fetching options* to run the HTML checks. Checks that can't be run are marked as skipped and left out of the score. SocialSpec files must allow CORS, so a file browsers can't read loses points.

## Scoring

Required ×3, recommended ×2, nice to have ×1. A warning earns half credit. The SocialSpec file checks give partial credit: half for the file existing and parsing, a quarter for the correct Content-Type and a quarter for CORS.
