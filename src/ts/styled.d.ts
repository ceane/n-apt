import "styled-components";
import type { AppStyledTheme } from "@n-apt/components/ui/Theme";

declare module "styled-components" {
  export interface DefaultTheme extends AppStyledTheme {}
}
