import Dexie, { type Table } from "dexie";
import type {
  CandidateRecord,
  SurveyJobState,
} from "@n-apt/demodulation/survey/audioSurveyModel";

export type AudioSurveyArtifactKind =
  | "summary"
  | "event-clip"
  | "reference-pair"
  | "model";

export interface AudioSurveyArtifactIndex {
  id: string;
  kind: AudioSurveyArtifactKind;
  sizeBytes: number;
  score: number;
  createdAt: number;
}

export interface AudioSurveyArtifact extends AudioSurveyArtifactIndex {
  jobId: string;
  candidateId?: string;
  payload: unknown;
}

export interface AudioSurveyStorageUsage {
  usedBytes: number;
  capBytes: number;
  artifactCount: number;
}

export interface AudioSurveyRepository {
  saveJob(job: SurveyJobState): Promise<void>;
  getJob(jobId: string): Promise<SurveyJobState | undefined>;
  listJobs(): Promise<SurveyJobState[]>;
  saveCandidate(candidate: CandidateRecord): Promise<void>;
  listCandidates(jobId: string): Promise<CandidateRecord[]>;
  saveArtifact(artifact: AudioSurveyArtifact, capBytes: number): Promise<string[]>;
  getArtifact(artifactId: string): Promise<AudioSurveyArtifact | undefined>;
  listArtifacts(jobId?: string): Promise<AudioSurveyArtifact[]>;
  getStorageUsage(capBytes: number): Promise<AudioSurveyStorageUsage>;
}

export interface ArtifactEvictionPlan {
  canFit: boolean;
  evictIds: string[];
}

/** Return the deterministic clip removals needed to fit an incoming artifact. */
export const chooseAudioSurveyArtifactEvictions = (
  artifacts: readonly AudioSurveyArtifactIndex[],
  incomingBytes: number,
  capBytes: number,
): ArtifactEvictionPlan => {
  if (
    !Number.isFinite(incomingBytes) ||
    incomingBytes < 0 ||
    !Number.isFinite(capBytes) ||
    capBytes < 0 ||
    incomingBytes > capBytes
  ) {
    return { canFit: false, evictIds: [] };
  }

  const totalBytes = artifacts.reduce(
    (total, artifact) => total + Math.max(0, artifact.sizeBytes),
    0,
  );
  let bytesToFree = Math.max(0, totalBytes + incomingBytes - capBytes);
  if (bytesToFree === 0) return { canFit: true, evictIds: [] };

  const evictable = artifacts
    .filter(
      (artifact) =>
        artifact.kind === "event-clip" || artifact.kind === "reference-pair",
    )
    .slice()
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );
  const evictIds: string[] = [];
  for (const artifact of evictable) {
    evictIds.push(artifact.id);
    bytesToFree -= Math.max(0, artifact.sizeBytes);
    if (bytesToFree <= 0) return { canFit: true, evictIds };
  }
  return { canFit: false, evictIds: [] };
};

const estimatePayloadBytes = (value: unknown): number => {
  if (value == null) return 0;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + estimatePayloadBytes(entry), 0);
  }
  if (typeof value === "object") {
    return Object.entries(value).reduce(
      (total, [key, entry]) =>
        total + new TextEncoder().encode(key).byteLength + estimatePayloadBytes(entry),
      0,
    );
  }
  return 8;
};

export const estimateAudioSurveyArtifactBytes = (payload: unknown): number =>
  estimatePayloadBytes(payload);

class AudioSurveyDatabase extends Dexie {
  jobs!: Table<SurveyJobState, string>;
  candidates!: Table<CandidateRecord, string>;
  artifacts!: Table<AudioSurveyArtifact, string>;

  constructor() {
    super("napt-audio-survey-v1");
    this.version(1).stores({
      jobs: "id, status, updatedAt",
      candidates: "id, jobId, score, centerHz, lastSeenAt",
      artifacts: "id, jobId, kind, score, createdAt, candidateId",
    });
    this.jobs = this.table("jobs");
    this.candidates = this.table("candidates");
    this.artifacts = this.table("artifacts");
  }
}

const database = typeof indexedDB === "undefined" ? null : new AudioSurveyDatabase();

const requireDatabase = () => {
  if (!database) throw new Error("Audio survey storage requires IndexedDB");
  return database;
};

export const audioSurveyRepository: AudioSurveyRepository = {
  async saveJob(job) {
    await requireDatabase().jobs.put(job);
  },

  async getJob(jobId) {
    return requireDatabase().jobs.get(jobId);
  },

  async listJobs() {
    return requireDatabase().jobs.orderBy("updatedAt").reverse().toArray();
  },

  async saveCandidate(candidate) {
    await requireDatabase().candidates.put(candidate);
  },

  async listCandidates(jobId) {
    return requireDatabase().candidates
      .where("jobId")
      .equals(jobId)
      .sortBy("score")
      .then((candidates) => candidates.reverse());
  },

  async saveArtifact(artifact, capBytes) {
    const db = requireDatabase();
    const sizeBytes = artifact.sizeBytes || estimateAudioSurveyArtifactBytes(artifact.payload);
    const normalizedArtifact = { ...artifact, sizeBytes };

    return db.transaction(
      "rw",
      db.artifacts,
      db.candidates,
      async () => {
        // Replacing a stable checkpoint ID should consume only its new size.
        const existing = (await db.artifacts.toArray()).filter(
          (stored) => stored.id !== normalizedArtifact.id,
        );
        const plan = chooseAudioSurveyArtifactEvictions(
          existing,
          sizeBytes,
          capBytes,
        );
        if (!plan.canFit) {
          throw new Error(
            `Audio survey storage cap reached (${capBytes} bytes); no lower-ranked clips can be pruned`,
          );
        }

        if (plan.evictIds.length > 0) {
          const removed = await db.artifacts.bulkGet(plan.evictIds);
          await db.artifacts.bulkDelete(plan.evictIds);
          const removedByCandidate = new Map<string, Set<string>>();
          for (const artifact of removed) {
            if (!artifact?.candidateId) continue;
            const ids = removedByCandidate.get(artifact.candidateId) ?? new Set();
            ids.add(artifact.id);
            removedByCandidate.set(artifact.candidateId, ids);
          }
          for (const [candidateId, ids] of removedByCandidate) {
            const candidate = await db.candidates.get(candidateId);
            if (!candidate) continue;
            await db.candidates.put({
              ...candidate,
              clipArtifactIds: candidate.clipArtifactIds.filter(
                (id) => !ids.has(id),
              ),
            });
          }
        }

        await db.artifacts.put(normalizedArtifact);
        return plan.evictIds;
      },
    );
  },

  async getArtifact(artifactId) {
    return requireDatabase().artifacts.get(artifactId);
  },

  async listArtifacts(jobId) {
    const table = requireDatabase().artifacts;
    return jobId === undefined
      ? table.toArray()
      : table.where("jobId").equals(jobId).toArray();
  },

  async getStorageUsage(capBytes) {
    const artifacts = await requireDatabase().artifacts.toArray();
    return {
      usedBytes: artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
      capBytes,
      artifactCount: artifacts.length,
    };
  },
};
