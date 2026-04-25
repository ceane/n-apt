type HotPayload = { path?: string };

export const registerMarkdownHotReload = (onUpdate: (payload: HotPayload) => void): (() => void) => {
  if (!import.meta.hot) {
    return () => {};
  }

  const hot = import.meta.hot;
  hot.accept();
  hot.on("pages:update", onUpdate);

  return () => {
    hot.off("pages:update", onUpdate);
  };
};
