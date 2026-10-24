/*
 * VoiceKhata start-screen workspace portal.
 * A device PIN is a CONVENIENCE LOCK only. localStorage ledger data is not encrypted
 * or authenticated by a server. Google sign-in uses the separate verified backend.
 */
(() => {
  "use strict";
  const SHOP_KEY = "vk.shop.v1";
  const PIN_KEY = "vk.device-pin.v1";
  const $ = id => document.getElementById(id);
  let attempts = 0;
  let unlockBlockedUntil = 0;
  const getProfile = () => {
    try { return JSON.parse(localStorage.getItem(SHOP_KEY) || "null"); }
    catch { return null; }
  };
  const bytesToHex = bytes => [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
  const hexToBytes = hex => new Uint8Array((hex.match(/.{2}/g) || []).map(x => parseInt(x, 16)));
  async function hashPin(pin, saltHex) {
    if (!window.crypto?.subtle) throw new Error("This browser cannot securely derive a device PIN. Use HTTPS or localhost.");
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
    );
    const result = await crypto.subtle.deriveBits(
      {name:"PBKDF2", salt:hexToBytes(saltHex), iterations:180000, hash:"SHA-256"},
      key, 256
    );
    return bytesToHex(new Uint8Array(result));
  }
  function message(text) {
    const node = $("portalError");
    if (node) node.textContent = text || "";
  }
  function setButton(form, busy) {
    const button = form?.querySelector("button[type=submit]");
    if (button) button.disabled = !!busy;
  }
  function validate(pin) {
    if (!/^\d{6,10}$/.test(pin)) throw new Error("Use a 6–10 digit device PIN.");
  }
  function enter() {
    const profile = getProfile();
    if (!profile) throw new Error("Shop profile is missing. Set up your shop again.");
    $("onboarding").style.display = "none";
    $("app").classList.remove("hidden");
    window.initApp();
  }
  function openWithGoogle(profile) {
    if (!getProfile()) {
      const ownerName = String(profile?.name || profile?.email || "Shop owner").trim().slice(0,80);
      localStorage.setItem(SHOP_KEY, JSON.stringify({ownerName, shopName:"My Shop"}));
    }
    message("");
    enter();
  }
  function show() {
    const profile = getProfile();
    const hasPin = !!localStorage.getItem(PIN_KEY);
    $("onboarding").style.display = "";
    $("app").classList.add("hidden");
    $("setupForm").classList.toggle("hidden", !!profile && hasPin);
    $("portalUnlockForm").classList.toggle("hidden", !profile || !hasPin);
    $("portalKnownShop").classList.toggle("hidden", !profile);
    const createButton = $("portalCreateButton");
    if (profile) {
      $("portalKnownName").textContent = profile.ownerName || "Shop owner";
      $("portalKnownShopName").textContent = profile.shopName || "My Shop";
      $("setupOwner").value = profile.ownerName || "";
      $("setupShop").value = profile.shopName || "";
    }
    if (hasPin && profile) {
      $("portalHeading").textContent = "Welcome back!";
      $("portalDescription").textContent = "Enter your device PIN to open your existing shop ledger.";
    } else if (profile) {
      $("portalHeading").textContent = "Protect your local khata";
      $("portalDescription").textContent = "Your existing transactions are preserved. Add a device PIN to reopen this shop next time.";
      if (createButton) createButton.textContent = "Set device PIN & open →";
    } else {
      $("portalHeading").textContent = "Your shop, in your words";
      $("portalDescription").textContent = "Create a local shop workspace to start recording udhaar in Hindi, Marathi or English.";
      if (createButton) createButton.textContent = "Create local workspace →";
    }
    message("");
  }
  async function create(event) {
    event.preventDefault();
    const form = $("setupForm");
    setButton(form, true);
    try {
      const pin = $("setupPin").value.trim();
      validate(pin);
      const ownerName = $("setupOwner").value.trim();
      const shopName = $("setupShop").value.trim();
      if (!ownerName || !shopName) throw new Error("Enter the shop owner and shop name.");
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);
      const saltHex = bytesToHex(salt);
      const hash = await hashPin(pin, saltHex);
      localStorage.setItem(SHOP_KEY, JSON.stringify({ownerName, shopName}));
      localStorage.setItem(PIN_KEY, JSON.stringify({salt:saltHex, hash, version:1}));
      $("setupPin").value = "";
      enter();
    } catch (error) { message(error.message || "Could not create your device workspace."); }
    finally { setButton(form, false); }
  }
  async function unlock(event) {
    event.preventDefault();
    const form = $("portalUnlockForm");
    if (Date.now() < unlockBlockedUntil) { message("Too many incorrect PINs. Try again in one minute."); return; }
    setButton(form, true);
    try {
      const pin = $("portalPin").value.trim();
      validate(pin);
      const data = JSON.parse(localStorage.getItem(PIN_KEY) || "null");
      if (!data || !data.salt || !data.hash) throw new Error("Device PIN data is unavailable.");
      const derived = await hashPin(pin, data.salt);
      if (derived !== data.hash) {
        attempts++;
        if (attempts >= 5) { attempts = 0; unlockBlockedUntil = Date.now() + 60000; }
        throw new Error("Incorrect device PIN. Your ledger has not been changed.");
      }
      attempts = 0;
      $("portalPin").value = "";
      enter();
    } catch (error) { message(error.message || "Could not open this shop."); }
    finally { setButton(form, false); }
  }
  function signOut() {
    window.VoiceKhataWhisper?.cancel();
    if (window.VoiceKhataCloud?.signedIn()) window.VoiceKhataCloud.signOut();
    $("portalPin").value = "";
    show();
  }
  function initialize() {
    $("setupForm").addEventListener("submit", create);
    $("portalUnlockForm").addEventListener("submit", unlock);
    $("portalLogout").addEventListener("click", signOut);
    show();
  }
  window.VoiceKhataPortal = {show, openWithGoogle, signOut};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
