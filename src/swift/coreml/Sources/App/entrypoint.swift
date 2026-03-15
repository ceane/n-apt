import Vapor

@main
enum Entrypoint {
    static func main() async throws {
        var env = try Environment.detect()
        try LoggingSystem.bootstrap(from: &env)
        let app = Application(env)
        defer { app.shutdown() }

        app.http.server.configuration.hostname = "127.0.0.1"
        app.http.server.configuration.port = 8081

        try configure(app)
        try app.run()
    }
}
