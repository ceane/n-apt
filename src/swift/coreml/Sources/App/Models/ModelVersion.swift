import Fluent
import Vapor

final class ModelVersion: Model, Content {
    static let schema = "model_versions"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "version")
    var version: String

    @OptionalField(key: "accuracy")
    var accuracy: Double?

    @OptionalField(key: "precision_target")
    var precisionTarget: Double?

    @OptionalField(key: "precision_noise")
    var precisionNoise: Double?

    @OptionalField(key: "recall_target")
    var recallTarget: Double?

    @OptionalField(key: "recall_noise")
    var recallNoise: Double?

    @OptionalField(key: "training_samples_count")
    var trainingSamplesCount: Int?

    @Field(key: "is_active")
    var isActive: Bool

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    init() {}

    init(
        id: UUID? = nil,
        version: String,
        accuracy: Double? = nil,
        isActive: Bool = false
    ) {
        self.id = id
        self.version = version
        self.accuracy = accuracy
        self.isActive = isActive
    }
}
