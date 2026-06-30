import LZString from "lz-string";

const HASH_PREFIX = "#s=";

export function encodeShareState({ source, entryRule, syntax = "pest" }) {
  const json = JSON.stringify({ source, entryRule, syntax });
  return HASH_PREFIX + LZString.compressToEncodedURIComponent(json);
}

export function decodeShareState(hash) {
  if (!hash || !hash.startsWith(HASH_PREFIX)) {
    return null;
  }
  const compressed = hash.slice(HASH_PREFIX.length);
  const json = LZString.decompressFromEncodedURIComponent(compressed);
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    if (typeof data.source !== "string") return null;
    return {
      source: data.source,
      entryRule: typeof data.entryRule === "string" ? data.entryRule : "",
      syntax: typeof data.syntax === "string" ? data.syntax : "pest",
    };
  } catch {
    return null;
  }
}

export function currentShareHash({ source, entryRule, syntax }) {
  return encodeShareState({ source, entryRule, syntax });
}

export function shareUrl({ source, entryRule, syntax }) {
  const base = window.location.href.split("#")[0];
  return base + encodeShareState({ source, entryRule, syntax });
}
