import Fluent
import Vapor

final class DecodedSignal: Model, Content {
    static let schema = "decoded_signals"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "signal_area")
    var signalArea: String

    @Field(key: "original_data")
    var originalData: [Float]

    @Field(key: "decoded_features")
    var decodedFeatures: [String: Double]

    @Field(key: "prediction")
    var prediction: String

    @Field(key: "confidence")
    var confidence: Double

    @Field(key: "processing_time_ms")
    var processingTimeMs: Double

    @Field(key: "frequency_min")
    var frequencyMin: Double

    @Field(key: "frequency_max")
    var frequencyMax: Double

    @Field(key: "sample_rate")
    var sampleRate: Int

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    init() {}

    init(
        id: UUID? = nil,
        signalArea: String,
        originalData: [Float],
        decodedFeatures: [String: Double],
        prediction: String,
        confidence: Double,
        processingTimeMs: Double,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.signalArea = signalArea
        self.originalData = originalData
        self.decodedFeatures = decodedFeatures
        self.prediction = prediction
        self.confidence = confidence
        self.processingTimeMs = processingTimeMs
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
