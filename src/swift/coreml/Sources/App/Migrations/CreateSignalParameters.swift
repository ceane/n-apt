import Fluent
import Vapor

struct CreateSignalParameters: Migration {
    func prepare(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("signal_parameters")
            .id()
            .field("signal_area", .string, .required)
            .field("amplitude", .double, .required)
            .field("frequency", .double, .required)
            .field("phase", .double, .required)
            .field("modulation_index", .double)
            .field("carrier_frequency", .double)
            .field("modulation_frequency", .double)
            .field("pulse_width", .double)
            .field("pulse_repetition_frequency", .double)
            .field("noise_level", .double, .required)
            .field("signal_to_noise_ratio", .double, .required)
            .field("bandwidth", .double, .required)
            .field("waveform_type", .string, .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("signal_parameters").delete()
    }
}
