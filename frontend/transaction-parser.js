/* Conservative, review-first multilingual transaction parser for the browser-only demo.
   Never save a guessed name, price, or multi-transaction sentence. */
(function (root) {
  "use strict";
  const DIGITS = "०१२३४५६७८९";
  const MONEY_UNIT = "(?:रुपये|रुपए|रुपया|रूपये|रु\\.?|rupees?|rupaye|rupay|rupiya|rs\\.?)";
  const MONEY_AFTER = new RegExp("(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s*" + MONEY_UNIT, "iu");
  const MONEY_BEFORE = new RegExp("(?:₹|rs\\.?)\\s*(\\d[\\d,]*(?:\\.\\d{1,2})?)", "iu");
  const HINDI = {
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
    "छह": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
    "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50,
    "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
    "सौ": 100, "हजार": 1000, "हज़ार": 1000, "हजारों": 1000,
    "ek": 1, "do": 2, "teen": 3, "char": 4, "paanch": 5, "panch": 5,
    "das": 10, "bees": 20, "tees": 30, "pachas": 50,
    "sau": 100, "hazaar": 1000, "hazar": 1000
  };
  function toAsciiDigits(input) {
    return String(input || "").replace(/[०-९]/g, ch => String(DIGITS.indexOf(ch)));
  }
  function isMultiple(text) {
    // Only split on explicit AND words, never just two item nouns or a comma.
    return /(?:\s+(?:aur|and|ani)\s+|और|आणि)/iu.test(text);
  }
  function wordAmount(text) {
    // Only consider number words directly next to an explicit currency unit.
    const match = text.match(new RegExp("([\\p{L}]+)(?:\\s+([\\p{L}]+))?\\s+" + MONEY_UNIT, "iu"));
    if (!match) return null;
    const a = HINDI[match[1].toLowerCase()];
    const b = match[2] ? HINDI[match[2].toLowerCase()] : null;
    if (!Number.isFinite(a)) return null;
    if (!match[2]) return a;
    if (!Number.isFinite(b)) return null;
    if (b === 100 || b === 1000) return a * b;
    if (a === 100 || a === 1000) return a + b;
    // Do not guess arbitrary mixed number words.
    return null;
  }
  function extractAmount(text) {
    const explicit = text.match(MONEY_BEFORE) || text.match(MONEY_AFTER);
    if (explicit) {
      const value = Number(explicit[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0 && value <= 100000000) return value;
      return null;
    }
    const spoken = wordAmount(text);
    if (spoken !== null) return spoken;
    const numeric = text.match(/\d[\d,]*(?:\.\d{1,2})?/);
    if (!numeric) return null;
    const after = text.slice(numeric.index + numeric[0].length).trimStart();
    if (/^(?:kg|kilo|kilos|gram|gms|litre|liter|litres|liters|ml|किलो|ग्राम|लीटर|पैकेट|packet|dozen)\b/iu.test(after)) return null;
    if (/^(?:किलो|ग्राम|लीटर|पैकेट)/u.test(after)) return null;
    const n = Number(numeric[0].replace(/,/g, ""));
    return n > 0 && n <= 100000000 ? n : null;
  }
  function detectKind(text) {
    const lower = text.toLowerCase();
    if (/(?:उधार|उधारी|उधारावर|उधारीवर|\budha+r\b|\budhar\b|\bcredit\b|\bon credit\b)/iu.test(lower)) return "credit_sale";
    if (/(?:खर्च|खर्[च्]|बिजली|बिजली बिल|\bexpense\b|\bshop rent\b|\brent\b|\bkharcha\b)/iu.test(lower)) return "cash_expense";
    if (/(?:वापस|जमा|भुगतान|परत|दिले|दिया|दिए|मिले|\bpaid\b|\bpayment\b|\brepaid\b|\breturned\b|\bwapas\b|\bjama\b|\breceived\b|\bdiye\b|\bdiya\b)/iu.test(lower)) {
      if (/(?:\bko\b|को|ला)\s*[\s\S]*(?:दिया|दिए|diye|diya)/iu.test(lower) && !/(?:\bne\b|ने|ने\s)/iu.test(lower)) return "credit_sale";
      return "payment_received";
    }
    if (/(?:\btook\b|\bliya\b|लिया|घेतले)/iu.test(lower)) return "credit_sale";
    return null;
  }
  function extractCustomer(text, kind) {
    if (kind === "cash_expense") return "Shop Expense";
    const trimmed = text.replace(/^(?:आज|aaj|today|कल|yesterday|aaj\s+toh)\s+/iu, "").trim();
    const marathi = trimmed.match(/^([\p{L}\p{M}]{2,}?)(?:ला|ने)\s+/u);
    if (marathi) return marathi[1];
    const name = trimmed.match(/^([\p{L}\p{M}][\p{L}\p{M}.'-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}.'-]*){0,2}?)\s+(?:ने|को|से|ला|नी|नेच|\bne\b|\bko\b|\bse\b|\bpaid\b|\btook\b|\bgave\b)/iu);
    if (name) return name[1].trim();
    // Only infer the first word if there is an explicit transaction verb and amount.
    const first = trimmed.match(/^([\p{L}\p{M}][\p{L}\p{M}.'-]{1,40})\s+/u);
    if (first && /(paid|payment|udhaar|udhar|wapas|jama|उधार|वापस|जमा|दिए|दिया|दिले)/iu.test(trimmed)) {
      const candidate = first[1];
      if (!/^(?:मेरे|मैं|मुझे|आज|कल|for|gave|got|paid|payment|credit|उधार|दिया|दिए)$/iu.test(candidate)) return candidate;
    }
    return "";
  }
  function parse(text) {
    const original = String(text || "").trim();
    if (!original) return {error: "Please speak or type a transaction."};
    if (isMultiple(original)) return {error: "Multiple transactions found. Record them separately so no customer entry is missed."};
    const normalized = toAsciiDigits(original);
    const kind = detectKind(normalized);
    const amount = extractAmount(normalized);
    const customer = extractCustomer(normalized, kind);
    const missing = [];
    if (!customer) missing.push("customer");
    if (amount === null) missing.push("amount");
    if (!kind) missing.push("transaction type");
    return {
      customer, kind: kind || "credit_sale", amount: amount === null ? "" : amount,
      note: original,
      requires_confirmation: true,
      missing_fields: missing,
      review_warning: missing.length
        ? "Could not confidently identify: " + missing.join(", ") + ". Correct the fields before saving."
        : "Check the name, direction and amount before saving."
    };
  }
  const api = {parse, toAsciiDigits, extractAmount, detectKind, isMultiple};
  root.VoiceKhataParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
