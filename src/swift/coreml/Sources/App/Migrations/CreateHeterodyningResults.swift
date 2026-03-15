import Fluent
import Vapor

struct CreateHeterodyningResults: Migration {
    func prepare(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("heterodyning_results")
            .id()
            .field("signal_area", .string, .required)
            .field("is_heterodyning_detected", .bool, .required)
            .field("confidence", .double, .required)
            .field("carrier_frequencies", .array(of: .double), .required)
            .field("intermediate_frequency", .double)
            .field("modulation_type", .string)
            .field("frequency_features", .dictionary(of: .double), .required)
            .field("processing_time_ms", .double, .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("heterodyning_results").delete()
    }
}
