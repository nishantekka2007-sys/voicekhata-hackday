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
let transactions = DEMO_TRANSACTIONS.map(item => ({...item}));
let demoMode = true;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let toastTimer = null;
let chartInstance = null;
const $ = id => document.getElementById(id);
const rupees = value => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(value)||0);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const kindLabels = {credit_sale:"Credit given",payment_received:"Payment received",cash_expense:"Shop expense"};
function showToast(message){const node=$("toast");node.textContent=message;node.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove("show"),3600);}
function dateTime(value){const d=new Date(value);return Number.isNaN(d.getTime())?"Just now":d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})+" · "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});}
function initials(name){return String(name||"?").trim().split(/\s+/).slice(0,2).map(word=>word[0]||"").join("").toUpperCase();}
function kindClass(kind){return kind==="credit_sale"?"type-credit":kind==="payment_received"?"type-payment":"type-expense";}
function amountText(item){const sign=item.kind==="credit_sale"?"+":item.kind==="payment_received"?"−":"−";return sign+rupees(item.amount);}
function transactionRow(item,index){return `<tr><td><div class="person-cell"><span class="person-avatar tone-${index%4}">${esc(initials(item.customer))}</span><span class="person-details"><strong>${esc(item.customer)}</strong><small>${esc(item.note||"No note added")}</small></span></div></td><td><span class="type-pill ${kindClass(item.kind)}">${esc(kindLabels[item.kind]||item.kind)}</span></td><td>${esc(dateTime(item.created_at))}</td><td class="amount-cell ${item.kind!=="payment_received"?"outgoing":""}">${esc(amountText(item))}</td><td><span class="status-pill">✓ Saved</span></td></tr>`;}
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
    balances[item.customer]=(balances[item.customer]||0)+(item.kind==="credit_sale"?Number(item.amount):-Number(item.amount));
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
  return {id:raw.id??Date.now(),customer:raw.customer??raw.customer_name??"",note:raw.note??raw.item??"",kind:raw.kind??raw.transaction_type??"credit_sale",amount:Number(raw.amount??raw.amount_rupees??0),created_at:raw.created_at??new Date().toISOString()};
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
  const amountMatch=text.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?:\s*(?:rupees?|rs\.?))?/i);
  const amount=amountMatch?Number(amountMatch[1].replace(/,/g,"")):0;
  const lower=text.toLowerCase();
  const kind=/\b(paid|payment|gave me|repaid|returned|collected)\b/.test(lower)?"payment_received":/\b(expense|electricity bill|rent|bought for shop)\b/.test(lower)?"cash_expense":"credit_sale";
  let customer=text.trim();
  if(amountMatch)customer=customer.replace(amountMatch[0]," ");
  customer=customer.replace(/\b(on credit|as credit|credit|worth of|worth|rupees?|rs\.?|paid|payment|gave me|repaid|returned|collected|took|bought|for|to|from|the|me|and)\b/gi," ").replace(/[₹,:]/g," ").replace(/\s+/g," ").trim();
  const words=customer.split(" ").filter(Boolean);
  const name=words.slice(0,2).join(" ").replace(/\b\w/g,c=>c.toUpperCase());
  return {customer:name,kind,amount,note:text.trim()};
}
async function understandTransaction(){
  const text=$("transcriptInput").value.trim();
  if(!text){showToast("Record or type a transaction first.");return;}
  if(!window.VoiceKhataAuth?.isSignedIn()){showToast("Sign in with Google before creating a transaction.");return;}
  $("understandButton").disabled=true;$("understandButton").textContent="Understanding…";
  let parsed;
  const selectedLanguage=$("languageSelect").value;
  const language=selectedLanguage==="mixed"?"auto":selectedLanguage;
  try{
    parsed=await authRequest("/transactions/parse",{method:"POST",body:JSON.stringify({text,language,input_language:selectedLanguage})});
    if(!parsed || !(parsed.customer||parsed.customer_name) || !(Number(parsed.amount??parsed.amount_rupees)>0)) throw new Error("AI did not return a clear customer and positive amount. Please edit your words and try again.");
    parsed=normalizeTransaction(parsed);
  }catch(error){
    showToast((error.message||"Could not understand this transaction.")+" Nothing was saved. Check the backend connection or edit the transcript.");
    return;
  }finally{$("understandButton").disabled=false;$("understandButton").innerHTML='Understand transaction <span>→</span>';}
  $("reviewCustomer").value=parsed.customer||"";
  $("reviewKind").value=["credit_sale","payment_received","cash_expense"].includes(parsed.kind)?parsed.kind:"credit_sale";
  $("reviewAmount").value=parsed.amount||"";
  $("reviewNote").value=parsed.note||text;
  $("emptyReview").classList.add("hidden");$("reviewForm").classList.remove("hidden");
  $("reviewMessage").textContent="";
}
async function saveTransaction(event){
  event.preventDefault();
  const item={customer:$("reviewCustomer").value.trim(),kind:$("reviewKind").value,amount:Number($("reviewAmount").value),note:$("reviewNote").value.trim()};
  if(!item.customer||!Number.isFinite(item.amount)||item.amount<=0){showToast("Please check the customer name and amount.");return;}
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
      const form=new FormData();form.append("file",blob,"voicekhata-recording.webm");
      const selectedLanguage=$("languageSelect").value;
      form.append("language",selectedLanguage==="mixed"?"auto":selectedLanguage);
      form.append("input_language",selectedLanguage);
      try{
        if (!window.VoiceKhataAuth?.isSignedIn()) throw new Error("Sign in with Google before using voice entry.");
        const result=await authRequest("/voice/transcribe",{method:"POST",body:form});
        const transcript=result.text||result.transcript||"";
        if(!transcript.trim()) throw new Error("The speech service returned an empty transcript.");
        $("transcriptInput").value=transcript;
        $("recordHint").textContent="Transcription ready — check the words, then choose Understand transaction";
        showToast("Audio transcribed. Now review the transaction details.");
      }catch(error){
        $("recordHint").textContent="Recording finished, but transcription API isn't connected yet.";
        showToast("Audio was not transcribed. Connect the faster-whisper endpoint or type the transaction.");
      }finally{$("recordStatus").textContent="READY WHEN YOU ARE";}
    };
    mediaRecorder.start();$("recordButton").classList.add("recording");$("recordStatus").textContent="RECORDING NOW";$("recordHint").textContent="Tap the mic again when you're done";
    $("recordButton").setAttribute("aria-label","Stop recording");$("recordButton").onclick=stopRecording;
  }catch(error){showToast("Microphone permission was blocked. Allow access or type the transaction.");}
}
function stopRecording(){if(mediaRecorder&&mediaRecorder.state!=="inactive"){mediaRecorder.stop();$("recordButton").setAttribute("aria-label","Start recording");$("recordButton").onclick=startRecording;}}
function setDates(){
  const now=new Date();
  $("todayLabel").textContent=now.toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  $("dateEyebrow").textContent=now.toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"}).toUpperCase();
  const dashboardEyebrow=document.querySelector("#view-dashboard .eyebrow");
  if(dashboardEyebrow) dashboardEyebrow.textContent=now.toLocaleDateString("en-IN",{weekday:"long"}).toUpperCase()+", "+now.toLocaleDateString("en-IN",{day:"numeric",month:"short"}).toUpperCase();
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>navigate(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach(button=>button.addEventListener("click",()=>navigate(button.dataset.go)));
$("recordButton").addEventListener("click",startRecording);
$("understandButton").addEventListener("click",understandTransaction);
$("reviewForm").addEventListener("submit",saveTransaction);
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
