import Foundation
import Fluent

/// Manages the training pipeline: sample collection, model training, and versioning.
///
/// Currently a placeholder — CoreML training integration will be added
/// once the data collection pipeline is validated end-to-end.
class TrainingService {
    let classifier = SignalClassifier()

    /// Check if there are enough samples to begin training.
    func canTrain(on database: Database) async throws -> Bool {
        let targetCount = try await TrainingSample.query(on: database)
            .filter(\.$label == "target").count()
        let noiseCount = try await TrainingSample.query(on: database)
            .filter(\.$label == "noise").count()

        // Require at least 10 samples of each class
        return targetCount >= 10 && noiseCount >= 10
    }

    /// Placeholder for triggering model training.
    func startTraining(on database: Database) async throws {
        guard try await canTrain(on: database) else {
            return
        }

        // TODO: Fetch all samples, create spectrogram inputs, train CoreML model
        // This will use CreateML or a custom training pipeline
    }
}
