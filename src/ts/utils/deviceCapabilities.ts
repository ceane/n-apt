import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";

export interface DeviceCapabilityIdentity {
  selectedSource?: {
    kind?: string | null;
    capability?: string | null;
    id?: string | null;
  } | null;
  selectedSourceId?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  sourceMode?: string | null;
}

export interface DeviceInfoIdentity {
  capability?: string | null;
  id?: string | null;
  name?: string | null;
  backend?: string | null;
  kind?: string | null;
}

const normalize = (value?: string | null) =>
  value?.toLowerCase().replace(/[_\s]+/g, "-") ?? "";

export const isMockDevice = (device: DeviceInfoIdentity): boolean => {
  return (
    device.capability === "mock" ||
    device.id === "mock-apt" ||
    device.id === "mock-tx" ||
    device.name?.toLowerCase().includes("mock") === true ||
    device.backend?.toLowerCase().includes("mock") === true ||
    device.kind?.toLowerCase().includes("mock") === true
  );
};

export const isMockBackend = (value: unknown): boolean => {
  return (
    typeof value === "string" &&
    (value === "mock_apt" ||
      value === "mock_apt_metal" ||
      value.includes("mock"))
  );
};

export const isMockTxSource = (device: {
  id?: string | null;
  kind?: string | null;
}): boolean => {
  const id = device.id?.toLowerCase() ?? "";
  const kind = device.kind?.toLowerCase() ?? "";
  return id === "mock-tx" || kind === "mock-tx" || kind === "mock_tx";
};

export const isMockLiveSource = ({
  selectedSource,
  backend,
  deviceName,
  sourceMode,
}: DeviceCapabilityIdentity): boolean => {
  if (sourceMode !== "live") return false;
  return isMockDevice({
    capability: selectedSource?.capability,
    id: selectedSource?.id,
    name: deviceName,
    backend,
    kind: selectedSource?.kind,
  });
};

export const isMockAptSource = ({
  selectedSource,
  selectedSourceId,
  backend,
  sourceMode,
}: DeviceCapabilityIdentity): boolean => {
  return (
    sourceMode === "live" &&
    !!(
      selectedSource?.kind?.toLowerCase().includes("apt") ||
      selectedSourceId === "mock-apt" ||
      selectedSourceId === "mock_apt" ||
      backend?.toLowerCase().includes("apt")
    )
  );
};

export const getMockDeviceProfile = (
  identity: DeviceCapabilityIdentity,
): DeviceProfile | null => {
  if (!isMockLiveSource(identity)) return null;
  if (isMockAptSource(identity)) {
    return {
      kind: "mock_apt",
      is_rtl_sdr: true,
      supports_approx_dbm: false,
      supports_raw_iq_stream: false,
    };
  }
  return {
    kind: "mock_tx",
    is_rtl_sdr: false,
    supports_approx_dbm: true,
    supports_raw_iq_stream: true,
  };
};

export const showsApproxDbmToggle = ({
  deviceProfile,
  backend,
}: {
  deviceProfile?: { supports_approx_dbm?: boolean | null } | null;
  backend?: string | null;
}): boolean => {
  if (deviceProfile) {
    return !!deviceProfile.supports_approx_dbm;
  }

  const backendName = normalize(backend);
  return (
    backendName === "rtl-sdr" ||
    backendName === "rtlsdr" ||
    backendName === "rtl-tcp" ||
    backendName === "rtltcp"
  );
};

export const supportsApproxDbm = ({
  deviceProfile,
  backend,
  sourceMode,
}: {
  deviceProfile?: { supports_approx_dbm?: boolean | null } | null;
  backend?: string | null;
  sourceMode?: string | null;
}): boolean => {
  if (sourceMode === "file") return true;
  return showsApproxDbmToggle({ deviceProfile, backend });
};

export const isMockAptDevice = (device: {
  id?: string | null;
  kind?: string | null;
}): boolean => {
  const id = device.id ?? "";
  const kind = device.kind?.toLowerCase() ?? "";
  return (
    id === "mock-apt" ||
    id === "mock_apt" ||
    kind.includes("mock-apt") ||
    kind.includes("mock_apt") ||
    kind === "mock_apt"
  );
};

export const isMockTxIdentity = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return normalized === "mocktx" || normalized === "mocktxsdr";
};
