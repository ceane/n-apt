import Fluent
import Vapor

final class ClassificationResult: Model, Content {
    static let schema = "classification_results"

    @ID(key: .id)
    var id: UUID?

    @OptionalParent(key: "sample_id")
    var sample: TrainingSample?

    @Field(key: "prediction")
    var prediction: String

    @Field(key: "confidence")
    var confidence: Double

    @OptionalField(key: "processing_time_ms")
    var processingTimeMs: Double?

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    init() {}

    init(
        id: UUID? = nil,
        sampleID: UUID? = nil,
        prediction: String,
        confidence: Double,
        processingTimeMs: Double? = nil
    ) {
        self.id = id
        self.$sample.id = sampleID
        self.prediction = prediction
        self.confidence = confidence
        self.processingTimeMs = processingTimeMs
    }
}
