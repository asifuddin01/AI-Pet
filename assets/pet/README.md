# Pet artwork

The pet is currently drawn entirely with HTML + CSS (`src/components/Pet.ts`,
`src/styles/pet.css`) — an original rounded robot with a glowing screen face, tiny legs and a
blue/purple palette. That's the "temporary CSS/vector placeholder system" from guide §40, but it's
also cheap to render: every animation is a compositor-driven transform.

To use sprite or Lottie art instead, add frames here:

```text
assets/pet/idle/  walk/  talking/  thinking/  sleep/  (…listening/  error/)
```

and replace the markup in `Pet.ts`, keeping its interface
(`setAnimation`, `playGesture`, `setPaused`, `setFacing`, `setScale`). The controllers only talk
to that interface, so nothing else needs to change. Keep frame rates modest and pause everything
in `setPaused(true)`.

`assets/icons/` holds the SVG sources for the app and menu-bar icons
(`npx tauri icon assets/icons/app-icon.png -o src-tauri/icons` regenerates the icon set).
