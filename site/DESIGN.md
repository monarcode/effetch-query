---
name: Effetch Query
description: Server state for Effect apps, shown as the docs' own code running on a dark stage.
colors:
  void: "#0c0d11"
  ink: "#16171d"
  lime: "#d5f70d"
  paper: "#edeee8"
  muted: "#a2a6b0"
  note: "#868a95"
  stale: "#5b5f6b"
  rule: "#262832"
  syntax-text: "#c9cbd3"
  syntax-keyword: "#8e929e"
  syntax-quiet: "#6b6f7b"
  syntax-call: "#ffffff"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.375rem, 16.6cqi, 8.875rem)"
    fontWeight: 620
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 4.6vw, 4rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3.2vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  lead:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    lineHeight: 1.6
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.55
  button:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  code-stage:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, monospace"
    fontSize: "clamp(0.8125rem, 1.18vw, 1.25rem)"
    lineHeight: 1.7
    letterSpacing: "-0.01em"
  code-file:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, monospace"
    fontSize: "0.8125rem"
    lineHeight: 1.7
  label:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, monospace"
    fontSize: "0.75rem"
    fontFeature: "'tnum' 1"
rounded:
  row: "4px"
  control: "6px"
  file: "8px"
  pill: "999px"
spacing:
  gutter: "clamp(1rem, 3.4vw, 3rem)"
  band: "clamp(5rem, 12vw, 9rem)"
  band-close: "clamp(6rem, 14vw, 11rem)"
  columns: "clamp(2.5rem, 5vw, 5rem)"
components:
  button-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "3rem"
  button-bordered:
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 0.875rem"
    height: "2.25rem"
  copy-command:
    textColor: "{colors.paper}"
    typography: "{typography.code-file}"
    rounded: "{rounded.control}"
    padding: "0 0.25rem 0 1rem"
    height: "3rem"
  card:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1rem 1rem"
  card-header:
    textColor: "{colors.note}"
    typography: "{typography.label}"
    padding: "0.625rem 1rem"
  code-file:
    backgroundColor: "{colors.ink}"
    typography: "{typography.code-file}"
    rounded: "{rounded.file}"
  row:
    textColor: "{colors.paper}"
    rounded: "{rounded.row}"
    padding: "0.3125rem 0.5rem"
  switch:
    backgroundColor: "{colors.rule}"
    rounded: "{rounded.pill}"
    width: "1.75rem"
    height: "1rem"
  status-bar:
    textColor: "{colors.note}"
    typography: "{typography.label}"
    padding: "0.75rem {spacing.gutter}"
---

# Design System: Effetch Query

## Overview

**Creative North Star: "Code on Stage"**

The site is a dark editor buffer, not a page with a code window on it. The docs' own code, compiled with its Twoslash hovers, is set large and runs: a line lights when it executes and the value it changes flashes where it lands. Everything else is quiet greys on a near-black void, so the one lit thing is always the thing that is happening.

Density is low and typographic. Sections are full-bleed bands divided by a single 1px rule, with code on one side and what it renders on the other. Prose is short and sits in Geist; everything that belongs to the program (code, keys, file names, counters, the status bar) is Geist Mono. There is no terminal costume: no window chrome, no traffic lights, no second neon.

This is the whole site's system. The home page's tokens are scoped to `.landing` (src/styles/landing.css); the docs pages (Fumadocs) map Fumadocs' colour variables onto the same values in src/styles/docs.css, and their code uses the home page's greyscale theme (src/lib/code-theme.ts). Items marked (landing-only) belong to the home page. The direction contract planned a mono comment headline; the build ships a heavy Geist headline with the mono `Effect<A, E, R>` signature under it, and the build is the record.

**Key Characteristics:**

- Dark only: void ground, ink surfaces, paper text. No light mode, no theme switch.
- One accent, lime, reserved for what runs, what is selected, and the primary action.
- Real, compiled docs code at display size; syntax in greys so lime stays free.
- Line numbers in the margin and one lit line: a 3px lime rule plus a faint lime wash.
- Motion explains state; with reduced motion, colour feedback still lands.

## Colors

One brand accent on a graphite scale; the greys do all the structural work.

### Primary

- **Running Lime** (lime): the cursor line's rule and wash, the editable token, a value as it arrives, live dots, a selected control, the primary button, focus rings and text selection. Exact brand value, never tinted to a new hex; washes are `color-mix` of lime at 3-16%.

### Neutral

