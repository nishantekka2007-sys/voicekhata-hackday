/* Google Identity Services sign-in + authenticated API wrapper for VoiceKhata. */
(() => {
  // Set window.VOICEKHATA_API_BASE before this script when the API is hosted separately.
const API_BASE = window.VOICEKHATA_API_BASE || (
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:8000/api"
    : window.location.origin.replace(/\/$/, "") + "/api"
);
  const TOKEN_KEY = "voicekhata.google_id_token";
  const PROFILE_KEY = "voicekhata.profile";
  let config = { google_client_id: "", google_login_enabled: false };

  const token = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const profile = () => {
    try { return JSON.parse(sessionStorage.getItem(PROFILE_KEY) || "null"); }
    catch { return null; }
  };
  const setProfile = value => {
    if (value) sessionStorage.setItem(PROFILE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PROFILE_KEY);
  };
  const setToken = value => {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  };

  async function request(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token() ? { Authorization: "Bearer " + token() } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(API_BASE + path, { ...options, headers });
    let data = null;
    try { data = response.status === 204 ? null : await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) {
        setToken("");
        setProfile(null);
        document.dispatchEvent(new CustomEvent("voicekhata:auth-required"));
      }
      throw new Error(data?.detail || "Request failed (" + response.status + ")");
    }
    return data;
  }

  function showAuthError(message) {
    const node = document.getElementById("authMessage");
    if (node) node.textContent = message || "";
  }

  function updateHeader(user) {
    const signIn = document.getElementById("googleSignIn");
    const identity = document.getElementById("signedInIdentity");
    const name = document.getElementById("signedInName");
    const image = document.getElementById("signedInImage");
    if (signIn) signIn.classList.toggle("hidden", !!user);
    if (identity) identity.classList.toggle("hidden", !user);
    if (name) name.textContent = user ? (user.name || user.email) : "Not signed in";
    const topName = document.getElementById("signedInNameTop");
    if (topName) topName.textContent = user ? (user.name || user.email) : "";
    if (image) {
      image.src = user?.picture || "";
      image.alt = user ? (user.name || "Account photo") : "";
      image.classList.toggle("hidden", !user?.picture);
    }
  }

  async function onGoogleCredential(response) {
    showAuthError("");
    try {
      const result = await fetch(API_BASE + "/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(data.detail || "Google sign-in failed.");
      setToken(response.credential);
      setProfile(data);
      updateHeader(data);
      showAuthError("");
      document.dispatchEvent(new CustomEvent("voicekhata:authenticated", { detail: data }));
      if (window.VoiceKhata?.loadFromBackend) await window.VoiceKhata.loadFromBackend();
    } catch (error) {
      showAuthError(error.message + " Check that the Google client ID and backend are configured.");
    }
  }

  async function init() {
    try {
      config = await request("/auth/config");
    } catch {
      showAuthError("Cannot reach the backend. Start FastAPI at http://127.0.0.1:8000.");
      return;
    }

    if (!config.google_login_enabled || !config.google_client_id) {
      showAuthError("Google login is not configured yet. Add GOOGLE_CLIENT_ID to the backend environment.");
      return;
    }

    const existingToken = token();
    if (existingToken) {
      try {
        const user = await request("/auth/me");
        setProfile(user);
        updateHeader(user);
      } catch {
        setToken("");
        setProfile(null);
        updateHeader(null);
      }
    } else {
      updateHeader(null);
    }

    const startGoogle = () => {
      if (!window.google?.accounts?.id) {
        showAuthError("Google sign-in script did not load. Check your internet connection.");
        return;
      }
      window.google.accounts.id.initialize({
        client_id: config.google_client_id,
        callback: onGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      const button = document.getElementById("googleSignIn");
      if (button) {
        button.innerHTML = "";
        window.google.accounts.id.renderButton(button, {
          type: "standard", theme: "outline", size: "large",
          text: "signin_with", shape: "rectangular", logo_alignment: "left",
          width: Math.min(280, Math.max(220, button.parentElement?.clientWidth || 280))
        });
      }
    };
    if (window.google?.accounts?.id) startGoogle();
    else {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.google?.accounts?.id) {
          window.clearInterval(timer);
          startGoogle();
        } else if (attempts >= 40) {
          window.clearInterval(timer);
          showAuthError("Google sign-in script did not load. Check your internet connection.");
        }
      }, 250);
    }
  }

  function signOut() {
    setToken("");
    setProfile(null);
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    updateHeader(null);
    document.dispatchEvent(new CustomEvent("voicekhata:signed-out"));
    window.location.reload();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const signOutButton = document.getElementById("signOutButton");
    if (signOutButton) signOutButton.addEventListener("click", signOut);
    const profileButton = document.getElementById("profileButton");
    if (profileButton) profileButton.addEventListener("click", () => {
      const menu = document.getElementById("accountMenu");
      if (menu) menu.classList.toggle("hidden");
    });
    init();
  });

  window.VoiceKhataAuth = {
    request, token, profile,
    isSignedIn: () => !!token(),
    signOut,
    getApiBase: () => API_BASE
  };
})();
