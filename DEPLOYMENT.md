# VoiceKhata full-stack deployment

## Why the warning appears

The live GitHub Pages site is static hosting. It cannot run the FastAPI Python API or store a shared SQLite database. Until the API has a public HTTPS URL, the site correctly stays in browser-only mode; there is no real cloud sync yet.

## Deploy the backend on Render

1. Sign in to Render and choose **New → Blueprint**.
2. Connect `nishantekka2007-sys/voicekhata-hackday` and select the branch containing this deployment setup (or merge it into `main` first).
3. Render reads `render.yaml`. Create the service and set `GOOGLE_CLIENT_ID` to the Google OAuth **Web application client ID** in the Render environment settings. Do not put a Google client secret or ID token in frontend files.
4. The Blueprint uses a persistent disk at `/var/data` for `/var/data/voicekhata.db`. Persistent disks require a paid Render web service plan; without persistent storage, SQLite data can disappear on redeploy/restart.
5. Wait for deployment to succeed. Open `https://YOUR-SERVICE.onrender.com/api/health`; it should return JSON with `"status":"ok"`. Use the exact service URL Render assigns you.

## Connect GitHub Pages to the API

1. Open `frontend/config.js` on the deployment branch.
2. Set the public API base to the exact Render HTTPS URL, ending in `/api`. For example:
   ```js
   window.VOICEKHATA_API_BASE = "https://YOUR-SERVICE.onrender.com/api";
   ```
   Replace the example hostname with your actual service hostname. Keep this URL public; never add secrets to this file.
3. In Render's environment, set `VOICEKHATA_CORS_ORIGINS` to exactly:
   `https://nishantekka2007-sys.github.io`
4. In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Web client, add this **Authorized JavaScript origin**:
   `https://nishantekka2007-sys.github.io`
   No path or trailing slash is needed. Save changes and allow a few minutes for them to apply.
5. Commit and push the updated `frontend/config.js`; wait for the GitHub Pages workflow to publish it. Hard-refresh the site after deployment.

## Verify the integration

- `https://YOUR-SERVICE.onrender.com/api/health` returns status `ok`.
- `https://YOUR-SERVICE.onrender.com/api/auth/config` reports `google_login_enabled: true`.
- The browser Network tab shows `/api/auth/config` and `/api/auth/google` requests going to the Render host, not to GitHub Pages.
- Sign in with Google, save a test transaction, refresh, and confirm the same transaction returns from `GET /api/transactions`.
- Check that another Google account cannot see the first account's transactions.

## Important notes

- Use fake test data until the service and persistence are verified.
- The frontend's device PIN is a convenience lock, not server authentication. Google sign-in protects cloud API calls.
- VoiceKhata's local/offline ledger is not automatically migrated to the cloud. Existing browser-local records stay on that browser unless you explicitly export/import them.
- Render's free ephemeral filesystem is not suitable for a persistent SQLite ledger. This Blueprint intentionally requests persistent storage.
- If you would rather use the FastAPI-hosted website, open the Render service root URL instead of GitHub Pages; the site and API then share one origin. Google OAuth still needs the Render URL added as an authorized JavaScript origin and CORS can be restricted accordingly.
