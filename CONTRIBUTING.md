# Contributing

## Before opening a PR

```bash
python -m pytest -q
node --check weather_script.js
node --check risk_panel.js
node --check sw.js
```

Keep changes small and explain the user-facing reason for UI changes. Do not add provider keys or generated caches to the repository.

### Architecture rules

1. Location identity is separate from weather data.
2. Official warnings remain distinct from model-derived signals.
3. Provider failures must degrade gracefully without inventing data.
4. Local MIMU data is preferred for Myanmar place search.
5. UI text should be concise; detail belongs behind progressive disclosure.
