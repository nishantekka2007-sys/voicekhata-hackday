# Contributing to VoiceKhata

Thanks for helping build VoiceKhata. Contributions from every member of the hackathon team—and future contributors—should be visible, reviewable, and easy to understand.

## Collaboration workflow

1. **Sync first:** pull the latest changes from `main`.
2. **Create your own branch:** use a descriptive prefix such as `feat/`, `fix/`, `docs/`, or `test/`.
3. **Keep each change focused:** avoid combining unrelated features in one pull request.
4. **Commit with a clear message:** for example, `feat: add transaction review fields` or `docs: clarify local setup`.
5. **Test your change:** run the relevant tests and syntax checks before opening a pull request.
6. **Open a pull request to `main`:** explain the problem, the solution, and how you tested it.
7. **Review together:** at least one teammate should review the change before it is merged, when time allows.

## Branch examples

```bash
git switch main
git pull origin main
git switch -c feat/short-description
# make your changes
git status
git add path/to/changed-file
git commit -m "feat: describe the change"
git push -u origin feat/short-description
```

Then open a pull request from your branch into `main` on GitHub.

## Before submitting

- [ ] The change has a clear purpose.
- [ ] I ran the relevant tests or documented why I could not.
- [ ] I checked formatting and obvious errors.
- [ ] I did not commit passwords, OAuth secrets, API keys, local databases, model weights, or virtual environments.
- [ ] I updated documentation when behavior or setup changed.
- [ ] I included screenshots or sample output for user-interface changes, where helpful.

## Project-specific guidance

- Never save a voice-derived transaction without letting the user review and confirm it.
- Keep money calculations deterministic; do not rely on AI to calculate balances.
- Validate transaction values on the backend as well as in the frontend.
- Keep customer records scoped to the authenticated user.
- Do not log credentials, Google ID tokens, or sensitive customer information.
- Avoid committing generated SQLite files such as `backend/voicekhata.db`.

## Reporting issues

When opening an issue, include the steps to reproduce it, the expected behavior, the actual behavior, and relevant error messages. Remove secrets and personal customer data from logs or screenshots.

## Questions

Open a GitHub issue or start a discussion with the team before making a large architectural change.
