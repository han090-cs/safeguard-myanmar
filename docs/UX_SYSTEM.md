# UX system

The interface is designed around four principles:

1. **Recognition over recall** — the current temperature, rain risk and important alerts are visible before detailed data.
2. **Progressive disclosure** — secondary explanations stay collapsed or behind tabs.
3. **Touch-first interaction** — controls target at least 44px on coarse pointers and respect safe-area insets.
4. **Semantic colour** — neutral blue/teal is the product colour; amber/red are reserved for increasing risk so colour itself carries meaning.

## Responsive behavior

- Phone: one-column cards and fixed bottom navigation.
- Tablet: compact multi-column metrics with normal tab navigation.
- Desktop: wider information density without increasing text size excessively.
- Reduced-motion users receive the same information without decorative animation.

## Visual psychology

The palette deliberately avoids age/gender-coded styling. Blue/teal communicates a calm utility surface; high-risk states use warm warning colours only when the state warrants attention. Large numeric weather values create a clear visual anchor, while smaller secondary metrics are intentionally quieter.

The design does not assume that any single colour is universally preferred; contrast, hierarchy, consistency and task clarity are treated as the primary accessibility goals.
