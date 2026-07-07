# Scripts

Only safe development and repository hygiene scripts should live here.

## Available Scripts

| Script | Purpose |
| --- | --- |
| `pre-push-hook.sh` | Blocks common secret patterns before pushing commits. |

## Security Rules

- Do not add scripts that generate privileged login sessions.
- Do not add scripts that call production operations endpoints.
- Do not include real URLs, tokens, account IDs, or credentials.
- Keep operational scripts in a private ops repository.
