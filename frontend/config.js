/* Public client configuration. Never put secrets in this file.
 *
 * GitHub Pages is static hosting; it cannot run FastAPI or SQLite. Once the
 * backend is deployed, set the exact HTTPS API URL below (ending in /api).
 * Example: "https://voicekhata-api.onrender.com/api"
 *
 * Local development:
 *   - FastAPI serves the frontend and API together at http://127.0.0.1:8000
 *   - Live Server at localhost:5500 talks to FastAPI on port 8000.
 */
(() => {
  const explicitlyConfigured = String(window.VOICEKHATA_API_BASE || "").trim();
  const host = window.location.hostname;
  const local = ["localhost", "127.0.0.1"].includes(host);
  const pages = host.endsWith(".github.io");

  if (explicitlyConfigured) {
    window.VOICEKHATA_API_BASE = explicitlyConfigured.replace(/\/+$/, "");
    return;
  }

  if (pages) {
    // Intentionally empty until a real hosted HTTPS API URL is configured.
    window.VOICEKHATA_API_BASE = "";
    return;
  }

  if (local && window.location.port === "5500") {
    window.VOICEKHATA_API_BASE = `${window.location.protocol}//${host}:8000/api`;
    return;
  }

  // When served by FastAPI/Render, the website and API share an origin.
  window.VOICEKHATA_API_BASE = "/api";
})();
