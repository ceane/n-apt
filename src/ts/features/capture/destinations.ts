export const CAPTURE_DESTINATION_PROVIDERS = [
  {
    id: "local",
    label: "Local Downloads",
    kind: "browser-download",
    cli: true,
  },
  {
    id: "folder",
    label: "Choose local folder…",
    kind: "browser-directory",
    cli: false,
  },
  {
    id: "aspect",
    label: "Aspect mounted drive",
    kind: "mounted-folder",
    cli: true,
  },
] as const;

export type CaptureDestinationId =
  (typeof CAPTURE_DESTINATION_PROVIDERS)[number]["id"];

export const CLI_CAPTURE_DESTINATION_IDS = CAPTURE_DESTINATION_PROVIDERS.filter(
  (provider) => provider.cli,
).map((provider) => provider.id);

export const CAPTURE_DESTINATION_STORAGE_KEY =
  "napt.capture-destination.v1";

export const resolveCaptureDestination = (
  value: unknown,
): CaptureDestinationId => {
  const match = CAPTURE_DESTINATION_PROVIDERS.find(
    (provider) => provider.id === value,
  );
  return match?.id ?? "local";
};
