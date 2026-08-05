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
  layout("./framework/PublicRouteLayout.tsx", [
    route("learn-signals", "./framework/LearnSignalsRoute.tsx", {
      id: "learn-signals",
    }),
    route("learn-signals/:sectionSlug", "./framework/LearnSignalsRoute.tsx", {
      id: "learn-signals-section",
    }),
    route("terms", "./framework/LegalDocumentRoute.tsx", { id: "terms" }),
    route("privacy", "./framework/LegalDocumentRoute.tsx", { id: "privacy" }),
    route("license", "./framework/LegalDocumentRoute.tsx", { id: "license" }),
    route("responsible-use", "./framework/LegalDocumentRoute.tsx", {
      id: "responsible-use",
    }),
    route("faq", "./framework/LegacyRedirectRoute.tsx", { id: "faq" }),
    route("faq/iq-captures", "./framework/LegacyRedirectRoute.tsx", {
      id: "faq-iq-captures",
    }),
    route("iq-captures", "./framework/LegacyRedirectRoute.tsx", {
      id: "iq-captures",
    }),
    route("faq/fft-ifft", "./framework/LegacyRedirectRoute.tsx", {
      id: "faq-fft-ifft",
    }),
    route("fft-ifft", "./framework/LegacyRedirectRoute.tsx", {
      id: "fft-ifft",
    }),
  ]),
  layout("./framework/AuthenticatedRouteLayout.tsx", [
    route("auth", "./framework/FullApplicationRoute.tsx", { id: "auth" }),
    route("get-started", "./framework/GetStartedRoute.tsx"),
    index("./framework/FullApplicationRoute.tsx", { id: "index" }),
    route("visualizer", "./framework/FullApplicationRoute.tsx", {
      id: "visualizer",
    }),
    route("demodulate", "./framework/FullApplicationRoute.tsx", {
      id: "demodulate",
    }),
    route("demod", "./framework/FullApplicationRoute.tsx", { id: "demod" }),
    route("settings", "./framework/FullApplicationRoute.tsx", {
      id: "settings",
    }),
    route("draw-signal", "./framework/FullApplicationRoute.tsx", {
      id: "draw-signal",
    }),
    route("3d-model", "./framework/FullApplicationRoute.tsx", {
      id: "3d-model",
    }),
    route("3d-model-gallery", "./framework/FullApplicationRoute.tsx", {
      id: "3d-model-gallery",
    }),
    route("map-endpoints", "./framework/FullApplicationRoute.tsx", {
      id: "map-endpoints",
    }),
    route("diagnostics/anti-aliasing", "./framework/FullApplicationRoute.tsx", {
      id: "anti-aliasing",
    }),
    route("pretext-demo", "./framework/FullApplicationRoute.tsx", {
      id: "pretext-demo",
    }),
    route("vfo-grid-demo", "./framework/FullApplicationRoute.tsx", {
      id: "vfo-grid-demo",
    }),
    route("transformers", "./framework/FullApplicationRoute.tsx", {
      id: "transformers",
    }),
    route("game", "./framework/FullApplicationRoute.tsx", { id: "game" }),
    route("questionnaire", "./framework/QuestionnaireRoute.tsx"),
    route("x-archive-formatter", "./framework/XArchiveFormatterRoute.tsx"),
  ]),
  route("*", "./framework/NotFoundRoute.tsx"),
] satisfies RouteConfig;