- **Void** (void): the page ground everywhere, and the code theme's background.
- **Ink** (ink): raised surfaces (cards, code files, the rendered output), and text on lime.
- **Paper** (paper): primary text, names and strings in code.
- **Muted Steel** (muted): second-tier text: leads, nav links, the hero's second line.
- **Note Grey** (note): quiet readable text: captions, mono headers, the status bar.
- **Stale Slate** (stale): idle state (a paused dot, the `Effect<` frame, beams at rest). Not a reading colour.
- **Rule** (rule): every 1px border and band divider; the switch track when off.
- **Syntax greys** (syntax-text, syntax-keyword, syntax-quiet, syntax-call): the Twoslash/Shiki theme. Comments and punctuation quiet, keywords mid, calls white.

### Named Rules

**The Running Light Rule.** Lime marks what is running, selected, live, or under the pointer, plus the one primary action. One lit thing per region at a time; never a decorative fill, gradient, or second accent.

**The Greyscale Code Rule.** The code theme has no hue. Strings and types are paper, calls are white, the rest are greys. Lime enters code only as state: the lit line, the editable value.

**The Exact Brand Rule.** Lime and ink ship at their exact values. The WebGL layer writes sRGB with colour management off so a lit beam core is exactly lime.

## Typography

**Display Font:** Geist Variable (with ui-sans-serif, system-ui)
**Code Font:** Geist Mono Variable (with ui-monospace, SF Mono)

**Character:** A tightly tracked grotesk, never heavier than 600 outside the hero, for the few things said in words, against its own mono for everything that belongs to the program: one family, two voices.

### Hierarchy

- **Display** (620, container-sized, 0.9): the hero title only. Sized by container query to fill its column in exactly two lines; each line rises from its own mask; the second line is muted.
- **Headline** (600, fluid 2.25-4rem, 1): one per band, max 18ch, balanced. The closing title (600, `clamp(2.25rem, 10cqi, 4.5rem)`) holds one line by container query.
- **Title** (600, fluid 1.75-2.75rem): link lists such as the platforms; Getting started steps use a smaller step (500, 1.25-1.625rem).
- **Lead** (400, 1.0625rem, 1.6): one paragraph under a headline, muted, 42-46ch.
- **Body** (400, 0.875rem): panels, captions and notes beside code.
- **Code, stage** (mono, fluid 0.8125-1.25rem, 1.7): the hero's code at display size. **Code, file** (mono 0.8125rem, 1.7): code files in bands.
- **Label** (mono 0.75rem, tabular): card headers, file names, status bar, counters. Sentence case, never uppercase, no tracking.
- **Signature** (landing-only; mono 300, up to 11rem, rule-coloured): `Effect<A, E, R>` set as an interactive diagram of the type.
- **Numeral** (600, 2.5-3.25rem, 0.9): a single counted value in a card.

### Named Rules

**The Three Weights Rule.** Body is 400, emphasis and labels are 500, headings are 600; only the hero title goes past it (620). Emphasis in prose is brighter, not heavier: a lead-in is 500 in paper against body grey.

**The Real Code Rule.** Any code shown is the docs' compiled code, read from the pages at build time, with its Twoslash hovers. Never mock code, never pseudo-code, never a screenshot.

**The Mono Meta Rule.** If it is a key, a file, a count, a status or a header on a card, it is mono at 0.75rem in note grey, with the value itself in paper.

## Layout

Full-bleed bands, each padded `band` vertically and `gutter` horizontally, separated by a 1px rule on the void. Inside a band, a head (headline + lead, two columns, aligned to the end) sits over a run: code on the left (about 1.25-1.5fr), what it renders on the right (16-27rem). Columns are separated by the `columns` clamp; panels stack at 0.75rem.

The stage (landing-only) fills at least the viewport (min 52rem): nav, title with the sub and actions beside it, the code and its rendered output, then a status bar bleeding to both edges at the foot. Line numbers hang in a 3rem margin to the left of the code.

Breakpoints: at 64rem every two-column grid becomes one column; at 48rem link lists become one column; at 40rem line numbers drop, code scrolls sideways at the gutter instead of wrapping, and the nav keeps only Docs and the search button.

**The Margin Numbers Rule.** Numbered things (code lines, Getting started steps) number in the margin, in mono, outside the text, and the number lights with its line.

## Elevation & Depth

Flat. There are no drop shadows. Depth is tonal: ink surfaces on the void, edged by a 1px rule. The only light in the system is lime: the inset 3px rule on a lit line, a 2px sweep along the top of a card that is refetching, and the pulse ring on the live dot while a request is out. The WebGL beams (landing-only, lazy-loaded) are light, not shadow.

