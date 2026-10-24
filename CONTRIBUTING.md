# Contributing to VoiceKhata

Thanks for helping build VoiceKhata. Contributions from every hackathon teammate and future contributor should be visible, reviewable, and easy to understand.

## Workflow

1. Sync the latest `main` branch.
2. Create a descriptive branch using `feat/`, `fix/`, `docs/`, or `test/`.
3. Keep each pull request focused on one change.
4. Use a clear commit message, such as `feat: add transaction review fields`.
5. Run relevant tests and syntax checks.
6. Open a pull request to `main` with a summary and testing notes.
7. Ask a teammate to review before merging when possible.

## Example

```bash
git switch main
git pull origin main
git switch -c feat/short-description
# Make your changes
git status
git add path/to/changed-file
git commit -m "feat: describe the change"
git push -u origin feat/short-description
```

Then open a pull request from your branch into `main` on GitHub.

## Submission checklist

- [ ] The change has a clear purpose.
- [ ] Relevant tests and syntax checks were run, or limitations are explained.
- [ ] Documentation is updated when behavior or setup changes.
- [ ] No credentials, OAuth secrets, API keys, local databases, model weights, or virtual environments are included.
- [ ] UI changes include screenshots where useful.

## Project guidelines

- Let users review voice-derived transaction details before saving.
- Keep money calculations deterministic and validate values on the backend.
- Keep customer records scoped to the authenticated user.
- Never log credentials, Google ID tokens, or sensitive customer data.
- Do not commit generated SQLite files such as `backend/voicekhata.db`.

## Reporting issues

Include reproduction steps, expected behavior, actual behavior, and relevant error messages. Remove secrets and real customer information from logs and screenshots.
