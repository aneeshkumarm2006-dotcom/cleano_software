import { fontFamily } from "./tokens";

/**
 * Every font file the apps need, keyed by the family name the Text component
 * uses. Load once at the root of each app:
 *
 *   const [loaded] = useFonts(fonts);
 *
 * Gontserrat is the web product's typeface (apps/web/public/fonts), licensed
 * under the SIL Open Font License; the licence travels with the files.
 */
export const fonts = {
  [fontFamily.regular]: require("../assets/fonts/Gontserrat-Regular.ttf"),
  [fontFamily.medium]: require("../assets/fonts/Gontserrat-Medium.ttf"),
  [fontFamily.semibold]: require("../assets/fonts/Gontserrat-SemiBold.ttf"),
  [fontFamily.bold]: require("../assets/fonts/Gontserrat-Bold.ttf"),
  [fontFamily.extrabold]: require("../assets/fonts/Gontserrat-ExtraBold.ttf"),
} as const;
