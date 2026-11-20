# PROTOTYPE, throwaway: docs site theme

This branch is never merged. It keeps the prototype that settled the docs site's look, as the primary source for #188.

## The question

Which palette and type pairing should the docs site use? Seven palettes (Rosé Pine Main and Moon, Catppuccin, Ayu, Tokyo Night, Nord, Poimandres), four type pairings, and dark and light, all with the same real content.

## The verdict

- **Palette:** Rosé Pine. Main is the dark theme and Dawn the light one. Dark is the default.
- **Type:** Space Grotesk, Inter and JetBrains Mono.
- **Accents:** rose (`--line`) and love (`--gate`). Gold (`--hl`) is only for highlighting very specific things.
- **Non-text marks** (rails, station circles, the gate's fill and pulse) use the pure palette colour (`*-mark`). That keeps rose and love apart in Dawn, where the AA-adjusted text colours are nearly the same.
- **The gate** is a filled circle that pulses, and stops under reduced motion.
- **Detail panels** are sticky: at the top on desktop, and at the bottom under 820px.

## Files

- `gen.mjs` builds the palette CSS and nudges each text token to WCAG AA. It reads `template.html` and writes `site-theme-prototype.html`.
- `skills.js` is the draft skill data, spliced into the template by `splice.py`. It is draft content and must be checked against each `SKILL.md`. For example, one entry has `k: 'pstack'` where a kind belongs.
- `check.cjs` syntax-checks the page script and compares the skill rows with `plugin.json`.

Run `node gen.mjs && node check.cjs`, then open `site-theme-prototype.html`. The bottom bar switches palettes (`←`/`→`) and type pairings (`Shift`+arrows), and `T` toggles the theme.
