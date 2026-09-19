import notifier from "node-notifier";

export type BuildNotification = {
  title?: string;
  message?: string;
  icon?: string;
  open?: string;
};

export type NotificationSender = (
  options: BuildNotification,
  callback: (error: Error | null) => void,
) => unknown;

const ignoreNotificationFailure = (_error: unknown): void => {
  // Desktop notifications are optional and must never stop the dev server.
};

export const notifyBestEffort = (
  options: BuildNotification,
  send: NotificationSender = (nextOptions, callback) =>
    notifier.notify(nextOptions, callback),
): void => {
  try {
    const result = send(options, ignoreNotificationFailure);
    if (result && typeof (result as { once?: unknown }).once === "function") {
      (
        result as {
          once: (event: string, listener: (error: unknown) => void) => unknown;
        }
      ).once("error", ignoreNotificationFailure);
    }
  } catch (error) {
    ignoreNotificationFailure(error);
  }
};
