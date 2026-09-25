# Contributing to GapVise AI

How to get set up, how we make changes, and the few rules that keep the product
correct. Start with the [README](README.md) for what the project is.

## 1. Get access

1. The repository owner invites you under **Settings → Collaborators**.
2. Accept the invite from the email, or at
   <https://github.com/aryankorrai18/AIassessment/invitations>.
3. Clone it:

   ```bash
   git clone https://github.com/aryankorrai18/AIassessment.git
   cd AIassessment
   npm install
   npm run setup:mediapipe
   ```

## 2. Get your secrets

Secrets are **never** in the repository — `.env` and `serviceAccountKey.json` are
git-ignored. Create `packages/backend/.env` from the example and fill it in:

```bash
cp packages/backend/.env.example packages/backend/.env
```

| Setting | Where it comes from |
|---|---|
| `JWT_SECRET` | Any long random string you make yourself, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GEMINI_API_KEY` | Your own key from <https://aistudio.google.com/apikey>, or the team key shared through the password manager |
| `serviceAccountKey.json` | Ask the owner to add you to the Firebase project (**Project settings → Users and permissions**), then generate **your own** key under **Service accounts → Generate new private key** and save it as `packages/backend/serviceAccountKey.json` |
| `EMAILJS_*` | Optional. Without them, emails (access keys, reset links) are printed in the backend console |

**Share secrets only through a password manager** — never in chat, email, an
issue, or a commit. If a secret is ever committed or pasted somewhere public,
tell the owner so it can be rotated.

### Shared database or your own?

With `serviceAccountKey.json` in place you work on the **team's shared Firebase
database**: admin accounts, JDs, candidates and results are shared with everyone.
When working there:

- Name test data so it's obviously yours (e.g. candidate emails like
  `yourname+test1@example.com`, JD titles starting `TEST`), and delete it when done.
- Don't delete or edit other people's data.
- Don't change the Gemini key under **Admin → Settings** — it changes it for everyone.

For experiments, **leave the service account key out** and run the local
Firestore emulator instead (needs Java). The backend switches to it automatically:

```bash
npm run emulator -w packages/backend      # terminal 1
npm run dev:backend                       # terminal 2
npm run seed:admin                        # once per emulator session; data resets when it stops
```

## 3. Make a change

We never commit directly to `main`. Every change goes through a branch and a pull request.

```bash
git checkout main
git pull                                    # start from the latest code
git checkout -b feature/short-description   # or fix/…, docs/…
```

Make your change, then check it:

```bash
npm run check          # typecheck + tests + lint + production builds — must pass
```

Also click through the part of the app you changed. For proctoring or voice
changes, test in Chrome with a real camera and microphone.

Commit and push:

```bash
git add -A
git commit -m "Short summary of what and why"
git push -u origin feature/short-description
```

Open the pull request from the link `git push` prints (or from the repository's
**Pull requests** tab). In the description, say what changed, why, and how you
tested it.

### Review and merge

- At least one teammate reviews every pull request before it's merged.
- Keep pull requests small and focused — one feature or fix each.
- If `main` moved on while you were working, bring your branch up to date and re-run the checks:

  ```bash
  git fetch origin
  git merge origin/main
  npm run check
  git push
  ```

- Merge with the **Merge pull request** button, then delete the branch.

## 4. Rules of the codebase

**`PRD.md` is the source of truth for behavior.** If your change alters what the
product does — an API response, an error message, a limit, a screen — update the
PRD in the **same pull request**.

**Don't "improve" specified values.** Constants, thresholds, error strings and
cron schedules in the PRD are deliberate. The Gemini prompts (PRD Appendix A) are
tuned against their response schemas; the tests fail if the code's prompts drift
from the PRD. To change a prompt, change the PRD and the code together and test
against real Gemini output.

**Respect the non-goals** (PRD §13). In particular: candidates never see a score,
proctoring never auto-ends an interview, and no video is ever recorded.

**Keep the network constraints** (TECH_STACK.md): no dependencies that need native
binaries, no loading scripts or models from a CDN, email over HTTPS only.

**Candidates are identified by email.** The candidate record ID is the lowercased
email — always normalize with `normalizeEmail()` before looking one up.

**Never commit** `.env`, `serviceAccountKey.json`, build output, or files under
`packages/candidate-frontend/public/mediapipe/`. Check `git status` before committing.

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| Backend won't start: `JWT_SECRET env var is not set` | Create `packages/backend/.env` and set `JWT_SECRET` (section 2) |
| `Port 4000 / 5173 / 5174 is already in use` | Another copy is still running — stop it (close its terminal, or end the `node` process in Task Manager) |
| Backend logs `Firestore initialized … emulator` but you wanted the shared database | `packages/backend/serviceAccountKey.json` is missing or misnamed |
| Proctoring says "Proctoring couldn't start" or models 404 | Run `npm run setup:mediapipe` |
| JD extraction or question generation fails with a Gemini error | Check `GEMINI_API_KEY`; generation can take a minute and occasionally needs a retry |
| Access key or reset email never arrives | Without EmailJS configured, look for it in the backend console output |
