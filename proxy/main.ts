// Fetch proxy for Meta Checker.
//
// The checker runs in the browser, and most sites don't allow cross-origin reads
// of their HTML. This script fetches a URL on the checker's behalf and returns
// a JSON report: status, final URL after redirects, response headers and the
// body. Because the checker gets the target's real headers, it can report CORS
// and Content-Type accurately instead of guessing.
//
// It is deliberately narrow so it can't be used as a general-purpose proxy:
// GET only, public http(s) hosts on standard ports, every redirect re-checked,
// text bodies only, size and time limits, and an optional origin allowlist.

import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.11.2";

const VERSION = "0.2.1";
// Origins allowed to call the proxy from a browser, or "*" for any. Entries can be separated by commas,
// semicolons or whitespace, and are reduced to their origin, so quotes, trailing slashes and paths
// (https://example.github.io/meta-checker/) are all fine.
function parseOrigins(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).map((s) => {
    if (s === "*" || s === "null") return s;
    try {
      return new URL(s).origin;
    } catch {
      return s.replace(/\/+$/, "");
    }
  });
}
const ALLOWED_ORIGINS = parseOrigins(Deno.env.get("ALLOWED_ORIGINS") ?? "*");
const originAllowed = (origin: string | null) => ALLOWED_ORIGINS.includes("*") || (!!origin && ALLOWED_ORIGINS.includes(origin));
const MAX_BYTES = Number(Deno.env.get("MAX_BYTES") ?? 2_000_000);
const TIMEOUT_MS = Number(Deno.env.get("TIMEOUT_MS") ?? 10_000);
const MAX_REDIRECTS = 5;
const USER_AGENT = `MetaChecker/${VERSION} (+https://github.com/rickymoorhouse/meta-checker)`;
// Only these request headers are passed on to the target.
const FORWARD_HEADERS = ["accept", "accept-language"];
const TEXT_TYPES = /^(text\/|application\/(json|[\w.+-]*\+json|xml|[\w.+-]*\+xml|javascript|ld\+json|x-opml)|image\/svg\+xml)/i;

type Report = {
  url: string;
  finalUrl: string;
  status: number;
  redirects: { url: string; status: number; headers: Record<string, string> }[];
  headers: Record<string, string>;
  body: string | null;
  truncated: boolean;
  bodyOmitted?: string;
  elapsedMs: number;
};

class ProxyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Target validation

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

function ipv6Private(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::" || h === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return ipv4Private(mapped[1]);
  return /^(fc|fd|fe[89ab]|ff)/.test(h);
}

const isIp = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":");
const isPrivateIp = (h: string) => h.includes(":") ? ipv6Private(h) : ipv4Private(h);

async function assertPublic(target: URL): Promise<void> {
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new ProxyError("Only http and https URLs can be fetched.");
  if (target.username || target.password) throw new ProxyError("URLs with credentials aren't allowed.");
  if (target.port && target.port !== "80" && target.port !== "443") throw new ProxyError("Only ports 80 and 443 are allowed.");
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) throw new ProxyError("The host must be a public domain name.");
  if (BLOCKED_HOSTS.test(host)) throw new ProxyError("That host isn't public.");
  if (isIp(host)) {
    if (isPrivateIp(host)) throw new ProxyError("Private and reserved addresses can't be fetched.");
    return;
  }
  // Resolve the name too, so a public name pointing at a private address is refused.
  // Not every runtime allows DNS lookups; if it's unavailable, the name checks above still apply.
  try {
    const answers = (await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]))
      .flatMap((r) => r.status === "fulfilled" ? r.value : []);
    if (answers.some(isPrivateIp)) throw new ProxyError("That host resolves to a private address.");
  } catch (e) {
    if (e instanceof ProxyError) throw e;
  }
}

// ---------------------------------------------------------------------------
// Fetching

async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > MAX_BYTES) {
      chunks.push(value.subarray(0, MAX_BYTES - size));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.length; }
  return { text: new TextDecoder().decode(all), truncated };
}

