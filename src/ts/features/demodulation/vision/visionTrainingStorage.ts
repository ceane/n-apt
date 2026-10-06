import Dexie, { type Table } from "dexie";
import type {
  VisionTrainingCheckpoint,
  VisionTrainingRepository,
} from "./visionTraining";

interface StoredVisionCheckpoint {
  jobId: string;
  savedAt: number;
  status: VisionTrainingCheckpoint["state"]["status"];
  checkpoint: VisionTrainingCheckpoint;
}

class VisionTrainingDatabase extends Dexie {
  checkpoints!: Table<StoredVisionCheckpoint, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      checkpoints: "jobId, savedAt, status",
    });
    this.checkpoints = this.table("checkpoints");
  }
}

/**
 * Browser-local, resumable checkpoint storage. Only model weights, run
 * configuration, source checksums and evaluation metrics are written here;
 * feature windows, labels, and raw I/Q remain in the caller's memory.
 */
export function createVisionTrainingRepository(
  databaseName = "napt-vision-training-v1",
): VisionTrainingRepository {
  let database: VisionTrainingDatabase | null = null;
  const getDatabase = () => {
    if (typeof indexedDB === "undefined")
      throw new Error("Vision training checkpoint storage requires IndexedDB");
    database ??= new VisionTrainingDatabase(databaseName);
    return database;
  };
  return {
    async load(jobId) {
      const record = await getDatabase().checkpoints.get(jobId);
      return record?.checkpoint ?? null;
    },
    async save(checkpoint) {
      if (checkpoint.jobId.length > 96)
        throw new Error("Vision training checkpoint id is invalid");
      await getDatabase().checkpoints.put({
        jobId: checkpoint.jobId,
        savedAt: checkpoint.state.updatedAt,
        status: checkpoint.state.status,
        checkpoint,
      });
    },
  };
}

export const visionTrainingRepository = createVisionTrainingRepository();
