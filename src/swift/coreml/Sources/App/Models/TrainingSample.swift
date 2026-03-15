import Fluent
import Vapor

final class TrainingSample: Model, Content {
    static let schema = "training_samples"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "signal_area")
    var signalArea: String

    @Field(key: "label")
    var label: String

    @Field(key: "data")
    var data: [Float]

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
        label: String,
        data: [Float],
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.signalArea = signalArea
        self.label = label
        self.data = data
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
