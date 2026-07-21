declare module "@ladle/react" {
  import type { ComponentType, ReactNode } from "react";

  export type Story<P = unknown> = ComponentType<P>;

  export interface LadleGlobalState {
    story?: string;
    [key: string]: unknown;
  }

  export interface LadleContextValue {
    globalState: LadleGlobalState;
  }

  export function useLadleContext(): LadleContextValue;
  export function useLink(): (storyId: string) => void;
  export function useStoryMeta(): Record<string, unknown>;

  export const Meta: ComponentType<{ title?: string; children?: ReactNode }>;
  export const Story: Story;
}
