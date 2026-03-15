import Fluent
import Vapor

struct CreateRecreatedSignals: Migration {
    func prepare(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("recreated_signals")
            .id()
            .field("original_signal_id", .uuid)
            .field("signal_parameters", .dictionary(of: .double), .required)
            .field("waveform_pattern", .array(of: .float), .required)
            .field("recreation_quality_score", .double, .required)
            .field("parameter_estimates", .dictionary(of: .double), .required)
            .field("analysis_confidence", .double, .required)
            .field("processing_time_ms", .double, .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("recreated_signals").delete()
    }
}
