import {
  index,
  layout,
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

// Incremental adoption boundary: the Framework router owns the document,
// discovery manifest, and history while the existing route tree continues to
// own feature behavior. Individual routes can move out of this bridge without
// changing authentication or streaming ownership.
export default [
  layout("./app/routes/PublicRouteLayout.tsx", [
    route("learn", "./app/routes/LearnSignalsRoute.tsx", {
      id: "learn-signals",
    }),
    route("learn/:id", "./app/routes/LearnSignalsRoute.tsx", {
      id: "learn-signals-section",
    }),
    route("terms", "./app/routes/LegalDocumentRoute.tsx", { id: "terms" }),
    route("privacy", "./app/routes/LegalDocumentRoute.tsx", { id: "privacy" }),
    route("license", "./app/routes/LegalDocumentRoute.tsx", { id: "license" }),
    route("responsible-use", "./app/routes/LegalDocumentRoute.tsx", {
      id: "responsible-use",
    }),
  ]),
  layout("./app/routes/AuthenticatedRouteLayout.tsx", [
    route("auth", "./app/routes/FullApplicationRoute.tsx", { id: "auth" }),
    route("get-started", "./app/routes/GetStartedRoute.tsx"),
    index("./app/routes/FullApplicationRoute.tsx", { id: "index" }),
    route("visualizer", "./app/routes/FullApplicationRoute.tsx", {
      id: "visualizer",
    }),
    route("demodulate", "./app/routes/FullApplicationRoute.tsx", {
      id: "demodulate",
    }),
    route("demod", "./app/routes/FullApplicationRoute.tsx", { id: "demod" }),
    route("settings", "./app/routes/FullApplicationRoute.tsx", {
      id: "settings",
    }),
    route("draw-signal", "./app/routes/FullApplicationRoute.tsx", {
      id: "draw-signal",
    }),
    route("3d-model", "./app/routes/FullApplicationRoute.tsx", {
      id: "3d-model",
    }),
    route("3d-model-gallery", "./app/routes/FullApplicationRoute.tsx", {
      id: "3d-model-gallery",
    }),
    route("map-endpoints", "./app/routes/FullApplicationRoute.tsx", {
      id: "map-endpoints",
    }),
    route("diagnostics/anti-aliasing", "./app/routes/FullApplicationRoute.tsx", {
      id: "anti-aliasing",
    }),
    route("pretext-demo", "./app/routes/FullApplicationRoute.tsx", {
      id: "pretext-demo",
    }),
    route("vfo-grid-demo", "./app/routes/FullApplicationRoute.tsx", {
      id: "vfo-grid-demo",
    }),
    route("transformers", "./app/routes/FullApplicationRoute.tsx", {
      id: "transformers",
    }),
    route("game", "./app/routes/FullApplicationRoute.tsx", { id: "game" }),
    route("questionnaire", "./app/routes/QuestionnaireRoute.tsx"),
    route("x-archive-formatter", "./app/routes/XArchiveFormatterRoute.tsx"),
  ]),
  route("*", "./app/routes/NotFoundRoute.tsx"),
] satisfies RouteConfig;
