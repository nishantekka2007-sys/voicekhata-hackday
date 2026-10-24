/*
 * VoiceKhata conservative Hindi/Hinglish/Marathi transaction parser.
 * Extraction is never a save operation. All fields are reviewed by a human.
 */
(function(root){
  "use strict";
  const DIGITS="०१२३४५६७८९";
  const NUM=Object.freeze({
    "एक":1,"ek":1,"one":1,
    "दो":2,"दोन":2,"do":2,"two":2,
    "तीन":3,"teen":3,"three":3,
    "चार":4,"char":4,"chaar":4,"four":4,
    "पांच":5,"पाँच":5,"पाच":5,"panch":5,"paanch":5,"five":5,
    "छह":6,"सहा":6,"six":6,
    "सात":7,"saat":7,"seven":7,
    "आठ":8,"aath":8,"eight":8,
    "नौ":9,"नऊ":9,"nine":9,
    "दस":10,"दहा":10,"das":10,"ten":10,
    "ग्यारह":11,"अकरा":11,"बारह":12,"बारा":12,"तेरह":13,"तेरा":13,
    "चौदह":14,"चौदा":14,"पंद्रह":15,"पंधरा":15,"सोलह":16,"सोळा":16,
    "सत्रह":17,"सतरा":17,"अठारह":18,"अठरा":18,"उन्नीस":19,
    "बीस":20,"वीस":20,"bees":20,"twenty":20,
    "इक्कीस":21,"एकवीस":21,"पच्चीस":25,"पंचवीस":25,
    "तीस":30,"tees":30,"thirty":30,
    "चालीस":40,"चाळीस":40,"forty":40,
    "पचास":50,"पन्नास":50,"pachas":50,"fifty":50,
    "साठ":60,"sixty":60,"सत्तर":70,"seventy":70,
    "अस्सी":80,"ऐंशी":80,"eighty":80,"नब्बे":90,"ninety":90,
    "सौ":100,"शंभर":100,"sau":100,"hundred":100,
    "हजार":1000,"हज़ार":1000,"hazaar":1000,"hazar":1000,"thousand":1000,
    "लाख":100000,"lakh":100000,"lac":100000,
    "दोनशे":200,"तीनशे":300,"चारशे":400,"पाचशे":500
  });
  const CURRENCY=new Set(["रुपये","रुपए","रुपया","रुपय","रूपये","रु","रू","rs","inr","rupee","rupees","rupay","rupaye","rupaya","rupiya"]);
  const CURRENCY_UNIT=/(?:रुपये|रुपए|रुपया|रुपय|रूपये|रु\.?|रू|rupees?|rupaye?|rupaya|rupiya|rupay|rs\.?|inr)/iu.source;
  const MONEY_PRE=/(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d{1,2})?)/iu;
  const MONEY_POST=new RegExp("(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s*"+CURRENCY_UNIT,"iu");
  const QUANTITY=new Set(["kg","kilo","kilos","gram","grams","ml","liter","litre","litres","packet","packets","pcs","pieces","किलो","ग्राम","लीटर","लिटर","पैकेट","पीस","नग"]);
  function toAsciiDigits(s){return String(s||"").replace(/[०-९]/g,ch=>String(DIGITS.indexOf(ch)));}
  function normalize(s){return toAsciiDigits(String(s||"").normalize("NFKC")).replace(/[\u200b-\u200d\uFEFF]/g,"").replace(/\s+/g," ").trim();}
  function tokens(s){return s.match(/[\p{L}\p{M}]+|\d[\d,]*(?:\.\d{1,2})?|₹/gu)||[];}
  function positiveAmount(s){const n=Number(String(s).replace(/,/g,""));return Number.isFinite(n)&&n>0&&n<=100000000?n:null;}
  function wordsValue(words){
    if(!words.length||words.length>7)return null;
    let total=0,current=0;
    for(const word of words){
      const n=NUM[word.toLowerCase()];
      if(n===undefined)return null;
      if(n===100)current=Math.max(current,1)*100;
      else if(n===1000||n===100000){total+=Math.max(current,1)*n;current=0;}
      else current+=n;
    }
    return positiveAmount(total+current);
  }
  function detectKind(input){
    const t=normalize(input).toLowerCase();
    if(/(?:उधार|उधारी|बकाया|बाकी|क्रेडिट|\budhar\b|\budhaar\b|\bcredit\b|\bdue\b)/iu.test(t))return "credit_sale";
    if(/(?:खर्च|खर्चा|बिजली|किराया|\bexpense\b|\bkharcha\b|\bbijli\b|\brent\b|\belectricity\b)/iu.test(t))return "cash_expense";
    if(/(?:वापस|जमा|भुगतान|परत|मिले|मिल गए|चुकाया|लौटाया|लौटाए|\bpaid\b|\bpayment\b|\brepaid\b|\brepay\b|\breturned\b|\bsettled\b|\bwapas\b|\bjama\b|\breceived\b)/iu.test(t))return "payment_received";
    if(/(?:दिया|दिये|दिए|दिले|\bdiya\b|\bdiye\b|\bgave\b)/iu.test(t)){
      if(/(?:\sको\s|\sko\s|\sला\s)/iu.test(t)&&!/(?:\sने\s|\bne\b)/iu.test(t))return "credit_sale";
      if(/(?:\sने\s|\bne\b)/iu.test(t))return "payment_received";
    }
    if(/(?:\btook\b|\bliya\b|लिया|घेतले)/iu.test(t))return "credit_sale";
    return null;
  }
  function spokenAmount(t,requireCurrency){
    const words=tokens(t);
    for(let i=0;i<words.length;i++){
      if(!CURRENCY.has(words[i].toLowerCase()))continue;
      const parts=[];
      for(let j=i-1;j>=0&&parts.length<7;j--){
        if(NUM[words[j].toLowerCase()]===undefined)break;
        parts.unshift(words[j]);
      }
      const n=wordsValue(parts);
      if(n!==null)return n;
    }
    if(requireCurrency||!detectKind(t))return null;
    for(let i=0;i<words.length;i++){
      if(NUM[words[i].toLowerCase()]===undefined)continue;
      const parts=[];
      let j=i;
      while(j<words.length&&parts.length<7&&NUM[words[j].toLowerCase()]!==undefined){
        parts.push(words[j]);j++;
      }
      if(!QUANTITY.has((words[j]||"").toLowerCase())){
        const n=wordsValue(parts);if(n!==null)return n;
      }
      i=j-1;
    }
    return null;
  }
  function extractAmount(input){
    const t=normalize(input);
    const matches=[t.match(MONEY_PRE),t.match(MONEY_POST)].filter(Boolean).sort((a,b)=>a.index-b.index);
    if(matches.length)return positiveAmount(matches[0][1]);
    const spoken=spokenAmount(t,true);
    if(spoken!==null)return spoken;
    for(const m of t.matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)){
      const following=t.slice(m.index+m[0].length).trim().match(/^[\p{L}\p{M}]+/u)?.[0]?.toLowerCase()||"";
      if(QUANTITY.has(following))continue;
      const amount=positiveAmount(m[0]);if(amount!==null)return amount;
    }
    return spokenAmount(t,false);
  }
  function extractCustomer(input,kind){
    if(kind==="cash_expense")return "Shop Expense";
    let t=normalize(input).replace(/^(?:(?:आज|मैंने|हमने|अभी|कल|aaj|maine|today|yesterday)\s+)+/iu,"").trim();
    const WORD=/[\p{L}\p{M}][\p{L}\p{M}.'-]*/u.source;
    const NAME="("+WORD+"(?:\\s+"+WORD+"){0,2})";
    const re=new RegExp("^"+NAME+"\\s+(?:को|ने|से|के|का|की|ला|नी|\\bko\\b|\\bne\\b|\\bse\\b|\\bto\\b|\\bfrom\\b|\\bpaid\\b|\\btook\\b|\\bgave\\b)","iu");
    const first=t.match(re);
    if(first)return first[1].trim();
    const suffix=t.match(new RegExp("^"+NAME+"(?:ला|ने)\\s+","iu"));
    if(suffix)return suffix[1].trim();
    const later=t.match(new RegExp("\\s"+NAME+"\\s+(?:को|ने|से|\\bko\\b|\\bne\\b|\\bse\\b)","iu"));
    if(later&&!/^(?:रुपये|रुपए|rupees?|आज|today)$/iu.test(later[1]))return later[1].trim();
    return "";
  }
  function parseSingle(input){
    const note=String(input||"").trim(),text=normalize(note);
    const kind=detectKind(text),amount=extractAmount(text),customer=extractCustomer(text,kind);
    const missing_fields=[];
    if(!customer)missing_fields.push("customer");
    if(amount===null)missing_fields.push("amount");
    if(!kind)missing_fields.push("transaction type");
    return {customer,kind:kind||"",amount:amount===null?"":amount,note,missing_fields,
      requires_confirmation:true,
      review_warning:missing_fields.length===3
        ?"No clear transaction details were recognized. Check the transcript or fill in customer, amount and type manually. Nothing has been saved."
        :missing_fields.length
          ?"Please complete: "+missing_fields.join(", ")+". Nothing has been saved."
          :"Check all the details before confirming."};
  }
  function splitTransactions(input){
    const clauses=normalize(input).split(/\s+(?:और|आणि|aur|and|ani)\s+/iu).map(s=>s.trim()).filter(Boolean);
    if(clauses.length<2||clauses.length>5)return null;
    if(!clauses.every(x=>parseSingle(x).missing_fields.length===0))return null;
    return clauses;
  }
  function isMultiple(t){return !!splitTransactions(t);}
  function parse(input){
    const t=String(input||"").trim();
    if(!t)return {error:"Please speak or type a transaction."};
    const chunks=splitTransactions(t);
    if(chunks)return {entries:chunks.map(parseSingle),requires_confirmation:true,
      review_warning:"Review each separate transaction before saving."};
    return parseSingle(t);
  }
  const api={parse,parseSingle,extractAmount,detectKind,extractCustomer,toAsciiDigits,isMultiple,splitTransactions};
  root.VoiceKhataParser=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
