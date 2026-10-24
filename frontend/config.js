/* Public, non-secret client configuration.
 * When served by FastAPI, the API is on the same origin.
 * When hosted by GitHub Pages, enter your *deployed HTTPS backend URL* below.
 * GitHub Pages alone cannot host Python or SQLite. */
window.VOICEKHATA_API_BASE = window.VOICEKHATA_API_BASE ?? (
  window.location.hostname.endsWith(".github.io")
    ? ""  // Preview-only until an HTTPS backend is deployed
    : (["localhost", "127.0.0.1"].includes(window.location.hostname) &&
       window.location.port === "5500")
      ? `${window.location.protocol}//${window.location.hostname}:8000/api`
      : "/api"
);
