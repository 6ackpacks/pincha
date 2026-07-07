# Design System

This document captures public UI rules for contributors. It avoids product strategy, campaign-specific layouts, and private design references.

## Principles

- Prioritize reading, scanning, and repeated use.
- Keep pages calm and information-dense.
- Use clear hierarchy instead of decorative complexity.
- Prefer accessible native controls and predictable interaction states.

## Color Tokens

| Token | Use |
| --- | --- |
| `--background` | App background |
| `--foreground` | Primary text |
| `--muted` | Secondary surfaces |
| `--muted-foreground` | Secondary text |
| `--border` | Dividers and subtle outlines |
| `--primary` | Primary actions and active states |
| `--destructive` | Destructive actions |

Use semantic tokens in components instead of hard-coded campaign colors.

## Typography

- Use the project font stack defined in the frontend app shell.
- Use one clear page title per view.
- Use compact headings inside panels and dense interfaces.
- Avoid negative letter spacing for body text.

## Spacing

- Use the Tailwind spacing scale.
- Keep dense tool surfaces aligned to an 8px rhythm.
- Use consistent gaps within repeated lists and grids.

## Components

- Buttons should use clear labels or recognizable icons.
- Inputs must include visible labels or accessible names.
- Cards are for repeated items, modals, and framed tools.
- Avoid nesting cards inside other cards.
- Interactive states must cover hover, focus, disabled, and loading.

## Motion

- Use motion to clarify state changes.
- Avoid motion that delays primary workflows.
- Respect reduced motion preferences.
