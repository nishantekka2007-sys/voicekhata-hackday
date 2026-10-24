const assert = require("node:assert/strict");
const {parse, toAsciiDigits, extractAmount, detectKind, isMultiple} = require("./transaction-parser.js");
assert.equal(toAsciiDigits("₹५००"), "₹500");
assert.equal(parse("Ramesh ne 500 rupaye wapas diye").kind, "payment_received");
assert.equal(parse("Ramesh ko 200 rupaye udhaar diye").kind, "credit_sale");
assert.equal(parse("रमेश ने ५०० रुपये वापस दिए").amount, 500);
assert.equal(parse("रमेश ने ५०० रुपये वापस दिए").kind, "payment_received");
assert.equal(parse("रमेश को २०० रुपये उधार दिए").kind, "credit_sale");
assert.equal(parse("रमेश को २०० रुपये उधार दिए").customer, "रमेश");
assert.equal(parse("Suresh ko 300 rupaye udhaar diye").amount, 300);
assert.equal(parse("Anita paid 500 rupees").kind, "payment_received");
const separate = parse("Ramesh ne 500 diye aur Suresh ko 200 udhaar diya");
assert.equal(separate.entries?.length, 2);
assert.equal(separate.entries[0].amount, 500);
assert.equal(separate.entries[1].amount, 200);
assert.equal(separate.entries[0].kind, "payment_received");
assert.equal(separate.entries[1].kind, "credit_sale");
assert.equal(parse("रमेश को चाय और चीनी २०० रुपये उधार दिए").error, undefined);
assert.equal(parse("रमेश को चाय और चीनी २०० रुपये उधार दिए").amount, 200);
assert.equal(parse("Suresh ko tea and sugar 300 rupees on credit").entries, undefined);
assert.equal(parse("रमेश ने चाय और चीनी के ५०० रुपये जमा किए").entries, undefined);
assert.equal(parse("Ramesh ko 200 udhaar aur bas itna hi").entries, undefined);
const hindiPair = parse("रमेश ने ५०० रुपये वापस दिए और सुरेश को २०० रुपये उधार दिए");
assert.equal(hindiPair.entries?.length, 2);
assert.equal(hindiPair.entries[0].amount, 500);
assert.equal(hindiPair.entries[1].amount, 200);
assert.equal(isMultiple("रमेश को चाय और चीनी २०० रुपये उधार दिए"), false);
assert.equal(isMultiple("रमेश ने ५०० रुपये वापस दिए और सुरेश को २०० रुपये उधार दिए"), true);
assert.equal(parse("Ramesh ko 2 kilo chawal udhaar diya").missing_fields.includes("amount"), true);
assert.equal(parse("Ramesh ko ₹0 udhaar").missing_fields.includes("amount"), true);
assert.equal(parse("").error, "Please speak or type a transaction.");
assert.equal(parse("Amit ne २०० रुपये जमा किये").kind, "payment_received");
console.log("VoiceKhata multilingual parser tests passed.");

const robustExamples = [
  ["रमेश को पाँच सौ रुपये उधार दिए", "रमेश", 500, "credit_sale"],
  ["रमेश को पांच सौ रुपए उधार दिए", "रमेश", 500, "credit_sale"],
  ["रमेश ने दो सौ रुपये वापस दिए", "रमेश", 200, "payment_received"],
  ["आज रमेश को ५०० रुपये उधार दिए", "रमेश", 500, "credit_sale"],
  ["Suresh ko 300 rupaye udhaar diya", "Suresh", 300, "credit_sale"],
  ["Anita paid 500 rupees", "Anita", 500, "payment_received"],
  ["रमेश को चाय और चीनी २०० रुपये उधार दिए", "रमेश", 200, "credit_sale"],
  ["500 रुपये का खर्च", "Shop Expense", 500, "cash_expense"],
  ["Ramesh took 150 on credit", "Ramesh", 150, "credit_sale"],
  ["Mukesh paid 750", "Mukesh", 750, "payment_received"]
];
for (const [text, customer, amount, kind] of robustExamples) {
  const draft = parse(text);
  assert.equal(draft.customer, customer, "customer: " + text);
  assert.equal(draft.amount, amount, "amount: " + text);
  assert.equal(draft.kind, kind, "kind: " + text);
  assert.deepEqual(draft.missing_fields, [], "missing fields: " + text);
}
assert.equal(parse("मुझे सामान मिला").missing_fields.includes("amount"), true);
assert.equal(parse("अज्ञात बात").kind, "");
assert.equal(parse("अज्ञात बात").amount, "");
assert.equal(parse("अज्ञात बात").missing_fields.includes("transaction type"), true);