async function inspect(rawUrl: string, incoming: Headers): Promise<Report> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new ProxyError("The url parameter isn't a valid URL.");
  }
  const started = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const headers = new Headers({ "user-agent": USER_AGENT });
  for (const h of FORWARD_HEADERS) {
    const v = incoming.get(`x-forward-${h}`);
    if (v) headers.set(h, v);
  }
  const redirects: Report["redirects"] = [];

  for (let hop = 0; ; hop++) {
    await assertPublic(current);
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", headers, redirect: "manual", signal });
    } catch (e) {
      const msg = (e as Error).name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000} seconds.` : `Couldn't connect: ${(e as Error).message}`;
      throw new ProxyError(msg, 502);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new ProxyError(`More than ${MAX_REDIRECTS} redirects.`, 502);
      // Keep the headers that matter for caching and negotiation on each hop.
      const hopHeaders: Record<string, string> = {};
      for (const h of ["location", "vary", "cache-control", "link", "strict-transport-security"]) {
        const v = res.headers.get(h);
        if (v) hopHeaders[h] = v;
      }
      redirects.push({ url: current.href, status: res.status, headers: hopHeaders });
      current = new URL(location, current);
      continue;
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { if (k !== "set-cookie") responseHeaders[k] = v; });
    const contentType = res.headers.get("content-type") ?? "";
    const report: Report = {
      url: rawUrl,
      finalUrl: current.href,
      status: res.status,
      redirects,
      headers: responseHeaders,
      body: null,
      truncated: false,
      elapsedMs: 0,
    };
    // Bodies without a declared type are read too: misconfigured servers are exactly what the checker reports on.
    if (!contentType || TEXT_TYPES.test(contentType) || /octet-stream/i.test(contentType)) {
      const { text, truncated } = await readCapped(res);
      report.body = text;
      report.truncated = truncated;
    } else {
      await res.body?.cancel();
      report.bodyOmitted = `Not a text response (${contentType}).`;
    }
    report.elapsedMs = Date.now() - started;
    return report;
  }
}

// ---------------------------------------------------------------------------
// HTTP handler

// Rejected origins still get CORS headers on their 403, so the browser can show why it was refused
// instead of a generic network error. Only allowed origins are ever sent fetched content.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowAll = ALLOWED_ORIGINS.includes("*");
  return {
    "access-control-allow-origin": allowAll ? "*" : origin ?? "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "x-forward-accept, x-forward-accept-language",
    "access-control-max-age": "86400",
    ...(allowAll ? {} : { vary: "origin" }),
  };
}

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(req) },
  });
}

async function handler(req: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "GET") return json(req, { error: "Only GET is supported." }, 405);

  const origin = req.headers.get("origin");
  if (origin && !originAllowed(origin)) {
    return json(req, { error: `Origin ${origin} isn't allowed to use this proxy.`, code: "origin_not_allowed", allowedOrigins: ALLOWED_ORIGINS }, 403);
  }

  if (pathname === "/" || pathname === "/health") {
    return json(req, { name: "meta-checker-proxy", version: VERSION, usage: "GET /fetch?url=https://example.com/&accept=text/markdown" });
  }
  if (pathname !== "/fetch") return json(req, { error: "Not found" }, 404);

  const target = searchParams.get("url");
  if (!target) return json(req, { error: "Add a url parameter, for example /fetch?url=https://example.com/." }, 400);
  // `accept` can be passed as a query parameter as well as a header, so simple GETs need no preflight.
  const forwarded = new Headers(req.headers);
  const accept = searchParams.get("accept");
  if (accept) forwarded.set("x-forward-accept", accept);

  try {
    return json(req, await inspect(target, forwarded));
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 500;
    return json(req, { error: (e as Error).message, url: target }, status);
  }
}

// Bunny ignores the listener in production; PORT only matters when running locally.
const port = Deno.env.get("PORT");
if (port) BunnySDK.net.http.serve({ port: Number(port), hostname: "127.0.0.1" }, handler);
else BunnySDK.net.http.serve(handler);
