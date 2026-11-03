// Fetches a university's official programme page for the importer. Pages are untrusted input:
// only public http(s) hosts are allowed (no internal/private networks), redirects are re-checked,
// size and time are capped, and the HTML is reduced to plain text before anything reads it.

import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 120_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

export class PageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageFetchError";
  }
}

export interface OfficialPage {
  url: string; // final URL after redirects
  kind: "html" | "pdf" | "text";
  text: string; // readable text (empty for PDFs)
  bytes?: Buffer; // PDFs only, for the AI to read directly
  title?: string;
}

function privateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIPv4(mapped[1]);
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

/** Rejects anything that is not a public http(s) URL. Resolves the host so internal names cannot slip through. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new PageFetchError(`Not a valid web address: ${raw.slice(0, 120)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PageFetchError("Only http(s) web pages can be imported.");
  if (u.username || u.password) throw new PageFetchError("Web addresses with a login inside them are not allowed.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new PageFetchError("Only standard web ports are allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new PageFetchError("Internal addresses cannot be imported.");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new PageFetchError(`Could not find the website ${host}.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new PageFetchError("Internal addresses cannot be imported.");
  return u;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", deg: "°", eacute: "é", egrave: "è", agrave: "à", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML -> readable text: drops scripts, styles and navigation chrome, keeps headings, lists and table rows. */
export function htmlToText(html: string): { text: string; title?: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim() || undefined;
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, " ");
  s = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*(td|th)\b[^>]*>/gi, " | ")
    .replace(/<\s*li\b[^>]*>/gi, "\n• ")
    .replace(/<\s*\/?\s*(p|div|section|article|main|header|h[1-6]|tr|table|ul|ol|dl|dt|dd|blockquote|details|summary)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: s.slice(0, MAX_TEXT), title };
}

const FOCUS_MAX = 30_000;
const FOCUS_WORDS = /entry|requirement|admission|eligib|ielts|toefl|pte|duolingo|english|language|cgpa|gpa|grade|degree|2:1|2:2|honours|pakistan|international|overseas|fee|tuition|£|€|\$|cost|duration|full[- ]time|part[- ]time|year|month|start|intake|semester|september|january|deadline|apply|application|close|german|italian|french|a1|a2|b1|b2|c1|moi|instruction/i;

/**
 * Keeps an AI call small (and the free quota intact): the opening of the page plus every line that
 * talks about requirements, fees, English, dates or deadlines, with a little context around each.
 */
export function focusPage<T extends Pick<OfficialPage, "text">>(page: T): T {
  if (page.text.length <= FOCUS_MAX) return page;
  const lines = page.text.split("\n");
  const keep = new Set<number>();
  lines.slice(0, 40).forEach((_, i) => keep.add(i));
  lines.forEach((l, i) => {
    if (FOCUS_WORDS.test(l)) for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 2); k++) keep.add(k);
  });
  let out = "";
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const chunk = (prev >= 0 && i !== prev + 1 ? "\n…\n" : prev >= 0 ? "\n" : "") + lines[i];
    if (out.length + chunk.length > FOCUS_MAX) break;
    out += chunk;
    prev = i;
  }
  return { ...page, text: out };
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new PageFetchError("That page is too large to read (over 3 MB).");
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new PageFetchError("That page is too large to read (over 3 MB).");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function fetchOfficialPage(raw: string): Promise<OfficialPage> {
  let url = await assertPublicUrl(raw);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "user-agent": "VisaGuard programme importer (+https://visaguard.app)", accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.8,*/*;q=0.5", "accept-language": "en" },
        });
      } catch (e) {
        throw new PageFetchError(ctrl.signal.aborted ? `${url.hostname} took too long to respond.` : `Could not reach ${url.hostname}.`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new PageFetchError("Too many redirects.");
        url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new PageFetchError(`${url.hostname} refused the request (HTTP ${res.status}). Download the page or PDF and use another official link.`);
      if (!res.ok) throw new PageFetchError(`${url.hostname} answered HTTP ${res.status} for this page.`);
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      const body = await readCapped(res);
      if (type.includes("application/pdf") || body.subarray(0, 5).toString("latin1") === "%PDF-") return { url: url.toString(), kind: "pdf", text: "", bytes: body };
      if (type.includes("text/plain")) return { url: url.toString(), kind: "text", text: body.toString("utf8").slice(0, MAX_TEXT) };
      if (!type.includes("html") && !type.includes("xml") && type) throw new PageFetchError(`That link is not a web page or PDF (${type.split(";")[0]}).`);
      const { text, title } = htmlToText(body.toString("utf8"));
      return { url: url.toString(), kind: "html", text, title };
    }
  } finally {
    clearTimeout(timer);
  }
}