**The Flat Void Rule.** Surfaces never lift. If something needs attention, it lights; it does not cast a shadow.

## Shapes

Small, crisp radii: 4px for rows and inner buttons, 6px for cards, controls, buttons and the search field, 8px for a code file's frame, and a full pill only for the switch and status dots. Borders are always 1px rule. A dashed rule means a slot or a paused thing: the empty mount slot, a paused reader, the message log.

## Components

### Buttons

- **Primary:** lime fill, ink text, 650 weight, 3rem tall, 6px radius, with a trailing arrow. Hover lifts 1px and nudges the arrow 2px right. One per view.
- **Bordered:** 2.25rem, 1px rule border, transparent fill, 6px radius. Hover moves the border and text to lime. Selected (a radio): lime border, lime text, 10% lime wash.
- **Copy command:** a 3rem mono field (rule border, 6px) holding the install command, truncated with an ellipsis, with a 2.5rem icon button that turns lime on hover.
- **Focus:** 2px lime outline, 3px offset, everywhere.

### Cards / Containers

- **Card:** ink, 1px rule, 6px radius, 0.75rem 1rem 1rem padding, a mono label header (component name in paper, state on the right).
- **Code file:** ink, 1px rule, 8px radius; a mono caption bar (file name in paper, note in note grey) over the code at 0.8125rem.
- **States:** refetching keeps the old value and runs a lime sweep along the top edge; paused is a dashed border at 62% opacity.

### Rows

Todo rows and entity rows: 4px radius, 0.3125rem 0.5rem padding, a 7% lime wash on hover, a 0.99 press. Done rows strike through in note grey with the mark in lime. The ✓/○ marks are the docs component's own rendered output, not an icon system; icons elsewhere are Lucide.

### Switch

A 1.75 x 1rem pill: rule track and paper knob when off, lime track and ink knob when on.

### Navigation

A 4rem bar over the stage: mark and wordmark (650, width 110%), muted links that turn paper on hover, and a bordered search button with a mono `⌘K` key cap. Link lists in bands are rows divided by rules, each with a large title, a mono note and an arrow that turns lime and shifts on hover.

### Status Bar (signature)

Mono 0.75rem, tabular, note grey, full-bleed with a rule above: running dot, key, request and mutation counts, freshness. Values are paper and flash lime as they change; the dot is lime when live and pulses only while a request is out.

### The Lit Line (signature)

The line that runs gets a 3px lime inset rule and a lime wash fading left to right (9% to 3%), its line number turns lime, and a brighter band sweeps along it once (900ms). In a traced file the other lines step back to 42% opacity.

### Motion

One easing, `cubic-bezier(0.16, 1, 0.3, 1)`. Hovers 160-200ms; state changes 200-400ms; entrances 500-900ms, staggered by line (45ms) or by trace order (22ms). Values arrive from lime to their resting colour; counts rise in; freshness drains as a 2px meter under the edited value. Bands reveal on scroll only where `animation-timeline: view()` exists.

**The Motion Explains State Rule.** Every animation reports something: a line running, a value changing, a request out, time passing. Nothing loops for ambience, and nothing pops in.

**The Still Clock Rule.** Under reduced motion all movement stops, but changed values still flash lime, waiting cards take a lime border, and the freshness meter still drains: it is the clock, not a flourish.

## Do's and Don'ts

### Do:

- **Do** keep the site dark only, on void, with ink surfaces and 1px rule borders.
- **Do** show real docs code, compiled, with its Twoslash hovers, and the thing it renders beside it.
- **Do** light exactly one thing per region in lime, and let everything else step back.
- **Do** set keys, files, counts and headers in mono at 0.75rem, sentence case.
- **Do** give every animation a state to report, and a colour-only fallback under reduced motion.
- **Do** label simulated data as simulated where it plays.

### Don't:

- **Don't** add a light theme, a second accent, or any hue to the code theme.
- **Don't** use lime as decoration: no lime gradients, glows, blooms or large fills beyond the primary button.
- **Don't** draw a diagram of the cache, ambient orbs, or soft blooms; light runs along code that executes.
- **Don't** dress code as a terminal: no window chrome, traffic lights or fake prompts.
- **Don't** use drop shadows; surfaces stay flat.
- **Don't** put uppercase labels, kickers or eyebrows above headings.
- **Don't** set readable text in stale; use note or brighter.
