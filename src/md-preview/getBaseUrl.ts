type GlobalImportMetaEnv = {
  import?: {
    meta?: {
      env?: {
        BASE_URL?: string;
      };
    };
  };
};

const getDocumentBasePath = () => {
  if (typeof document === "undefined" || !document.baseURI) {
    return "/";
  }

  try {
    return new URL(document.baseURI).pathname || "/";
  } catch {
    return "/";
  }
};

export const getBaseUrl = () => {
  const envBaseUrl = (globalThis as typeof globalThis & GlobalImportMetaEnv).import?.meta?.env?.BASE_URL;
  const baseUrl = typeof envBaseUrl === "string" && envBaseUrl.length > 0
    ? envBaseUrl
    : getDocumentBasePath();

  return baseUrl.replace(/\/$/, "");
};
