import { BookOpen, Home, Languages, LogOut } from "lucide-react";
import type { LinkCardItem } from "@n-apt/ui/LinkCardGrid";

export const START_PAGE_LINK_CARD: LinkCardItem = {
  title: "Start Page",
  description: "Return to the app's starting point.",
  Icon: Home,
  to: "/get-started",
};

export const LINGO_AND_LEARN_LINK_CARD: LinkCardItem = {
  title: "Lingo and Learn",
  description: "Browse the FAQ to learn radio and signal-processing terms.",
  Icon: Languages,
  to: "/learn",
};

export const MORE_ABOUT_N_APT_LINK_CARD: LinkCardItem = {
  title: "More about N-APT",
  description:
    "Read the article about N-APT to learn about the signal that inspired the app.",
  Icon: BookOpen,
  href: "https://ceane.github.io/n-apt",
};

export const LOG_OUT_LINK_CARD: LinkCardItem = {
  title: "Log out",
  description:
    "Logging out prevents unauthorized use of the app or access to your I/Q captures.",
  Icon: LogOut,
  to: "/logout",
};
