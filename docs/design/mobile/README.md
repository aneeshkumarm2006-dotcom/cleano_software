# Bookmops mobile screens

29 screen designs for the two mobile apps, as self-contained HTML. Each file is one screen at 390x844 with inline styles and no dependencies, so it opens in any browser and imports cleanly into Figma.

## Bookmops Pro (cleaner) — 17

`Main` sign in · `ProToday` · `ProJobs` · `ProJobDetail` · `ProClock` · `ProAvailable` · `ProPay` · `ProChat` · `ProTeamChat` · `ProAnnouncements` · `ProMore` · `ProInventory` · `ProAvailability` · `ProCalendar` · `ProTraining` · `ProDocument` · `ProStrikes`

## Bookmops (customer) — 12

`CustSignUp` · `CustHome` · `CustBook1` · `CustBook2` · `CustQuote` · `CustBookings` · `CustTracking` · `CustMessages` · `CustRate` · `CustAccount` · `CustHelp` · `CustGiftCard`

## Getting these into Figma

Figma's REST API cannot create design content. Only a plugin running inside the Figma editor can, so the import has to be driven from Figma itself. The `html.to.design` connector on claude.ai exposes `Import-html` and `Import-url`, which drive exactly that plugin.

### Two combined sheets, so this is two imports rather than 29

- **`bookmops-pro-all.html`** — all 17 cleaner screens, laid out and labelled
- **`bookmops-customer-all.html`** — all 12 customer screens

Both are generated from the individual files by `scripts/combine-design-sheets.py`. They are plain standalone HTML with the canvas scaffolding stripped, so anything that reads HTML can take them.

1. Open the target Figma file so the plugin has somewhere to write.
2. In **claude.ai chat** (not Claude Code — the connector lives there), paste the contents of one sheet and say *"Turn my HTML into a Figma design."*
3. Repeat for the other sheet.
4. Keep the two apps on separate Figma pages. They are two store listings and should not share one.

Each sheet imports as one page with the screens as children, so expect to split them into individual frames once they land. Importing the single-screen files instead gives one frame each, at the cost of 29 imports.

**Expect to tidy two things by hand:** the inline SVG icons, and the progress ring on `ProClock`. Everything else — layout, type, colour, spacing — should come across as real editable layers.

### Regenerating the sheets

Edit the individual screen files, then:

```
python3 scripts/combine-design-sheets.py
```

Run it from the repository root. It rebuilds both sheets from the individual files, so never edit a combined sheet by hand — the next run overwrites it.

## Design rules these follow

Built on the product's own tokens from `src/app/globals.css`, not an invented palette. Teal `#008C9C`, navy `#19356D`, cream `#f3f6f9`, ink `#0e1a1c`, plus the existing crew-app motion and elevation scales.

Small teal text uses `--primary-800` `#005a63`. Full-strength `#008C9C` only reaches 4.01:1 on white and fails WCAG AA for small text; that limit is documented in `globals.css` itself.

Three structural rules run through every screen:

- **Time is the spine.** Job lists hang off a day rail with hour marks and a live NOW line, rather than a stack of identical cards.
- **Importance is fill, not a stripe.** The active job is a solid navy block; everything else stays a quiet white card. No left accent bars.
- **Numbers over icons.** Times and money are large tabular figures. Icons are solid fills, never thin outlines.

Navigation is a floating navy capsule. The cleaner bar's fifth slot is **More**, which is what lets five slots serve roughly twenty cleaner routes.

## Fonts

The product uses Gontserrat, a local TTF in `public/fonts/gontserrat/`. These files name it first and fall back to Montserrat, which is near identical and available on Google Fonts. Point Figma at the real Gontserrat files for final artwork.

## Source of truth

The live canvas, where these can be viewed and commented on together, is recorded in `docs/product/` alongside the mobile plan. These HTML files are the exported copy; edit the canvas, then re-export, rather than editing both.
