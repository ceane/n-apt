const MAX_NAPT_HEADER_BYTES = 64 * 1024 * 1024;

/** Parse the public JSON header used by padded NAPT containers. */
export const parseNaptHeader = (bytes: Uint8Array): Record<string, unknown> => {
  const headerBytes = bytes.subarray(
    0,
    Math.min(bytes.byteLength, MAX_NAPT_HEADER_BYTES),
  );
  const newlineIndex = headerBytes.indexOf(10);
  if (newlineIndex > 0) {
    try {
      return JSON.parse(
        new TextDecoder().decode(headerBytes.subarray(0, newlineIndex)),
      ) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid NAPT header");
    }
  }

  const headerText = new TextDecoder().decode(headerBytes);
  let braceDepth = 0;
  let inString = false;
  let escape = false;
  let jsonEnd = -1;
  for (let index = 0; index < headerText.length; index += 1) {
    const character = headerText[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (character === "\\") {
      escape = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "{") braceDepth += 1;
    if (character === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        jsonEnd = index + 1;
        break;
      }
    }
  }
  if (jsonEnd <= 0) throw new Error("Invalid NAPT header");
  try {
    return JSON.parse(headerText.slice(0, jsonEnd)) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid NAPT header");
  }
};

export const parseNaptMetadata = (
  bytes: Uint8Array,
): Record<string, unknown> => {
  const root = parseNaptHeader(bytes);
  const metadata = root.metadata;
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : root;
};
