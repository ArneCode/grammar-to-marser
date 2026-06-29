import LZString from "lz-string";

const HASH_PREFIX = "#s=";

export function encodeShareState({ pest, entryRule }) {
  const json = JSON.stringify({ pest, entryRule });
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
    if (typeof data.pest !== "string") return null;
    return {
      pest: data.pest,
      entryRule: typeof data.entryRule === "string" ? data.entryRule : "",
    };
  } catch {
    return null;
  }
}

export function currentShareHash({ pest, entryRule }) {
  return encodeShareState({ pest, entryRule });
}

export function shareUrl({ pest, entryRule }) {
  const base = window.location.href.split("#")[0];
  return base + encodeShareState({ pest, entryRule });
}
