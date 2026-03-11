# Contributing

Thanks for your interest. This project mixes React/Next.js with a Phaser game layer, so the best contributions tend to be focused and easy to verify in the running game.

Designers, level designers, and game designers are just as welcome as engineers.

## Setup

```bash
pnpm install
pnpm dev
```

You'll need Node.js 22+ and pnpm. For live agent execution, point `server.ts` at a running [OpenClaw](https://github.com/anthropics/openclaw) gateway.

## Ground rules

- Open an issue first for large features or architecture changes.
- One concern per PR. Don't mix unrelated changes.
- Include a screenshot or short recording for anything visual.

## What we care about

- Tasks should feel **spatial**, not abstract.
- Worker behavior should be **readable at a glance**.
- In-world interaction over hidden menus.
- New UI should match the pixel HUD style.
- New scenes should expand the world, not add settings pages.

## Good contribution areas

- Gameplay feel and interaction clarity
- Scene and level design
- Worker AI and pathfinding
- HUD readability
- Performance and code quality
- Bug fixes with repro steps

## For designers

You don't need to write TypeScript. Useful contributions include interaction proposals, scene flow mockups, level layouts, POI placement ideas, and economy/progression concepts for the marketplace expansion. Open an issue or draft to discuss before anyone writes code.

## Pull requests

Include: what changed, why, and how to verify it. Run `pnpm build` before submitting.

## Commits

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`

## Code style

- TypeScript throughout.
- Phaser logic and React UI stay separated.
- Explicit state transitions over hidden side effects.
- Constants over magic numbers.
- No global mutable state.
