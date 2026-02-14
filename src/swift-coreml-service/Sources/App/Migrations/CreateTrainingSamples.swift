import Fluent

struct CreateTrainingSamples: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("training_samples")
            .id()
            .field("signal_area", .string, .required)
            .field("label", .string, .required)
            .field("data", .array(of: .float), .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("training_samples").delete()
    }
}
