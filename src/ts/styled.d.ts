import "styled-components";

declare module "styled-components" {
  export interface DefaultTheme {
    primary: string;
    fft: string;
    mode: string;
    // Include existing COLORS if they are used via theme
    [key: string]: any;
  }
}
