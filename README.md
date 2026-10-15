# Meta Checker

A single-file, browser-only checker for how machine-readable a website is. Enter a URL and it returns a checklist and a score.

It runs in one of two modes:

- **Whole site** (the default) checks the home page and one post together. If you enter the home page, it picks the newest post from the feed. If you enter a post, it adds the home page.
- **This page only** checks just the URL you enter. Add `&scope=page` to the address to use it from a link.

Each check is labelled with what it applies to: each page, the post, the home page, or the whole site.

- **Page basics**: title, `lang`, meta description, canonical URL (`<link>` or `Link` header), `rel=me`, image alt text
- **Crawling**: HTTPS redirect, `robots.txt` (sitemap reference, crawlable feeds and Markdown, AI crawler rules and content signals) and the sitemap
- **Feeds**: at least one valid RSS, Atom or JSON Feed, a second format as a bonus, auto-discovery from `<head>` or the `Link` header, and feed quality (dates, absolute links, content, self link, WebSub)
- **Structured data**: schema.org in JSON-LD, Microdata or RDFa; h-entry on posts and h-feed on the home page; the author from an h-card, schema.org, `rel=author` or `<meta name="author">`; Article schema with ISO 8601 dates; a site identity schema on the home page
- **Social previews**: OpenGraph, a share description (`og:description`, or the meta description as a fallback with partial credit) and the Twitter card
- **Social web**: `fediverse:creator`, a Webmention endpoint, `rel=me` profiles that link back, and WebFinger (only scored if present)
- **standard.site**: `/.well-known/site.standard.publication`, the publication record, domain verification through `/.well-known/atproto-did` or a `_atproto` DNS TXT record (matched against the publication's DID), the link tags, and a document record whose URL matches the post
- **SocialSpec**: `/feed.xml` or `/feed.json`, plus `following.opml`, `about.md` and `contact.vcf` (status, Content-Type, CORS, parsing), and `ETag` or `Last-Modified` for conditional requests
- **Consistency**: whether the title, publish date, URL and author agree across `<title>`, OpenGraph, schema.org, h-entry, the Markdown front matter, the standard.site record and the feed items
- **Agent accessibility** (optional, scored separately): a Markdown version (through an alternate link, content negotiation, or both), `Vary: Accept` on negotiated responses, `llms.txt`, an AI catalog whose entries resolve, and an A2A agent card (only scored if present)

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

Required ×3, recommended ×2, nice to have ×1. A warning earns partial credit, usually half, or in proportion to how much is missing. In whole-site mode, a check that runs on each page averages the two results.

The SocialSpec file checks are split: half the credit for the file existing and parsing, a quarter for the Content-Type and a quarter for CORS. An accepted alternative Content-Type, such as legacy `text/x-vcard` or `application/xml` for OPML, earns half the Content-Type credit.

Some checks need the Meta Checker proxy, because a browser can't read the response headers they rely on: the HTTPS redirect, caching validators and `Vary: Accept`. Without the proxy these are skipped.
