/* VoiceKhata frontend. Authenticated requests use Google Identity Services. */
const API_BASE = window.VOICEKHATA_API_BASE || "http://127.0.0.1:8000/api";
const authRequest = (path, options={}) => {
  if (!window.VoiceKhataAuth?.isSignedIn()) throw new Error("Sign in with Google before accessing your ledger.");
  return window.VoiceKhataAuth.request(path, options);
};
const DEMO_TRANSACTIONS = [
  {id:1,customer:"Ramesh Kumar",note:"2 kg basmati rice",kind:"credit_sale",amount:500,created_at:new Date(Date.now()-1000*60*24).toISOString()},
  {id:2,customer:"Anita Devi",note:"Part payment",kind:"payment_received",amount:1200,created_at:new Date(Date.now()-1000*60*87).toISOString()},
  {id:3,customer:"Pankaj Singh",note:"Cooking oil",kind:"credit_sale",amount:850,created_at:new Date(Date.now()-1000*60*190).toISOString()},
  {id:4,customer:"Suresh Yadav",note:"Electricity bill",kind:"cash_expense",amount:650,created_at:new Date(Date.now()-1000*60*300).toISOString()},
  {id:5,customer:"Meena Kumari",note:"Monthly grocery",kind:"credit_sale",amount:1250,created_at:new Date(Date.now()-1000*60*450).toISOString()},
  {id:6,customer:"Ramesh Kumar",note:"Old balance",kind:"payment_received",amount:300,created_at:new Date(Date.now()-1000*60*800).toISOString()}
];
const LOCAL_LEDGER_KEY = "voicekhata.preview.transactions.v1";
function readLocalTransactions(){
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_LEDGER_KEY) || "[]");
    return Array.isArray(rows) ? rows.map(normalizeTransaction) : [];
  } catch { return []; }
}
function saveLocalTransactions(){
  try { localStorage.setItem(LOCAL_LEDGER_KEY, JSON.stringify(transactions)); return true; }
  catch { showToast("This browser could not save local entries. Check storage settings."); return false; }
}
let transactions = readLocalTransactions();
let demoMode = !window.VoiceKhataAuth?.isSignedIn();
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let toastTimer = null;
let chartInstance = null;
const $ = id => document.getElementById(id);
const rupees = value => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(value)||0);
const esc = value => String(value ?? "").replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const kindLabels = {credit_sale:"Credit given",payment_received:"Payment received",cash_expense:"Shop expense"};
function showToast(message){const node=$("toast");node.textContent=message;node.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove("show"),3600);}
function dateTime(value){const d=new Date(value);return Number.isNaN(d.getTime())?"Just now":d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})+" · "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});}
function initials(name){return String(name||"?").trim().split(/\s+/).slice(0,2).map(word=>word[0]||"").join("").toUpperCase();}
function kindClass(kind){return kind==="credit_sale"?"type-credit":kind==="payment_received"?"type-payment":"type-expense";}
function amountText(item){const sign=item.kind==="credit_sale"?"+":item.kind==="payment_received"?"−":"−";return sign+rupees(item.amount);}
function transactionRow(item,index){return `<tr><td><div class="person-cell"><span class="person-avatar tone-${index%4}">${esc(initials(item.customer))}</span><span class="person-details"><strong>${esc(item.customer)}</strong><small>${esc([item.product,item.note].filter(Boolean).join(" · ")||"No note added")}</small></span></div></td><td><span class="type-pill ${kindClass(item.kind)}">${esc(kindLabels[item.kind]||item.kind)}</span></td><td>${esc(dateTime(item.created_at))}</td><td class="amount-cell ${item.kind!=="payment_received"?"outgoing":""}">${esc(amountText(item))}</td><td><span class="status-pill">✓ Saved</span></td></tr>`;}
function renderTransactions(){
  const recent=[...transactions].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  $("recentRows").innerHTML=recent.slice(0,5).map(transactionRow).join("")||'<tr><td colspan="5">No transactions yet.</td></tr>';
  const q=($("ledgerSearch")?.value||"").toLowerCase();
  const filtered=recent.filter(item=>(item.customer+" "+item.note+" "+kindLabels[item.kind]).toLowerCase().includes(q));
  $("ledgerRows").innerHTML=filtered.map(transactionRow).join("")||'<tr><td colspan="5">No matching transactions.</td></tr>';
  if($("ledgerCount"))$("ledgerCount").textContent=`${filtered.length} transaction${filtered.length===1?"":"s"} shown`;
}
function balancesByCustomer(){
  const balances={};
  for(const item of transactions){
    if(item.kind==="cash_expense")continue;
    balances[item.customer]=(balances[item.customer]||0)+(item.kind==="credit_sale"?Number(item.left_amount??item.amount):-Number(item.amount));
  }
  return Object.entries(balances).map(([customer,balance])=>({customer,balance})).sort((a,b)=>a.customer.localeCompare(b.customer));
}
function renderCustomers(){
  const q=($("customerSearch")?.value||"").toLowerCase();
  const rows=balancesByCustomer().filter(item=>item.customer.toLowerCase().includes(q));
  $("customerGrid").innerHTML=rows.map((item,index)=>`<article class="customer-card"><span class="person-avatar tone-${index%4}">${esc(initials(item.customer))}</span><span class="customer-info"><strong>${esc(item.customer)}</strong><small>Customer account</small></span><span class="customer-balance"><strong>${rupees(item.balance)}</strong><small>${item.balance>0?"Outstanding":item.balance<0?"Credit balance":"Settled"}</small></span></article>`).join("")||'<p class="muted">No customers found yet.</p>';
}
function updateMetrics(){
  const balances=balancesByCustomer();
  const due=balances.reduce((sum,item)=>sum+Math.max(0,item.balance),0);
  const today=new Date().toDateString();
  const todayRows=transactions.filter(item=>new Date(item.created_at).toDateString()===today);
  const collected=todayRows.filter(item=>item.kind==="payment_received").reduce((sum,item)=>sum+Number(item.amount),0);
  const credit=todayRows.filter(item=>item.kind==="credit_sale").reduce((sum,item)=>sum+Number(item.amount),0);
  $("totalDue").textContent=rupees(due);
  $("collectedToday").textContent=rupees(collected);
  $("creditToday").textContent=rupees(credit);
  const creditCount=$("creditCountToday");if(creditCount)creditCount.textContent=todayRows.filter(item=>item.kind==="credit_sale").length+" transactions";
  $("activeCustomers").textContent=String(balances.length);
  const title=document.querySelector("#view-dashboard .page-heading h1");
  const user=window.VoiceKhataAuth?.profile();
  if(title) title.innerHTML="Welcome"+(user?.name ? ", "+esc(user.name.split(" ")[0]) : " to VoiceKhata")+' <span class="wave">✳</span>';
}
function renderChart(){
  const canvas=$("moneyChart");if(!canvas||!window.Chart)return;
  if(chartInstance)chartInstance.destroy();
  const ordered=[...transactions].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const isMonth=$("chartRange").value==="month";
  const now=new Date();
  const points=[];
  const dayCount=isMonth?30:7;
  for(let offset=dayCount-1;offset>=0;offset--){
    const day=new Date(now);day.setHours(0,0,0,0);day.setDate(day.getDate()-offset);
    const key=day.toDateString();
    const rows=ordered.filter(item=>new Date(item.created_at).toDateString()===key);
    points.push({
      label:isMonth?day.toLocaleDateString("en-IN",{day:"numeric",month:"short"}):day.toLocaleDateString("en-IN",{weekday:"short"}),
      credit:rows.filter(item=>item.kind==="credit_sale").reduce((sum,item)=>sum+Number(item.amount),0),
      payments:rows.filter(item=>item.kind==="payment_received").reduce((sum,item)=>sum+Number(item.amount),0)
    });
  }
  const labels=points.map(point=>point.label);
  const credit=points.map(point=>point.credit);
  const payment=points.map(point=>point.payments);
  chartInstance=new Chart(canvas,{type:"line",data:{labels,datasets:[{label:"Credit given",data:credit,borderColor:"#2f7157",backgroundColor:"rgba(47,113,87,.08)",borderWidth:2,pointRadius:3,pointBackgroundColor:"#2f7157",fill:true,tension:.36},{label:"Payments collected",data:payment,borderColor:"#e6b777",backgroundColor:"rgba(230,183,119,.04)",borderWidth:2,pointRadius:3,pointBackgroundColor:"#e6b777",fill:false,tension:.36}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>context.dataset.label+": "+rupees(context.raw)}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:"#9aa59e",font:{family:"DM Sans",size:10},maxTicksLimit:isMonth?10:7}},y:{beginAtZero:true,grid:{color:"#eff3ef"},border:{display:false},ticks:{color:"#9aa59e",font:{family:"DM Sans",size:9},callback:value=>value>=1000?"₹"+value/1000+"k":"₹"+value}}}}});
}
function renderAll(){renderTransactions();renderCustomers();updateMetrics();renderChart();}
function navigate(view){
  document.querySelectorAll(".view").forEach(node=>node.classList.toggle("active-view",node.id==="view-"+view));
  document.querySelectorAll(".nav-item").forEach(node=>node.classList.toggle("active",node.dataset.view===view));
  const labels={dashboard:"Overview",ledger:"Khata ledger",voice:"Voice entry",customers:"Customers"};
  $("breadcrumbCurrent").textContent=labels[view]||"Overview";
  $("sidebar").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
}
async function apiRequest(path,options={}){
  if (window.VoiceKhataAuth?.isSignedIn()) return authRequest(path, options);
  const response=await fetch(API_BASE+path,{...options,headers:{"Accept":"application/json",...(options.body instanceof FormData?{}:{"Content-Type":"application/json"}),...(options.headers||{})}});
  if(!response.ok)throw new Error("API request failed ("+response.status+")");
  return response.status===204?null:response.json();
}
function normalizeTransaction(raw){
  return {id:raw.id??Date.now(),customer:raw.customer??raw.customer_name??"",note:raw.note??raw.item??"",kind:raw.kind??raw.transaction_type??"credit_sale",amount:Number(raw.amount??raw.amount_rupees??0),product:raw.product??"",paid_amount:Number(raw.paid_amount??0),left_amount:Number(raw.left_amount??raw.amount??0),created_at:raw.created_at??new Date().toISOString()};
}
async function loadFromBackend(){
  if (!window.VoiceKhataAuth?.isSignedIn()) {
    transactions=[];
    demoMode=true;
    renderAll();
    const banner=$("modeBanner");
    if(banner) banner.innerHTML='<span class="status-dot"></span><span><strong>Sign in required</strong> — use Google sign-in to load your private ledger. No sample transactions are shown.</span>';
    return;
  }
  try{
    const data=await authRequest("/transactions");
    const rows=Array.isArray(data)?data:(data.transactions||data.items||[]);
    transactions=rows.map(normalizeTransaction);
    demoMode=false;
    try {
      const summary=await authRequest("/summary");
      $("totalDue").textContent=rupees(summary.total_due);
      $("collectedToday").textContent=rupees(summary.collected_today);
      $("creditToday").textContent=rupees(summary.credit_today);
      $("activeCustomers").textContent=String(summary.active_customers);
    } catch (summaryError) { console.info("Summary endpoint unavailable; calculating visible totals locally."); }
    const banner=$("modeBanner");
    if(banner){
      banner.innerHTML='<span class="status-dot" style="background:#419467"></span><span><strong>Connected securely</strong> — this is your private ledger.</span><button id="bannerDismiss" aria-label="Dismiss notice">×</button>';
      $("bannerDismiss").addEventListener("click",()=>$("modeBanner").remove());
    }
    renderAll();
  }catch(error){
    transactions=[];
    demoMode=true;
    renderAll();
    showToast(error.message || "Could not load your ledger.");
  }
}
function parseSimpleText(text){
  const amountMatch=text.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?:\s*(?:rupees?|rs\.?|rupaye|rupya|रुपये|रुपया))?/i);
  const amount=amountMatch?Number(amountMatch[1].replace(/,/g,"")):0;
  const lower=text.toLowerCase();
  const kind=/\b(paid|payment|gave me|repaid|returned|collected|jama kiya|paise mile|wapas kiya)\b/.test(lower)?"payment_received":/\b(expense|electricity bill|rent|bought for shop|kharcha|dukaan ke liye kharida)\b/.test(lower)?"cash_expense":"credit_sale";
  let customer=text.trim();
  if(amountMatch)customer=customer.replace(amountMatch[0]," ");
  customer=customer.replace(/\b(on credit|as credit|credit|worth of|worth|rupees?|rupaye|rupya|rs\.?|paid|payment|gave me|repaid|returned|collected|took|bought|for|to|from|the|me|and|ko|ka|ki|ke|udhaar|diya|diye|liya|liye|jama|kiya|kharcha)\b/gi," ").replace(/[₹,:]/g," ").replace(/\s+/g," ").trim();
  const words=customer.split(" ").filter(Boolean);
  const name=words.slice(0,2).join(" ").replace(/\b\w/g,c=>c.toUpperCase());
  return {customer:name,kind,amount,note:text.trim()};
}
async function understandTransaction(){
  const text=$("transcriptInput").value.trim();
  if(!text){showToast("Record or type a transaction first.");return;}
  if(!window.VoiceKhataAuth?.isSignedIn()){showToast("Sign in with Google before creating a transaction.");return;}
  $("understandButton").disabled=true;$("understandButton").textContent="Understanding…";
  if(!text){showToast("Type a transaction first.");return;}
  $("understandButton").disabled=true;$("understandButton").textContent="Preparing draft…";
  let parsed;
  const selectedLanguage=$("languageSelect").value;
  const language=selectedLanguage==="mixed"?"auto":selectedLanguage;
  try{
    if (!window.VoiceKhataAuth?.isSignedIn()) throw new Error("Sign in with Google before creating a transaction.");
    parsed=await authRequest("/transactions/parse",{method:"POST",body:JSON.stringify({text,language:$("languageSelect").value})});
    parsed=normalizeTransaction(parsed);
  }catch(error){
    parsed=parseSimpleText(text);
    showToast((window.VoiceKhataAuth?.isSignedIn() ? error.message : "Sign in with Google to save a transaction.") + " Carefully review the draft.");
  }finally{$("understandButton").disabled=false;$("understandButton").innerHTML='Understand transaction <span>→</span>';}
  $("reviewCustomer").value=parsed.customer||"";
  $("reviewKind").value=["credit_sale","payment_received","cash_expense"].includes(parsed.kind)?parsed.kind:"credit_sale";
  $("reviewProduct").value=parsed.product||parsed.item||"";
  $("reviewAmount").value=parsed.amount||"";
  $("reviewPaidAmount").value=Number(parsed.paid_amount||0);
  updateLeftAmount();
  $("reviewNote").value=parsed.note||text;
  $("emptyReview").classList.add("hidden");$("reviewForm").classList.remove("hidden");
  $("reviewMessage").textContent="Draft prepared. Verify every field before saving.";
}
function openManualEntry(){
  navigate("voice");
  $("transcriptInput").value="";
  $("reviewCustomer").value="";
  $("reviewKind").value="credit_sale";
  $("reviewAmount").value="";
  $("reviewNote").value="";
  $("confirmCheck").checked=false;
  $("emptyReview").classList.add("hidden");
  $("reviewForm").classList.remove("hidden");
  $("reviewMessage").textContent="Manual entry: fill in the details, verify them, then confirm to save.";
  $("reviewCustomer").focus();
}
function updateLeftAmount(){const due=Number($("reviewAmount").value||0),paid=Number($("reviewPaidAmount").value||0);$("reviewLeftAmount").value=Math.max(0,due-paid).toFixed(2);}
async function saveTransaction(event){
  event.preventDefault();
  const due=Number($("reviewAmount").value), paid=Number($("reviewPaidAmount").value||0), left=Number((due-paid).toFixed(2));
  const item={customer:$("reviewCustomer").value.trim(),kind:$("reviewKind").value,amount:due,product:$("reviewProduct").value.trim(),paid_amount:paid,left_amount:left,note:$("reviewNote").value.trim()};
  if(!item.customer||!Number.isFinite(due)||due<=0||!Number.isFinite(paid)||paid<0||paid>due){showToast("Check customer and amounts. Paid now cannot exceed due amount.");return;}
  if(!$("confirmCheck").checked){showToast("Please confirm that you checked the details.");return;}
  if(!window.VoiceKhataAuth?.isSignedIn()){showToast("Sign in with Google before saving a transaction.");return;}
  const button=$("reviewForm").querySelector('button[type="submit"]');button.disabled=true;
  try{
    if (!window.VoiceKhataAuth?.isSignedIn()) throw new Error("Sign in with Google before saving a transaction.");
    const saved=await authRequest("/transactions",{method:"POST",body:JSON.stringify(item)});
    transactions.unshift(normalizeTransaction(saved));
    demoMode=false;
    showToast("Transaction saved to your private ledger.");
  }catch(error){
    button.disabled=false;
    showToast(error.message || "Could not save. Check your connection and try again.");
    return;
  }
  button.disabled=false;$("transcriptInput").value="";$("confirmCheck").checked=false;
  $("reviewForm").classList.add("hidden");$("emptyReview").classList.remove("hidden");
  renderAll();navigate("ledger");
}
async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){showToast("Microphone recording isn't supported in this browser. You can type the transaction instead.");return;}
  try{
    recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});
    recordedChunks=[];
    const preferred=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"";
    mediaRecorder=new MediaRecorder(recordingStream,preferred?{mimeType:preferred}:{});
    mediaRecorder.ondataavailable=event=>{if(event.data.size)recordedChunks.push(event.data);};
    mediaRecorder.onstop=async()=>{
      recordingStream?.getTracks().forEach(track=>track.stop());
      $("recordButton").classList.remove("recording");$("recordStatus").textContent="PROCESSING AUDIO";$("recordHint").textContent="Sending audio for transcription…";
      const blob=new Blob(recordedChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      const form=new FormData();form.append("file",blob,"voicekhata-recording.webm");form.append("language",$("languageSelect").value);
      try{
        if (!window.VoiceKhataAuth?.isSignedIn()) throw new Error("Sign in with Google before using voice entry.");
        const result=await authRequest("/voice/transcribe",{method:"POST",body:form});
        $("transcriptInput").value=result.text||result.transcript||"";
        $("recordHint").textContent="Transcription ready — review the text below";
        showToast("Audio transcribed. Now review the transaction details.");
      }catch(error){
        $("recordHint").textContent="Recording finished, but transcription API isn't connected yet.";
        showToast("Audio was not transcribed. Connect the faster-whisper endpoint or type the transaction.");
      }finally{$("recordStatus").textContent="READY WHEN YOU ARE";}
    };

    recognition.onresult = event => {
      interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = (event.results[i][0]?.transcript || "").trim();
        if (!phrase) continue;
        if (event.results[i].isFinal) finalText += phrase + " ";
        else interimText += phrase + " ";
      }
      $("transcriptInput").value = (finalText + interimText).trim();
      if ($("transcriptInput").value) {
        $("recordHint").textContent = "Speech detected — check the text below. Tap the mic to stop.";
      }
    };

    recognition.onerror = event => {
      const messages = {
        "not-allowed": "Microphone access is blocked. In Chrome, allow Microphone for localhost:5500 and try again.",
        "service-not-allowed": "The browser blocked its speech service. Check Chrome site permissions and try again.",
        "no-speech": "No speech detected. Tap the mic and begin speaking after it says RECORDING NOW.",
        "audio-capture": "No working microphone was found. Check your Mac's microphone input.",
        "network": "Chrome could not reach its speech-recognition service. Check your internet connection and retry.",
        "language-not-supported": "This speech language is not supported by the browser. Choose English, Hindi, or Bengali."
      };
      recognitionError = messages[event.error] || ("Speech recognition error: " + event.error);
      $("recordStatus").textContent = "RECORDING ISSUE";
      $("recordHint").textContent = recognitionError;
      if (event.error !== "aborted") showToast(recognitionError);
    };

    recognition.onend = () => {
      if (window.voiceKhataRecognition === recognition) window.voiceKhataRecognition = null;
      $("recordButton").classList.remove("recording");
      $("recordButton").setAttribute("aria-label", "Start recording");
      const hasText = !!$("transcriptInput").value.trim();
      $("recordStatus").textContent = hasText ? "TRANSCRIPTION READY" : "READY WHEN YOU ARE";
      if (!recognitionError) {
        $("recordHint").textContent = hasText
          ? "Text captured. Review or edit it, then choose Understand transaction."
          : "No words were captured. Allow microphone access, speak clearly, and try again.";
      }
    };

    recognition.start();
  } catch (error) {
    window.voiceKhataRecognition = null;
    $("recordButton").classList.remove("recording");
    $("recordButton").setAttribute("aria-label", "Start recording");
    $("recordStatus").textContent = "COULD NOT START";
    $("recordHint").textContent = "Check Chrome microphone permission, then try again or type the transaction.";
    showToast("Could not start speech recognition. Check Chrome microphone permission and try again.");
  }
}
function getShopProfile(){
  try{return JSON.parse(localStorage.getItem("voicekhata.shop.profile")||"null");}catch{return null;}
}
function applyShopProfile(profile){
  const shopLabel=$("shopNameLabel");
  const ownerLabel=$("shopOwnerLabel");
  const signedInName=$("signedInName");
  const signedInNameTop=$("signedInNameTop");
  const avatar=$("profileAvatar");
  if(shopLabel)shopLabel.textContent=profile?.shopName||"Your shop";
  if(ownerLabel)ownerLabel.textContent=profile?.ownerName||"Shop owner";
  if(signedInName)signedInName.textContent=profile?.ownerName||"Shop owner";
  if(signedInNameTop)signedInNameTop.textContent=profile?.shopName||"VoiceKhata";
  if(avatar)avatar.textContent=initials(profile?.ownerName||profile?.shopName||"VK");
}
function loadShopProfile(){
  let profile=getShopProfile();
  const params=new URLSearchParams(location.search);
  const ownerName=(params.get("ownerName")||profile?.ownerName||"").trim();
  const shopName=(params.get("shopName")||profile?.shopName||"").trim();
  if(ownerName&&shopName){
    profile={ownerName,shopName};
    try{localStorage.setItem("voicekhata.shop.profile",JSON.stringify(profile));}catch{}
  }
  applyShopProfile(profile);
  $("getStarted").classList.toggle("hidden",!!(profile?.ownerName&&profile?.shopName));
  document.querySelector(".app-shell").classList.toggle("hidden",!(profile?.ownerName&&profile?.shopName));
  if(profile?.ownerName&&$("setupOwnerName"))$("setupOwnerName").value=profile.ownerName;
  if(profile?.shopName&&$("setupShopName"))$("setupShopName").value=profile.shopName;
}
function finishSetup(event){
  event.preventDefault();
  const ownerName=$("setupOwnerName").value.trim();
  const shopName=$("setupShopName").value.trim();
  if(!ownerName||!shopName)return;
  const profile={ownerName,shopName};
  try{localStorage.setItem("voicekhata.shop.profile",JSON.stringify(profile));}
  catch{showToast("Could not save your shop profile in this browser.");return;}
  applyShopProfile(profile);
  $("getStarted").classList.add("hidden");
  document.querySelector(".app-shell").classList.remove("hidden");
  navigate("dashboard");
  showToast("Welcome to "+shopName+"!");
}
function logOutToSetup(){
  try{localStorage.removeItem("voicekhata.shop.profile");}catch{}
  $("accountMenu").classList.add("hidden");
  $("setupForm").reset();
  $("getStarted").classList.remove("hidden");
  document.querySelector(".app-shell").classList.add("hidden");
  applyShopProfile(null);
}
function setDates(){
  const now=new Date();
  $("todayLabel").textContent=now.toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  $("dateEyebrow").textContent=now.toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"}).toUpperCase();
  const dashboardEyebrow=document.querySelector("#view-dashboard .eyebrow");
  if(dashboardEyebrow) dashboardEyebrow.textContent=now.toLocaleDateString("en-IN",{weekday:"long"}).toUpperCase()+", "+now.toLocaleDateString("en-IN",{day:"numeric",month:"short"}).toUpperCase();
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>navigate(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach(button=>button.addEventListener("click",()=>navigate(button.dataset.go)));
$("setupForm").addEventListener("submit",finishSetup);
$("signOutButton").addEventListener("click",logOutToSetup);
document.querySelectorAll("[data-manual-entry]").forEach(button=>button.addEventListener("click",openManualEntry));
$("recordButton").addEventListener("click",startRecording);
$("understandButton").addEventListener("click",understandTransaction);
$("reviewForm").addEventListener("submit",saveTransaction);
$("reviewAmount").addEventListener("input",updateLeftAmount);
$("reviewPaidAmount").addEventListener("input",updateLeftAmount);
$("ledgerSearch").addEventListener("input",renderTransactions);
$("customerSearch").addEventListener("input",renderCustomers);
$("chartRange").addEventListener("change",renderChart);
$("menuButton").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
$("bannerDismiss").addEventListener("click",()=>$("modeBanner").remove());
$("helpButton").addEventListener("click",()=>$("helpModal").classList.remove("hidden"));
$("closeHelp").addEventListener("click",()=>$("helpModal").classList.add("hidden"));
$("helpModal").addEventListener("click",event=>{if(event.target===$("helpModal"))$("helpModal").classList.add("hidden");});
document.addEventListener("keydown",event=>{if(event.key==="Escape"){$("helpModal").classList.add("hidden");$("sidebar").classList.remove("open");}});
setDates();
if(!window.VoiceKhataAuth?.isSignedIn()){transactions=[];demoMode=true;}
renderAll();
document.addEventListener("voicekhata:authenticated",()=>loadFromBackend());
document.addEventListener("voicekhata:signed-out",()=>{transactions=[];demoMode=true;renderAll();});
document.addEventListener("voicekhata:auth-required",()=>{transactions=[];demoMode=true;renderAll();showToast("Your session needs Google sign-in again.");});
window.VoiceKhata={loadFromBackend,renderAll};
