import Fluent
import Vapor

final class SignalParameters: Model, Content {
    static let schema = "signal_parameters"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "signal_area")
    var signalArea: String

    @Field(key: "amplitude")
    var amplitude: Double

    @Field(key: "frequency")
    var frequency: Double

    @Field(key: "phase")
    var phase: Double

    @Field(key: "modulation_index")
    var modulationIndex: Double?

    @Field(key: "carrier_frequency")
    var carrierFrequency: Double?

    @Field(key: "modulation_frequency")
    var modulationFrequency: Double?

    @Field(key: "pulse_width")
    var pulseWidth: Double?

    @Field(key: "pulse_repetition_frequency")
    var pulseRepetitionFrequency: Double?

    @Field(key: "noise_level")
    var noiseLevel: Double

    @Field(key: "signal_to_noise_ratio")
    var signalToNoiseRatio: Double

    @Field(key: "bandwidth")
    var bandwidth: Double

    @Field(key: "waveform_type")
    var waveformType: String

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
        amplitude: Double,
        frequency: Double,
        phase: Double,
        modulationIndex: Double?,
        carrierFrequency: Double?,
        modulationFrequency: Double?,
        pulseWidth: Double?,
        pulseRepetitionFrequency: Double?,
        noiseLevel: Double,
        signalToNoiseRatio: Double,
        bandwidth: Double,
        waveformType: String,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.signalArea = signalArea
        self.amplitude = amplitude
        self.frequency = frequency
        self.phase = phase
        self.modulationIndex = modulationIndex
        self.carrierFrequency = carrierFrequency
        self.modulationFrequency = modulationFrequency
        self.pulseWidth = pulseWidth
        self.pulseRepetitionFrequency = pulseRepetitionFrequency
        self.noiseLevel = noiseLevel
        self.signalToNoiseRatio = signalToNoiseRatio
        self.bandwidth = bandwidth
        self.waveformType = waveformType
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
