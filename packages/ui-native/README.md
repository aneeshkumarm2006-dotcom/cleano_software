# @bookmops/ui-native

The design system of the Bookmops mobile apps: tokens, the Gontserrat font
files, and the components both apps are built from.

- **Tokens** (`src/tokens.ts`) are the web product's Pier palette, type scale,
  spacing, elevation, and motion, so the apps and the web read as one product.
  Text colours are the contrast-checked ones (`ink2` 6.4:1, `ink3` 4.6:1).
- **Fonts**: load once at each app's root with `useFonts(fonts)`. Each weight
  is its own family name because Android does not synthesise weights for
  custom fonts; `Text` maps a weight to its file.
- **Components** follow the rules the screen designs set: importance is fill,
  not a stripe (`Card tone="active"`); numbers use tabular figures
  (`Text numeral`); icons are solid; every tappable thing is at least 44pt.

The screen designs themselves are in `docs/design/mobile`.
