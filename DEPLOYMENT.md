# VoiceKhata full-stack deployment

## Fastest zero-cost demo setup

The live GitHub Pages site is static hosting. It cannot run FastAPI or provide a shared SQLite database. Deploy the API as a free Render Web Service, then point the frontend at its HTTPS URL.

**Free-tier trade-off:** Render's free service sleeps after 15 minutes without traffic and may take about a minute to wake up. Its filesystem is temporary, so SQLite data can be lost when the service sleeps, restarts, or redeploys. This setup is for a hackathon/demo with fake data, not for real shop ledgers.

## Deploy the backend

1. Sign in at https://dashboard.render.com/.
2. Choose **New → Blueprint**.
3. Connect `nishantekka2007-sys/voicekhata-hackday` and select `main`.
4. Render reads `render.yaml`, which is configured for the **Free** web service tier. Review and create the service. Do not upgrade to a paid plan.
5. When asked for `GOOGLE_CLIENT_ID`, you can leave it unset for the initial API health check. Google login will remain disabled until configured.
6. Wait for deployment. Open `https://YOUR-SERVICE.onrender.com/api/health` using the exact hostname Render assigns. It should return JSON with `"status":"ok"`.

## Connect the GitHub Pages frontend

1. In Google Cloud Console, create or open an OAuth 2.0 client of type **Web application**.
2. Add this **Authorized JavaScript origin**:
   `https://nishantekka2007-sys.github.io`
   No path or trailing slash is needed.
3. Copy the OAuth **Client ID** into Render's `GOOGLE_CLIENT_ID` environment variable. Do not put a client secret or ID token in frontend files.
4. Open `frontend/config.js` in the repository and set the public API base to your real Render URL ending in `/api`, for example:
   ```js
   window.VOICEKHATA_API_BASE = "https://YOUR-SERVICE.onrender.com/api";
   ```
   Replace the example hostname with the one Render assigned. Never add secrets to this file.
5. In Render's environment, set `VOICEKHATA_CORS_ORIGINS` to exactly:
   `https://nishantekka2007-sys.github.io`
6. Commit the `frontend/config.js` change and wait for the GitHub Pages workflow to publish it. Hard-refresh the website.

## Verify

- `/api/health` returns status `ok`.
- `/api/auth/config` reports `google_login_enabled: true` after the client ID is configured.
- Sign in with Google, create a **fake test transaction**, refresh, and confirm it loads again while the service is awake.
- Use a second Google account to check that one user's transactions cannot be accessed by another user.

## Important limitations

- Free Render services sleep after 15 minutes without traffic and take around a minute to wake.
- SQLite on the free service's temporary filesystem is not durable. Data can be lost after sleep, restart, or redeploy. Do not enter real customer or financial records.
- The website's existing browser-local records are not automatically migrated to the cloud.
- The device PIN is only a convenience lock. Google sign-in is what protects API requests.
