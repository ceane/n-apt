import {
  visionIdSchema,
  visionPairSchema,
  type VisionPair,
} from "./visionModel";

/** Server owns encryption, salts, and immutable storage; no browser persistence. */
export async function saveVisionPair(
  pair: VisionPair,
  sessionToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const authorization = sessionAuthorization(sessionToken);
  const validated = visionPairSchema.parse(pair);
  const response = await fetcher(
    `/api/vision/references/${validated.config.trialId}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(validated),
    },
  );
  if (!response.ok)
    throw new Error(`Vision reference save failed (${response.status})`);
}
export async function loadVisionPair(
  trialId: string,
  sessionToken: string,
  fetcher: typeof fetch = fetch,
): Promise<VisionPair> {
  const authorization = sessionAuthorization(sessionToken);
  const response = await fetcher(
    `/api/vision/references/${visionIdSchema.parse(trialId)}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Authorization: authorization },
    },
  );
  if (!response.ok)
    throw new Error(`Vision reference load failed (${response.status})`);
  const pair = visionPairSchema.parse(await response.json());
  if (pair.config.trialId !== trialId)
    throw new Error("Vision reference identity mismatch");
  return pair;
}

function sessionAuthorization(token: string): string {
  if (!token || /[\s\r\n]/.test(token))
    throw new Error("A valid session token is required");
  return `Bearer ${token}`;
}
