/* Optional secure API connection for the published VoiceKhata interface.
   No user ledger data is sent to a backend without Google sign-in. */
(() => {
  const base = window.VOICEKHATA_API_BASE || "";
  const TOKEN_KEY = "voicekhata.cloud.google_id_token";
  let user = null;
  const token = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const signedIn = () => !!user && !!token();
  const safeText = (id, message) => {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  };
  async function request(path, opts = {}) {
    if (!base) throw new Error("No hosted API configured. This is a browser-only preview.");
    const headers = {Accept:"application/json", ...(opts.body instanceof FormData ? {} : {"Content-Type":"application/json"}), ...(opts.headers || {})};
    if (token()) headers.Authorization = "Bearer " + token();
    const response = await fetch(base + path, {...opts, headers});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.detail || "Server returned " + response.status);
    return value;
  }
  function showMode(message) {
    safeText("cloudStatus", message);
    safeText("portalGoogleMessage", message);
  }
  function showLogin() {
    const host = document.getElementById("cloudAccount");
    if (!host) return;
    host.innerHTML = "";
    const label = document.createElement("small");
    label.textContent = signedIn() ? "Signed in: " + (user.name || user.email) : "Browser preview — not synced across devices";
    host.appendChild(label);
    const login = document.getElementById("cloudGoogleSignIn");
    if (login) login.style.display = signedIn() ? "none" : "";
    if (signedIn()) {
      const button = document.createElement("button");
      button.textContent = "Sign out";
      button.type = "button";
      button.style.cssText = "margin-top:8px;font-size:12px;color:#236451;text-decoration:underline";
      button.addEventListener("click", signOut);
      host.appendChild(button);
    }
  }
  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    user = null;
    showLogin();
    const login = document.getElementById("cloudGoogleSignIn");
    if (login) login.style.display = "";
    showMode("Using on-device mode. Entries remain private to this browser.");
    const modeBanner = document.getElementById("accountModeBanner");
    if (modeBanner) modeBanner.textContent = "✓ On-device mode. Your entries are not synced.";
    // The local preview is separate from private, synced records.
    transactions = loadTransactions();
    // Never repopulate a signed-out workspace with shared sample customer data.
    demoMode = false;
    const banner = document.getElementById("demoBanner");
    if (banner) banner.style.display = "none";
    if (document.getElementById("app") && !document.getElementById("app").classList.contains("hidden")) {
      navigate("dashboard");
    }
  }
  async function loadLedger() {
    if (!signedIn()) return;
    const value = await request("/transactions");
    const rows = value.transactions || [];
    transactions = rows.map(row => ({
      id: row.id, customer: row.customer, customer_id: row.customer_id ?? null,
      customer_code: row.customer_code || "", customer_identifier: row.customer_identifier || "",
      kind: row.kind, amount: Number(row.amount), note: row.note || "",
      created_at: row.created_at
    }));
    demoMode = false;
    const banner = document.getElementById("demoBanner");
    if (banner) banner.style.display = "none";
    showMode("Connected: transactions are stored in your authenticated SQLite ledger.");
    const modeBanner = document.getElementById("accountModeBanner");
    if (modeBanner) modeBanner.textContent = "✓ Google account connected — ledger sync is enabled.";
    if (document.getElementById("app") && !document.getElementById("app").classList.contains("hidden")) navigate("dashboard");
  }
  async function onCredential(response) {
    try {
      // Verify Google ID token with our server before treating it as signed in.
      const result = await request("/auth/google", {
        method:"POST", body:JSON.stringify({credential:response.credential})
      });
      sessionStorage.setItem(TOKEN_KEY, response.credential);
      user = result;
      showLogin();
      await loadLedger();
      if (window.VoiceKhataPortal?.openWithGoogle) window.VoiceKhataPortal.openWithGoogle(result);
    } catch (e) {
      sessionStorage.removeItem(TOKEN_KEY); user = null; showLogin();
      showMode("Google sign-in could not be completed. Check OAuth JavaScript origins, your backend and the account used. " + e.message);
    }
  }
  async function initialize() {
    const status = document.createElement("p");
    status.id = "cloudStatus";
    status.style.cssText = "margin:10px 0;font-size:11px;line-height:1.5;color:#547064";
    const card = document.createElement("div");
    card.id = "cloudAccount";
    card.style.cssText = "display:grid;gap:5px;padding:10px 0";
    const panel = document.querySelector(".sidebar-foot");
    if (!panel) return;
    const banner = document.createElement("div");
    banner.id = "accountModeBanner";
    banner.setAttribute("role", "status");
    banner.style.cssText = "padding:10px 12px;border:1px solid #d7e7db;border-radius:10px;background:#eef8f0;color:#254d38;font-size:12px;line-height:1.5;margin-bottom:12px";
    banner.textContent = base ? "Checking Google account connection…" : "✓ Continue without login. Your khata works on this device. Google sync needs a hosted backend.";
    panel.prepend(banner);
    panel.prepend(status, card);
    if (!base) {
      showMode("Offline workspace: your ledger is saved only in this browser. Google login and sync are unavailable until a HTTPS backend is deployed.");
      showLogin();
      return;
    }
    try {
      const config = await request("/auth/config");
      if (!config.google_client_id) {
        showMode("Google login is not yet enabled. Configure GOOGLE_CLIENT_ID in the backend and authorize this website's origin in Google Cloud.");
        showLogin();
        return;
      }
      if (token()) {
        try {
          user = await request("/auth/me");
          showLogin();
          await loadLedger();
        } catch {
          sessionStorage.removeItem(TOKEN_KEY); user = null;
        }
      }
      if (signedIn()) showMode("Connected: transactions are stored in your authenticated SQLite ledger.");
      else showMode("Connect your Google account to use the private cloud ledger.");
      showLogin();
      const login = document.createElement("div");
      login.id = "cloudGoogleSignIn";
      const portalHost = document.getElementById("portalGoogleButton");
      if (portalHost) portalHost.appendChild(login);
      else panel.insertBefore(login, status);
      const start = () => {
        if (!window.google?.accounts?.id) {showMode("Google sign-in could not load.");return;}
        window.google.accounts.id.initialize({client_id:config.google_client_id,callback:onCredential});
        window.google.accounts.id.renderButton(login,{type:"standard",theme:"outline",size:"medium",width:190});
      };
      if (window.google?.accounts?.id) start();
      else {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.onload = start;
        script.onerror = () => showMode("Google sign-in script unavailable.");
        document.head.appendChild(script);
      }
    } catch (error) {
      showMode("Cannot contact the configured API. Your browser-only ledger still works; check the HTTPS backend URL and CORS. " + error.message);
      showLogin();
    }
  }
  window.VoiceKhataCloud = {request, signedIn, loadLedger, signOut};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
