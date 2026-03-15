import Vapor
import Fluent
import FluentPostgresDriver

public func configure(_ app: Application) throws {
    // Database configuration
    app.databases.use(
        .postgres(
            hostname: Environment.get("DATABASE_HOST") ?? "localhost",
            port: Environment.get("DATABASE_PORT").flatMap(Int.init) ?? 5432,
            username: Environment.get("DATABASE_USERNAME") ?? "n_apt",
            password: Environment.get("DATABASE_PASSWORD") ?? "n_apt_dev",
            database: Environment.get("DATABASE_NAME") ?? "n_apt_coreml"
        ),
        as: .psql
    )

    // Migrations
    app.migrations.add(CreateTrainingSamples())
    app.migrations.add(CreateModelVersions())
    app.migrations.add(CreateClassificationResults())
    app.migrations.add(CreateDecodedSignals())
    app.migrations.add(CreateSignalFeatures())
    app.migrations.add(CreateHeterodyningResults())
    app.migrations.add(CreateFrequencyFeatures())
    app.migrations.add(CreateRecreatedSignals())
    app.migrations.add(CreateSignalParameters())

    // Run migrations on startup
    try app.autoMigrate().wait()

    // Routes
    try routes(app)
}
