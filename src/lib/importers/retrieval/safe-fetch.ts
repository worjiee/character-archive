import dns from "node:dns/promises";
import net from "node:net";

export const DEFAULT_SAFE_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_SAFE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_SAFE_FETCH_MAX_REDIRECTS = 3;

export interface SafeFetchOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedHosts: readonly string[];
  expectedMimeTypes: readonly string[];
  followRedirects?: boolean;
  lookup?: HostnameLookup;
}

export type HostnameLookup = (hostname: string) => Promise<readonly string[]>;

export class SafeFetchError extends Error {
  readonly code:
    | "INVALID_URL"
    | "UNSUPPORTED_SCHEME"
    | "EMBEDDED_CREDENTIALS"
    | "HOST_NOT_ALLOWED"
    | "PRIVATE_DESTINATION"
    | "REDIRECT_LIMIT"
    | "INVALID_REDIRECT"
    | "TIMEOUT"
    | "RESPONSE_TOO_LARGE"
    | "UNEXPECTED_MIME";

  constructor(code: SafeFetchError["code"], message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export interface SafeFetchResult {
  response: Response;
  body: string;
}

export async function safeFetchText(
  input: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SAFE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_SAFE_FETCH_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_SAFE_FETCH_MAX_REDIRECTS;
  const lookup = options.lookup ?? defaultLookup;
  let current = validateUrl(input, options.allowedHosts);

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await validateDestination(current, lookup, options.allowedHosts);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SafeFetchError("TIMEOUT", "The source request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abort);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SafeFetchError("INVALID_REDIRECT", "The source returned an invalid redirect.");
      if (redirect === maxRedirects) throw new SafeFetchError("REDIRECT_LIMIT", "The source exceeded the redirect limit.");
      try {
        current = validateUrl(new URL(location, current).toString(), options.allowedHosts);
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError("INVALID_REDIRECT", "The source returned an invalid redirect.");
      }
      await validateDestination(current, lookup, options.allowedHosts);
      if (options.followRedirects === false) return { response, body: "" };
      continue;
    }

    if (response.status === 200) {
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!options.expectedMimeTypes.some((mime) => contentType === mime || contentType.endsWith(`+${mime.replace(/^.*\//, "")}`))) {
        throw new SafeFetchError("UNEXPECTED_MIME", "The source returned an unsupported content type.");
      }
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength && Number.isFinite(Number(declaredLength)) && Number(declaredLength) > maxBytes) {
      throw new SafeFetchError("RESPONSE_TOO_LARGE", "The source response exceeds the size limit.");
    }
    const body = await readBoundedBody(response, maxBytes);
    return { response, body };
  }

  throw new SafeFetchError("REDIRECT_LIMIT", "The source exceeded the redirect limit.");
}

function validateUrl(input: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("INVALID_URL", "Enter a valid source URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("UNSUPPORTED_SCHEME", "Only HTTP and HTTPS source URLs are supported.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("EMBEDDED_CREDENTIALS", "Source URLs cannot contain embedded credentials.");
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new SafeFetchError("HOST_NOT_ALLOWED", "This source host is not supported.");
  }
  return url;
}

async function validateDestination(url: URL, lookup: HostnameLookup, allowedHosts: readonly string[]): Promise<void> {
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new SafeFetchError("HOST_NOT_ALLOWED", "Redirect destination is not supported.");
  }
  const addresses = net.isIP(url.hostname) ? [url.hostname] : await lookup(url.hostname);
  if (addresses.length === 0 || addresses.some(isForbiddenAddress)) {
    throw new SafeFetchError("PRIVATE_DESTINATION", "The source destination is not publicly reachable.");
  }
}

async function defaultLookup(hostname: string): Promise<readonly string[]> {
  return (await dns.lookup(hostname, { all: true })).map(({ address }) => address);
}

function isForbiddenAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "0.0.0.0" || normalized === "169.254.169.254" || normalized === "100.100.100.200") return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a >= 224 && a <= 255);
  }
  if (net.isIPv6(address)) {
    const value = normalized.replace(/^\[|\]$/g, "");
    if (value.startsWith("::ffff:")) return isForbiddenAddress(value.slice("::ffff:".length));
    return value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff") || value.startsWith("2001:db8:");
  }
  return true;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new SafeFetchError("RESPONSE_TOO_LARGE", "The source response exceeds the size limit.");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
