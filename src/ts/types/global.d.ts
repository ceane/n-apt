/// <reference types="@react-three/fiber" />
/// <reference types="@react-three/drei" />
/// <reference types="@webgpu/types" />

declare global {
  interface Window {
    __reduxProviderInitialized?: boolean;
  }
}
