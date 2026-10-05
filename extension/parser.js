// Pure command parser: text in, command object out. No DOM access, so it can be unit-tested in Node.
// Anything it can't handle returns null and goes to the AI backend instead.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceNavParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  // Speech recognition writes what it heard, and numbers sound like other words.
  const SOUNDS_LIKE = { won: 1, to: 2, too: 2, tu: 2, for: 4, fore: 4, ate: 8 };

  const SPEED = { slowly: "slow", slow: "slow", gently: "slow", steadily: "slow", fast: "fast", quickly: "fast", quick: "fast" };

  // Phrases that depend on page content (position or price) are resolved by the backend. A position only counts when it is
  // the whole request ("the second one", "the third question"): inside a name ("first aid kit", "4th of July sale") it isn't.
  const POSITION = /^(?:(?:the|a) )?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))(?: (?:item|result|product|video|story|article|link|question|button|tab|checkbox|filter|option|post|listing|choice|entry|page|one|search|web|news)s?)*(?: on (?:the )?screen)?$/;
  const SUPERLATIVE = /^(?:the )?(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th)) )?(?:cheapest|least expensive|most expensive|priciest|lowest[- ]priced?|highest[- ]priced?|lowest price|highest price)(?: .+)?$/;
  const BEST = /^(?:the )?(?:best|top rated)(?: (?:item|one|ones|result|product|video|story|article))?$/;
  const isContextual = (phrase) => POSITION.test(phrase) || SUPERLATIVE.test(phrase) || BEST.test(phrase);

  // Say one of these first when attention mode is on, so ordinary conversation is ignored. The Hindi recognizer writes them
  // in Devanagari. (JS \b only knows ASCII letters, so the end of the word is a lookahead instead.)
  const WAKE = /^(?:(?:hey|ok|okay|हे|ओके) )?(?:nova|computer|voice ?nav|नोवा|कंप्यूटर|कम्प्यूटर|कॉम्प्यूटर)(?=$|[\s,.!:।])[,.!:।]?\s*/i;

  function toNumber(s) {
    s = s.trim();
    if (/^\d+$/.test(s)) return +s;
    if (HINDI_NUM.has(s)) return HINDI_NUM.get(s); // "click paanch", "click पांच"
    const w = s.split(/[\s-]+/);
    if (w.length === 1) {
      if (ONES.includes(w[0])) return ONES.indexOf(w[0]);
      return TENS[w[0]] ?? SOUNDS_LIKE[w[0]] ?? null;
    }
    if (w.length === 2 && TENS[w[0]] && ONES.indexOf(w[1]) > 0 && ONES.indexOf(w[1]) < 10) {
      return TENS[w[0]] + ONES.indexOf(w[1]);
    }
    return null;
  }

  // People talk, they don't issue commands: "can you please open...", "I just want to view...", "I'd like to see...".
  const FILLER = [
    /^(?:can|could|would|will) you (?:please )?/i,
    /^i(?:'d| would| just| really| still| only| do)* (?:want|wanna|like|need|wish)(?: you)?(?: to)? /i,
    /^(?:let me|let's|lets|go ahead and|just|please) /i,
  ];
  function stripFiller(s) {
    for (let prev = null; prev !== s;) {
      prev = s;
      for (const re of FILLER) s = s.replace(re, "");
    }
    return s;
  }

  // Sending in a chat. "submit" alone stays the general "submit" command.
  const SEND_ONLY = /^(?:(?:send|submit)(?: (?:it|that|this|(?:the |my |this |a )?(?:message|prompt|text|question|reply|chat)))?(?: now)?|(?:press|click|hit|tap|push)(?: on)?(?: the)? send(?: button)?|send button)$/;
  const TYPE_AND_SEND = /^(?:type|write|enter)\s+(.+?)[,.]?\s+(?:and(?: then)?|then)\s+(?:send|submit|hit send|press send|click send|press enter|hit enter)(?:\s+(?:it|that|this|the message|now))*[.!]?$/i;
  // "ask Claude to write a poem" -> "write a poem"
  const ASSISTANT = /^(?:claude|chat ?gpt|gemini|copilot|the (?:ai|assistant|bot|chat ?bot))\b[,:]?\s+(?:to\s+)?/i;
  const cleanText = (s) => s.trim().replace(/[.]$/, "").trim();
  // What was said, with polite filler removed but the words' case and punctuation kept (for text that gets typed)
  const rawCommand = (raw) => stripFiller(raw.trim().replace(/^(?:hey|ok|okay)\b[,]?\s+/i, ""));

  function normalize(raw) {
    return stripFiller(raw.toLowerCase().replace(/[.,!?]/g, "").trim().replace(/^(hey |ok |okay )/, ""))
      .replace(/ please$/, "").trim();
  }

  // Returns the command text after the wake word, "" if only the wake word was said, or null if it wasn't said.
  function stripWake(raw) {
    const m = raw.trim().match(WAKE);
    return m ? raw.trim().slice(m[0].length) : null;
  }

  // ======================= Hindi and Hinglish =======================
  // Chrome's hi-IN recognizer writes Devanagari, English loanwords included ("स्क्रॉल डाउन करो"); an en-IN recognizer or a
  // keyboard gives romanized Hinglish in many spellings ("neeche/niche", "kholo/kholiye/khol do"). toEnglish() turns either
  // into the English command that parse() already understands. Hindi puts the verb last ("doosra result kholo" is "open the
  // second result"), so it finds the verb and rebuilds the sentence verb first rather than translating word by word.
  // Anything it isn't sure about (conversation, unknown verbs) comes back unchanged.
  const DEV = /[ऀ-ॿ]/;
  const CONS = { "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "f",
    "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h" };
  const NUKTA = { "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f", "य": "y" };
  const VOWEL = { "अ": "a", "आ": "aa", "इ": "i", "ई": "ii", "उ": "u", "ऊ": "uu", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o",
    "औ": "au", "ऑ": "o", "ऍ": "e", "ऎ": "e", "ऒ": "o" };
  const MATRA = { "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
    "ॉ": "o", "ॅ": "e", "ॆ": "e", "ॊ": "o" };

  // Devanagari to Latin letters, as a Hindi speaker would say it: "सबसे" is "sabse", not "sabase" (schwa deletion).
  function translit(word) {
    const u = []; // one entry per consonant or vowel: { c, v, implicit, nasal }
    const ch = [...word.normalize("NFD")]; // NFD splits क़ into क + nukta
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i], last = u[u.length - 1];
      if (CONS[x]) {
        let c = CONS[x];
        if (ch[i + 1] === "़") { c = NUKTA[x] || c; i++; }
        u.push({ c, v: "a", implicit: true, nasal: false });
      } else if (MATRA[x] && last && last.c) { last.v = MATRA[x]; last.implicit = false; }
      else if (x === "्" && last && last.c) { last.v = ""; last.implicit = false; }
      else if (VOWEL[x]) u.push({ c: "", v: VOWEL[x], implicit: false, nasal: false });
      else if ((x === "ं" || x === "ँ") && last) last.nasal = true;
      else if (x === "ः" && last) last.v += "h";
      else if (/[a-z0-9]/i.test(x)) u.push({ c: x.toLowerCase(), v: "", implicit: false, nasal: false });
    }
    const n = u.length;
    if (n > 1 && u[n - 1].implicit && !u[n - 1].nasal) u[n - 1].v = "";
    for (let i = n - 2; i >= 1; i--) {
      const x = u[i];
      if (x.implicit && !x.nasal && x.c && u[i - 1].v && u[i + 1].c && u[i + 1].v) x.v = "";
    }
    return u.map((x) => x.c + x.v + (x.nasal ? "n" : "")).join("");
  }
  const readable = (word) => translit(word).replace(/aa/g, "a").replace(/ii/g, "i").replace(/uu/g, "u");

  // A spelling-proof key, so "neeche", "niche" and "नीचे" all become "nice", and "kholiye" and "खोलिए" both "kolie".
  function skel(word) {
    let s = word.toLowerCase();
    if (DEV.test(s)) s = translit(s);
    s = s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    return s.replace(/chh|ch/g, "C").replace(/sh/g, "s").replace(/([kgtdpbjr])h/g, "$1").replace(/ck/g, "k").replace(/[cq]/g, "k")
      .replace(/C/g, "c").replace(/w/g, "v").replace(/z/g, "j").replace(/f/g, "p").replace(/x/g, "ks").replace(/iy/g, "i")
      .replace(/ee|ii/g, "i").replace(/oo|uu/g, "u").replace(/aa/g, "a").replace(/(.)\1+/g, "$1");
  }

  // Words, by meaning. Each list mixes romanized and Devanagari spellings; "a_b" is a two-word phrase; "=x" matches only
  // that exact romanized spelling (for words whose loose spelling would catch English words too).
  // Upper-case meanings are markers for the grammar below; "" means filler to drop.
  const LEX = [
    ["up", "upar oopar =uper upr uppar ऊपर उपर"],
    ["down", "neeche niche nichey neche nichay neechay nicche नीचे निचे नीचें"],
    ["back", "peeche piche pichhe peechhe pichey peechay पीछे पिछे wapas vapas vaapas waapas wapis vapis वापस वापिस"],
    ["previous", "pichla pichle pichhla pichhle pichli पिछला पिछले पिछली"],
    ["forward", "aage aagey aagay आगे"],
    ["next", "agla agle agli अगला अगले अगली"],
    ["most", "sabse sabsay sabase सबसे sab_se सब_से"],
    ["cheap", "sasta sastha saste sasti sastaa sastey sasthe सस्ता सस्ते सस्ती"],
    ["costly", "mehnga mehenga mahanga mahenga mehnge mehngi mahangi mahange mehanga mehange महंगा महँगा महंगी महंगे मंहगा मँहगा"],
    ["good", "accha acha achha achchha achcha badhiya badiya badhia अच्छा अच्छी अच्छे बढ़िया"],
    ["slow", "dheere dhire dhere dheeray dheeme dhime dheema dheemi धीरे धीमे धीमा धीमी dheere_se dhire_se धीरे_से aaram_se aram_se आराम_से"],
    ["fast", "tez tej tezi teji तेज़ तेज तेजी तेज़ी tezi_se teji_se तेज़ी_से तेजी_से"],
    ["quick", "jaldi jaldee जल्दी"],
    ["bit", "thoda thodi thora thori thodaa थोड़ा थोड़ी थोडा थोडी"],
    ["lot", "bahut bohot bahot bhot bohat zyada jyada jada ziada kaafi kafi बहुत बहोत ज़्यादा ज्यादा जादा काफी काफ़ी"],
    ["aur", "aur और"],
    ["kam", "kam कम"],
    ["start", "shuru shuruat shuruaat शुरू शुरु शुरुआत"],
    ["end", "aakhir akhir अंत आख़िर आखिर"],
    ["one", "wala wali wale waala waali waale vala vali vale वाला वाली वाले"],
    ["this", "ye yeh yah ise isko isse iska iski iske isey wo woh vo voh usko यह ये इसे इसको इस इसका इसकी इसके वो वह उसे उसको उस"],
    ["all", "sab saare सब सारे"],
    ["number", "nambar numbar namber नंबर नम्बर"],
    ["again", "dobara dubara dobaara phir fir फिर दोबारा दुबारा phir_se fir_se फिर_से"],
    ["always", "hamesha humesha हमेशा"],
    ["left", "baayen bayen baen baayi baain बाएं बाएँ बायें बाईं"],
    ["right", "daayen dayen daen daayi दाएं दाएँ दायें दाईं"],
    ["sound", "awaaz awaz aawaz aavaz avaaz awaaj awaj आवाज़ आवाज"],
    ["song", "gaana gaane गाना गाने"],
    ["price", "keemat kimat qeemat daam कीमत क़ीमत दाम"],
    ["question", "sawal sawaal savaal सवाल प्रश्न"],
    ["result", "natija nateeja नतीजा"],
    ["message", "sandesh संदेश"],
    ["clear", "saaf साफ़ साफ"],
    ["band", "band bandh बंद बन्द"],
    ["on", "chalu chaalu chaloo चालू"],
    ["speed", "raftaar raftar रफ़्तार रफ्तार"],
    ["search", "talash talaash तलाश"],
    ["bas", "bas बस"],
    ["hindi", "hindi hindee hindhi indi indy हिंदी हिन्दी"],
    ["english", "english angrezi angreji angrezee angreezi inglish ingalish इंग्लिश अंग्रेजी अंग्रेज़ी"],
    ["language", "bhasha bhaasha भाषा"],
    ["first", "pehla pahla pehli pahli pehle pahle pehala pahila पहला पहली पहले"],
    ["second", "doosra dusra doosri dusri doosre dusre dussra दूसरा दूसरी दूसरे दुसरा दुसरी दुसरे"],
    ["third", "teesra tisra teesri tisri teesre tisre तीसरा तीसरी तीसरे"],
    ["fourth", "chautha chotha chauthi chothi chauthe chothe चौथा चौथी चौथे"],
    ["fifth", "paanchva panchva paanchwa panchwa paanchvan panchvan panchwan paanchvi panchvi panchwi paanchve panchve पांचवा पांचवां पाँचवाँ पाँचवा पांचवीं पांचवी पाँचवीं पांचवे पांचवें"],
    ["sixth", "chhatha chatha chhathi chhathe chhatva chhatwa छठा छठी छठे छठवां"],
    ["seventh", "saatva satva saatwa satwa saatvan satvan saatvi satvi सातवां सातवा सातवीं सातवें"],
    ["eighth", "aathva athva aathwa athwa aathvan aathvi आठवां आठवा आठवीं आठवें"],
    ["ninth", "nauva nauvan nauwa nauvi नौवां नौवा नौवीं नौवें"],
    ["tenth", "dasva dasvan daswa daswan dasvi dasve दसवां दसवा दसवीं दसवें"],
    ["last", "aakhri akhri aakhiri akhiri aakhari akhari antim आखिरी आख़िरी आखरी अंतिम"],
    ["@on", "pe par per pr पे पर"],
    ["@ko", "ko को"],
    ["@in", "mein me mai mei men में मे"],
    ["@se", "se से"],
    ["@of", "ka ki ke का की के"],
    ["@to", "tak तक"],
    ["@for", "liye लिए लिये"],
    ["@main", "main"], // "I" at the start of a sentence, a misspelt "mein" (in) elsewhere
    ["YES", "haan haa han haanji हाँ हां हा हाँजी haan_ji ji_haan जी_हाँ जी_हां theek_hai thik_hai thik_he theek_he ठीक_है bilkul बिल्कुल बिलकुल sahi_hai सही_है ok_hai ओके"],
    ["NEG", "nahi nahin nai nhi mat नहीं नही मत"],
    ["na", "na ना"],
    ["CANCEL", "rehne_do rahne_do रहने_दो chhodo chodo छोड़ो छोडो jaane_do jane_do जाने_दो कैंसिल कैंसल"],
    ["", "please plz pls plis kripya kripaya krupaya कृपया प्लीज़ प्लीज zara jara zaraa ज़रा जरा bhai bhaiya bhaiyya yaar yar यार भाई भैया sir ab अब mujhe muje mujhko humein hume hamein hame मुझे मुझको हमें aap tum tu आप तुम तू bhi भी toh तो ही mere_liye मेरे_लिए ek_baar ek_bar एक_बार ek_minute ek_min एक_मिनट ek_second एक_सेकंड jaldi_se जल्दी_से ji jee जी"],
    // conversation, not commands: questions, tenses, "I", "my"
    ["G", "kya kyaa kyun kyu kyon kaise kese kaisa kab kahan kaha kahaan kaun kon kitna kitne kitni hai hain hoon hun =hu tha thi thhe raha rahi rahe rha rhi rhe gaya gayi gaye gya gyi liya diya kiya hua hui hue maine mene mera meri mere tera teri tere tumhara tumhari uska uski unka unki kal aaj =ho " +
      "क्या क्यों क्यूँ कैसे कैसा कब कहाँ कहां कौन कितना कितने कितनी है हैं हूँ हूं हु था थी थे रहा रही रहे गया गई गए गयी लिया दिया किया हुआ हुई मैंने मेरा मेरी मेरे तेरा तुम्हारा उसका उसकी उनका कल आज हो मैं"],
    ["COME", "=aa =aao =aaiye =aaja =aajao =aana =aaye आ आओ आइए आजा आना आए"],
    ["KEEP", "raho rahiye rahna रहो रहिए रहिये"],
    ["karte", "karte करते"],
    ["SAKTE", "sakte sakta sakti सकते सकता सकती"],
    ["CHAHTA", "chahta chahti chahte chahunga chahungi चाहता चाहती चाहते"],
    ["KE", "karke करके kar_ke कर_के"],
    ["LV", "de dijiye dijie dije dijiega dena den dein lo le lijiye lijie lije lena len lein दे दीजिए दीजिये देना दें लो ले लीजिए लीजिये लेना लें"],
    ["V:do", "kijiye kijie kije kijiega kardo kardijiye kardijie karde kardena kardein कीजिए कीजिये करदो"],
    ["V:want", "chahiye chaahiye chahie chaiye चाहिए चाहिये"],
    ["V:sleep", "so_jao so_ja so_jaiye sojao soja सो_जाओ सो_जा सो_जाइए"],
    ["V:go", "chalo chaliye चलो चलिए"],
  ];
  // English loanwords as the hi-IN recognizer spells them
  const LOAN = {
    scroll: "स्क्रॉल स्क्रोल स्क्राल स्क्रॉलिंग स्क्रोलिंग", down: "डाउन", up: "अप", click: "क्लिक", open: "ओपन", close: "क्लोज़ क्लोज",
    search: "सर्च", type: "टाइप", send: "सेंड सेन्ड", submit: "सबमिट", enter: "एंटर एन्टर", select: "सेलेक्ट सिलेक्ट सलेक्ट",
    choose: "चूज़ चूज", play: "प्ले", pause: "पॉज़ पॉज पोज़ पोज", stop: "स्टॉप स्टाप स्टोप", mute: "म्यूट", unmute: "अनम्यूट",
    refresh: "रिफ्रेश रिफ़्रेश", reload: "रीलोड रिलोड", back: "बैक", forward: "फॉरवर्ड फ़ॉरवर्ड", next: "नेक्स्ट", page: "पेज पन्ना",
    video: "वीडियो विडियो", result: "रिजल्ट रिज़ल्ट", product: "प्रोडक्ट", item: "आइटम", link: "लिंक", button: "बटन",
    popup: "पॉपअप पोपअप पॉप", window: "विंडो", dialog: "डायलॉग", cart: "कार्ट", basket: "बास्केट", bag: "बैग", add: "ऐड एड",
    to: "टू", message: "मैसेज मेसेज", screen: "स्क्रीन", tab: "टैब", option: "ऑप्शन", filter: "फ़िल्टर फिल्टर", sort: "सॉर्ट",
    price: "प्राइस", high: "हाई", home: "होम", top: "टॉप", bottom: "बॉटम", slow: "स्लो", fast: "फास्ट फ़ास्ट", speak: "स्पीक",
    wake: "वेक", word: "वर्ड", sleep: "स्लीप", panel: "पैनल", on: "ऑन", off: "ऑफ", text: "टेक्स्ट", box: "बॉक्स",
    clear: "क्लियर", escape: "एस्केप", first: "फर्स्ट फ़र्स्ट", second: "सेकंड सेकेंड सेकण्ड", third: "थर्ड", last: "लास्ट",
    one: "वन", cheapest: "चीपेस्ट", mode: "मोड", language: "लैंग्वेज", mic: "माइक", voice: "वॉइस वॉयस", switch: "स्विच",
    change: "चेंज", question: "क्वेश्चन", headphone: "हेडफोन हेडफ़ोन", headphones: "हेडफोन्स हेडफ़ोन्स", phone: "फोन फ़ोन",
    mobile: "मोबाइल", laptop: "लैपटॉप", charger: "चार्जर", cover: "कवर", shoes: "शूज़ शूज", shirt: "शर्ट", watch: "वॉच",
    book: "बुक", speaker: "स्पीकर", delivery: "डिलीवरी", free: "फ्री फ़्री", star: "स्टार", stars: "स्टार्स", sign: "साइन",
    in: "इन", login: "लॉगिन", subscribe: "सब्सक्राइब", like: "लाइक", share: "शेयर", comment: "कमेंट", channel: "चैनल",
    buy: "बाय", now: "नाउ", order: "ऑर्डर", help: "हेल्प", offers: "ऑफर्स", menu: "मेनू", settings: "सेटिंग्स",
    reviews: "रिव्यूज़ रिव्यू", details: "डिटेल्स", ad: "विज्ञापन",
  };
  // Hindi numbers 1-50 (the number overlay can go that high). Romanized ones match exactly: loosely, "aath" would be "at".
  const NUM_WORDS = [
    "ek एक", "do दो", "teen तीन", "char chaar चार", "paanch panch पांच पाँच पाच", "chhe chhah chheh छह छः छे", "saat सात",
    "aath आठ", "nau नौ", "das dus दस", "gyarah gyara gyaarah ग्यारह", "barah baarah बारह", "terah तेरह", "chaudah chauda चौदह",
    "pandrah pandra पंद्रह पन्द्रह", "solah सोलह", "satrah satra सत्रह", "atharah athara अठारह", "unnis unnees उन्नीस",
    "bees बीस", "ikkis ikkees इक्कीस", "bais baees baais बाईस", "teis teyees तेईस", "chaubis chaubees चौबीस",
    "pachchis pachis pachees पच्चीस", "chhabbis chabbis छब्बीस", "sattais sattaees सत्ताईस", "atthais atthaees अट्ठाईस",
    "untis untees उनतीस", "tees तीस", "iktis ikattis इकतीस", "battis battees बत्तीस", "taintis tetis तैंतीस",
    "chauntis चौंतीस", "paintis पैंतीस", "chhattis chattis छत्तीस", "saintis सैंतीस", "adtis artis अड़तीस", "untalis उनतालीस",
    "chalis chaalis chaalees चालीस", "iktalis इकतालीस", "bayalis बयालीस", "taintalis तैंतालीस", "chauvalis chavalis चौवालीस",
    "paintalis पैंतालीस", "chhiyalis छियालीस", "saintalis सैंतालीस", "adtalis artalis अड़तालीस", "unchas उनचास",
    "pachas pachaas पचास",
  ];
  // Verbs by stem: each takes the usual endings (kholo, kholiye, kholiyega, kholna, kholen) or a helper (khol do, ruk jao).
  const VERBS = {
    open: "khol", show: "dikha dikhla", hide: "chhupa chupa chhipa chipa", remove: "hata", go: "ja", do: "kar",
    stop: "ruk rok tham", play: "chala baja", write: "likh", send: "bhej", ask: "puchh pooch poochh", press: "daba",
    find: "dhund dhoond dhundh khoj", choose: "chun", put: "daal dal rakh", buy: "kharid khareed", look: "dekh",
    listen: "sun", speak: "bol", apply: "laga", clear: "mita", move: "badh", increase: "badha", decrease: "ghata",
    wake: "jag jaag uth",
  };
  // A bare stem ("khol") counts only for these, and only before a helper or at the end; "sun", "bad", "bada" are English
  const BARE_OK = new Set(["kol", "kar", "ruk", "rok", "lik", "bej", "daba", "dund", "koj", "cun", "dal", "dek", "bol", "ja",
    "jag", "ut", "mita", "hata", "cala", "dika", "laga", "puc", "karid", "cupa"]);
  const VERB_END = /^(o|ie|yie|iega|yiega|na|en|ein|ien|yen|yein)$/;
  // Romanized words that are also English (or too short to be sure of): they never make a sentence count as Hindi by
  // themselves, and a capitalised one in mid-sentence is read as a name ("open Karo Tea").
  const WEAK = new Set(("do de den dein lo le len lena ja se ko ka ki ke me men mai main na ho so pe par per pr band on ab sir " +
    "please plz pls ji jee ha han haa bas mat kam sab ek teen char das nau saat satra tees bees bais age ye wo vo hindi indi " +
    "english end chalo tu fir indy").split(" "));
  // English words said inside a Hinglish sentence ("scroll down slowly karo")
  const ENG_ALIAS = { slowly: "slow", gently: "slow", quickly: "fast", numbers: "number", scrolling: "scroll" };

  const DMAP = new Map(), LMAP = new Map(), XMAP = new Map(), HINDI_NUM = new Map();
  const NUMD = new Map();
  const addWord = (lemma, sp) => {
    const exact = sp.startsWith("=");
    if (exact) sp = sp.slice(1);
    const dev = DEV.test(sp);
    const key = sp.split("_").map(skel).join(" ");
    if (dev) DMAP.set(key, lemma);
    else { XMAP.set(sp.replace(/_/g, " "), lemma); if (!exact && !LMAP.has(key)) LMAP.set(key, lemma); }
  };
  for (const [lemma, list] of LEX) for (const sp of list.split(/\s+/).filter(Boolean)) addWord(lemma, sp);
  for (const [lemma, list] of Object.entries(LOAN)) for (const sp of list.split(/\s+/)) addWord(lemma, sp);
  NUM_WORDS.forEach((list, i) => {
    for (const sp of list.split(" ")) {
      if (DEV.test(sp)) NUMD.set(skel(sp), i + 1);
      else XMAP.set(sp, "#" + (i + 1));
      if (sp !== "do") HINDI_NUM.set(sp, i + 1); // "click do" stays a click on something called "do"
    }
  });
  const STEMS = Object.entries(VERBS).flatMap(([v, list]) => list.split(" ").map((s) => [skel(s), "V:" + v]))
    .sort((a, b) => b[0].length - a[0].length); // longest first: "bada" (badhao) before "bad" (badho)

  function verbOf(k) {
    for (const [stem, lemma] of STEMS) {
      if (!k.startsWith(stem)) continue;
      const end = k.slice(stem.length);
      // stems ending in n lose a letter: "sunna" is spelt "suna" after doubled letters are merged
      if (VERB_END.test(end) || (end === "a" && stem.endsWith("n"))) return { lemma, bare: false };
      if (end === "" && BARE_OK.has(stem)) return { lemma, bare: true };
    }
    return null;
  }

  const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;
  function classify(text) {
    const raw = [...text.matchAll(WORD)].map((m) => ({ o: m[0], s: m.index, e: m.index + m[0].length, dev: DEV.test(m[0]) }));
    const toks = [];
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i], u = raw[i + 1];
      // two-word phrases first ("sab se", "theek hai", "so jao")
      if (u && t.dev === u.dev) {
        const pair = (t.dev ? DMAP : XMAP).get(t.dev ? skel(t.o) + " " + skel(u.o) : `${t.o} ${u.o}`.toLowerCase()) ??
          (t.dev ? undefined : LMAP.get(skel(t.o) + " " + skel(u.o)));
        if (pair !== undefined) { toks.push({ ...t, e: u.e, o: text.slice(t.s, u.e), lem: pair, known: true, strong: true }); i++; continue; }
      }
      toks.push(word(t, toks.length));
    }
    // "pop up" is one word
    return toks.filter((t, i) => !(t.lem === "up" && /^(?:pop|popup)$/.test(toks[i - 1]?.lem) && (toks[i - 1].lem = "popup")));
  }

  function word(t, index) {
    const lower = t.o.toLowerCase(), k = skel(t.o);
    if (/^\d+$/.test(t.o)) return { ...t, lem: "#" + +t.o, known: true, strong: false };
    let lem, strong = false, known = true, bare = false;
    if (t.dev) {
      lem = DMAP.get(k);
      if (lem === undefined && NUMD.has(k)) lem = "#" + NUMD.get(k);
      strong = true;
    } else if (XMAP.has(lower)) {
      lem = XMAP.get(lower);
      strong = !WEAK.has(lower) && lem !== lower;
    } else if (LMAP.has(k)) lem = LMAP.get(k); // a spelling we didn't list: understood, but not proof that this is Hindi
    if (lem === undefined) {
      const v = verbOf(k);
      if (v) { lem = v.lemma; bare = v.bare; strong = !v.bare && !(v.lemma === "V:go" && k === "jana"); }
    }
    if (lem === "#2") lem = "do"; // "do" is two, or the helper in "khol do"
    if (lem === undefined && ENG_ALIAS[lower]) lem = ENG_ALIAS[lower];
    if (lem === undefined) { lem = t.dev ? "~" : lower; known = false; }
    // A capitalised word in mid-sentence is a name ("open Karo Tea", "play Tum Hi Ho"), unless it is a Hindi verb ("Kholo")
    if (!t.dev && index > 0 && /^\p{Lu}/u.test(t.o) && known && (!lem.startsWith("V:") || lem === "V:do")) return { ...t, lem: lower, known: false, strong: false };
    return { ...t, lem, known, strong, bare };
  }

  const isHelper = (t) => t && (t.lem === "LV" || t.lem === "do" || t.lem === "V:go");
  const AUX = /^(?:ho|hain|hai|hoon|hun|hu|he|h|हो|हैं|है|हूँ|हूं)$/i;
  const ORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "last"];
  const KEEP_LEMMA = new Set([...ORDS, "number", "question", "result", "page", "message", "video", "song", "price"]);
  const CART = new Set(["cart", "basket", "bag", "kart", "trolley"]);
  const POPUP = new Set(["popup", "window", "dialog", "ad", "ads", "advertisement", "overlay", "menu", "sheet", "offer"]);
  const MEDIA = new Set(["video", "song", "music"]);
  // A "nahi"/"mat" sentence made only of these is a refusal ("add mat karo", "nahi chahiye"); anything else is conversation
  const CMDISH = new Set(["this", "add", "cart", "click", "open", "select", "buy", "send", "delete", "it", "@ko", "@in", "@on",
    "order", "scroll", "subscribe", "number", "na", "basket", "remove", "press", "play"]);
  const LANG_CUE = new Set(["V:speak", "speak", "mode", "language", "V:do", "V:listen", "switch", "change", "use", "talk"]);
  const LANG_OK = new Set([...LANG_CUE, "@in", "@on", "@ko", "@main", "me", "mai", "may", "main", "men", "mein", "in", "to",
    "bole", "bolu", "bola", "bol", "bowl", "listen", "on", "baat", "bat"]);
  const SCROLLSET = new Set(["scroll", "scrolling", "up", "down", "slow", "fast", "quick", "bit", "lot", "aur", "most", "top",
    "bottom", "end", "start", "V:go", "V:do", "page", "@on", "@in", "@of", "@to", "@ko", "karte", "KEEP", "V:move", "this", "again"]);
  // The Hindi verb (or English verb + "karo") decides the English verb
  const VK = { "V:open": "open", "V:show": "show me", "V:look": "view", "V:press": "press", "V:choose": "select",
    "V:apply": "select", "V:want": "open", "V:play": "play", "V:go": "go to", "V:stop": "stop", "V:hide": "hide", "V:remove": "remove" };
  const EK = { open: "open", click: "click", press: "press", tap: "click", select: "select", choose: "select", pick: "select",
    check: "click", view: "view", visit: "go to", expand: "expand", play: "play", show: "show me", close: "close",
    stop: "stop", hide: "hide", remove: "remove" };
  const PAYLOAD = { "V:write": "type", "V:send": "send", "V:ask": "ask", "V:find": "search" };
  const ENG_PAYLOAD = { type: "type", write: "type", send: "send", ask: "ask", search: "search", find: "search" };

  // The object of a click-like verb, in English: "doosra wala result" -> "the second result", "sabse sasta" -> "the cheapest"
  function renderObj(tokens) {
    const w = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], l = t.lem, next = tokens[i + 1]?.lem, after = tokens[i + 2]?.lem;
      if (l[0] === "@" || l.startsWith("V:") || l === "aur" || l === "all" || /^[A-Z]+$/.test(l)) continue;
      if (l === "this") { if (tokens.length === 1) w.push("this"); continue; }
      if (l === "most") {
        if (next === "cheap") { w.push("cheapest"); i++; }
        else if (next === "costly") { w.push("most expensive"); i++; }
        else if (next === "good") { w.push("best"); i++; }
        else if (next === "kam" && after === "price") { w.push("cheapest"); i += 2; }
        else if (next === "lot" && after === "price") { w.push("most expensive"); i += 2; }
        continue;
      }
      if (l === "cheap") { w.push("cheapest"); continue; }
      if (l === "costly") { w.push("most expensive"); continue; }
      // "sony wala" -> "sony one" (the English parser drops a final "one"); "doosra wala result" -> "second result"
      if (l === "one" && t.known) { if (tokens.slice(i + 1).every((x) => x.lem[0] === "@" || x.lem === "this")) w.push("one"); continue; }
      if (l[0] === "#") { w.push(l.slice(1)); continue; }
      if (l === "do") { w.push("2"); continue; }
      if (t.dev) { w.push(l === "~" ? readable(t.o) : l); continue; }
      w.push(KEEP_LEMMA.has(l) ? l : t.o.toLowerCase());
    }
    let s = w.join(" ").trim().replace(/^(?:number )?(\d+)(?: number)?(?: one)?$/, "$1");
    if (/^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|cheapest|most expensive|best)\b/.test(s)) s = "the " + s;
    return s;
  }

  // A few whole phrases that are said as they are (help, undo, read the screen); matched on the sentence, not word by word
  const FIXED_HINDI = [
    [/^(?:madad|मदद|help karo|हेल्प करो|help chahiye|मदद चाहिए|mujhe madad chahiye|मुझे मदद चाहिए|(?:main|mai|मैं) (?:kya|क्या) (?:bol|बोल) (?:sakta|sakti|सकता|सकती) (?:hoon|hun|hu|हूँ|हूं)|(?:kya|क्या) (?:bol|बोल) (?:sakta|sakti|सकता|सकती) (?:hoon|hun|hu|हूँ|हूं)|(?:tum|aap|तुम|आप) (?:kya|क्या) (?:kar|कर) (?:sakte|sakti|सकते|सकती) (?:ho|hain|हो|हैं)|commands dikhao|कमांड दिखाओ|कमांड्स दिखाओ)$/i, "what can i say"],
    [/^(?:undo karo|अनडू करो|undo kar do|अनडू कर दो|wapas karo|vapas karo|वापस करो|ye wapas karo|यह वापस करो|pichla kaam wapas karo|पिछला काम वापस करो|ise undo karo|इसे अनडू करो)$/i, "undo"],
    [/^(?:results padho|रिजल्ट्स पढ़ो|नतीजे पढ़ो|natije padho|results bolo|screen par kya hai|स्क्रीन पर क्या है|screen pe kya hai|(?:kya|क्या) (?:kya|क्या) (?:hai|है))$/i, "read the results"],
    [/^(?:dictation shuru karo|डिक्टेशन शुरू करो|bolkar likho|बोलकर लिखो|likhna shuru karo|लिखना शुरू करो)$/i, "start dictation"],
    [/^(?:dictation band karo|डिक्टेशन बंद करो|likhna band karo|लिखना बंद करो|bolkar likhna band karo)$/i, "stop dictation"],
    [/^(?:agla field|अगला फील्ड|agli field|अगली फील्ड|agla box|अगला बॉक्स|next field karo)$/i, "next field"],
    [/^(?:pichla field|पिछला फील्ड|pichli field|पिछली फील्ड|pichla box|पिछला बॉक्स)$/i, "previous field"],
    [/^(?:fields dikhao|फील्ड्स दिखाओ|form dikhao|फॉर्म दिखाओ|fields batao|फील्ड्स बताओ|form mein kya hai|फॉर्म में क्या है)$/i, "list fields"],
    [/^(?:jo likha wo padho|जो लिखा वो पढ़ो|maine kya likha)$/i, "what did i type"],
    [/^(?:phir se|फिर से|dobara|दोबारा|ek baar aur|एक बार और)$/i, "repeat"],
    [/^(?:aakhri shabd hatao|आखिरी शब्द हटाओ|last word hatao|pichla shabd hatao|पिछला शब्द हटाओ)$/i, "delete last word"],
    [/^(?:ye hatao|यह हटाओ|isko hatao|इसको हटाओ|ise mitao|इसे मिटाओ)$/i, "delete that"],
    [/^(?:text saaf karo|टेक्स्ट साफ करो|box khali karo|बॉक्स खाली करो|sab mita do|सब मिटा दो)$/i, "clear the text"],
    [/^(?:help band karo|मदद बंद करो|help hatao|हेल्प हटाओ)$/i, "close help"],
  ];

  function toEnglish(raw) {
    if (typeof raw !== "string" || !raw.trim()) return raw;
    {
      const key = raw.toLowerCase().replace(/[.,!?।]/g, " ").replace(/\s+/g, " ").trim();
      for (const [re, en] of FIXED_HINDI) if (re.test(key)) return en;
    }
    const text = raw.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
    const toks = classify(text);
    if (!toks.length) return raw;
    // a one-word yes or no is too short to look Hindi ("ha", "na")
    if (toks.length === 1 && toks[0].lem === "YES") return "yes";
    if (toks.length === 1 && (toks[0].lem === "NEG" || toks[0].lem === "na")) return "cancel";
    if (toks.length === 1 && toks[0].lem === "bas") return "stop"; // "bas" (enough)
    if (toks.length === 1 && /^(?:ji|jee|जी)$/i.test(toks[0].o)) return "yes";
    const hindi = toks.some((t) => t.dev || t.strong) || toks.some((t, i) => t.bare && (isHelper(toks[i + 1]) || toks[i + 1]?.lem === "SAKTE"));
    if (!hindi) return raw;
    return command(toks, text) ?? raw;
  }

  function command(toks, text) {
    if (toks.length === 1 && /^(?:ji|jee|जी)$/i.test(toks[0].o)) return "yes";
    let polite = false;
    const kept = [];
    for (let i = 0; i < toks.length; i++) {
      const t = { ...toks[i] }, prev = kept[kept.length - 1];
      if (t.lem === "@main") t.lem = i === 0 ? "G" : "@in";
      const afterVerb = prev && prev.lem.startsWith("V:");
      if (afterVerb && (t.lem === "LV" || t.lem === "do" || (t.lem === "V:go" && prev.lem !== "V:go"))) continue; // khol do, ruk jao
      // "kholna chahta hoon", "scroll kar sakte ho", "dekhna hai", "kholna chahiye": all just mean "do it"
      if (afterVerb && (t.lem === "SAKTE" || t.lem === "CHAHTA" || t.lem === "V:want")) {
        polite = true;
        while (toks[i + 1] && AUX.test(toks[i + 1].o)) i++;
        continue;
      }
      if (afterVerb && t.lem === "G" && /^(?:hai|he|h|है)$/i.test(t.o)) continue;
      kept.push(t);
    }
    let T = kept.filter((t) => t.lem !== "" && t.lem !== "LV").map((t) => (t.lem === "do" ? { ...t, lem: "#2" } : t));
    if (polite) T = T.filter((t) => !(t.lem === "G" && /^(?:kya|kyaa|क्या|main|मैं)$/i.test(t.o)));
    while (T.length > 1 && T[T.length - 1].lem === "na") T.pop(); // "kholo na"
    T = T.filter((t, i) => !(i > 0 && t.known && t.lem[0] !== "#" && t.lem === T[i - 1].lem && skel(t.o) === skel(T[i - 1].o))); // "dheere dheere", "ruko ruko"
    if (!T.length) return null;
    const ls = T.map((t) => t.lem), str = ls.join(" ");
    const has = (l) => ls.includes(l);
    const all = (set) => ls.every((l) => set.has(l));
    const span = (a, b) => text.slice(T[a].s, T[b].e).trim();

    // ---- text the user dictates: type, send, ask, search. Its words are kept exactly as said, in either script ----
    const sendEnd = ls[ls.length - 1] === "V:send" ? ls.length - 1 : ls[ls.length - 1] === "V:do" && ls[ls.length - 2] === "send" ? ls.length - 2 : -1;
    if (sendEnd > 0) { // "hello likho aur bhejo", "namaste likh ke bhej do", "type karo hello aur send karo"
      let j = sendEnd - 1;
      while (j >= 0 && ["aur", "@of", "KE", "V:do"].includes(ls[j])) j--;
      const writerAt = (i) => ls[i] === "V:write" || ls[i] === "type" || ls[i] === "write";
      if (j > 0 && writerAt(j)) return `type ${span(0, j - 1)} and send it`;
      if (j >= 0 && writerAt(0)) {
        const from = ls[1] === "V:do" ? 2 : 1;
        if (from <= j) return `type ${span(from, j)} and send it`;
      }
    }
    let pv = -1, pspan = null, kind = null;
    for (let i = ls.length - 1; i >= 0 && pv < 0; i--) if (PAYLOAD[ls[i]]) { pv = i; kind = PAYLOAD[ls[i]]; pspan = [i, i]; }
    for (let i = ls.length - 2; i >= 0 && pv < 0; i--) if (ENG_PAYLOAD[ls[i]] && ls[i + 1] === "V:do") { pv = i; kind = ENG_PAYLOAD[ls[i]]; pspan = [i, i + 1]; }
    if (pv < 0 && ENG_PAYLOAD[ls[0]]) {
      // "search for sabse sasta phone": an English command, read as said. ("send button dabao" has a Hindi verb: read on.)
      if (!T[0].dev && (ls[0] !== "send" || !ls.some((l) => l.startsWith("V:")))) return null;
      if (T[0].dev) { pv = 0; kind = ENG_PAYLOAD[ls[0]]; pspan = [0, 0]; }
    }
    if (pv >= 0) {
      let before = T.slice(0, pspan[0]), after = T.slice(pspan[1] + 1);
      if (kind === "ask") { // "Claude se puchho ...": who is asked isn't part of the question
        if (before[1]?.lem === "@se") before = before.slice(2);
        else if (before[before.length - 1]?.lem === "@se") before = before.slice(0, -2);
      }
      let body = pspan[0] === 0 ? after : before.length ? before : after;
      if (kind === "send" && body[body.length - 1]?.lem === "@ko") return null; // "mummy ko bhejo": a person, not a message
      while (body.length && body[body.length - 1].lem[0] === "@") body = body.slice(0, -1);
      while (body.length && body[0].lem[0] === "@") body = body.slice(1);
      if (kind === "send" && body.every((t) => ["this", "message", "it"].includes(t.lem))) return "send";
      if (!body.length || body.every((t) => t.lem.startsWith("V:") || ["aur", "KE", "@of"].includes(t.lem))) return null;
      const said =text.slice(body[0].s, body[body.length - 1].e).trim();
      return { type: `type ${said}`, send: `send ${said}`, ask: `ask ${said}`, search: `search for ${said}` }[kind];
    }

    // ---- everything else: conversation is left alone ----
    if (has("G") || has("COME") || /\?/.test(text)) return null;

    if (/^(?:YES )*(?:YES|V:do|ok V:do|okay V:do)$/.test(str)) return "yes"; // haan, theek hai, haan kar do
    if (has("NEG") || has("CANCEL")) {
      if (/^(?:NEG V:stop|V:stop NEG)$/.test(str)) return "keep going"; // "ruko mat"
      return ls.every((l) => l === "NEG" || l === "CANCEL" || CMDISH.has(l) || l.startsWith("V:")) ? "cancel" : null;
    }
    if (/^cancel(?: V:do)?$/.test(str)) return "cancel";

    // "hindi mein bolo", "english mein bolo", "हिंदी में बोलो", and what an English recognizer makes of them ("Hindi may bolo")
    const langs = ls.filter((l) => l === "hindi" || l === "english");
    if (langs.length === 1) {
      const rest = ls.filter((l) => l !== langs[0]);
      if (rest.some((l) => LANG_CUE.has(l)) && rest.every((l) => LANG_OK.has(l))) return `speak ${langs[0]}`;
    }

    if (/^(?:V:sleep|sleep V:do)$/.test(str)) return "go to sleep";
    if (/^(?:again )?V:wake$|^V:listen (?:start|on|again) V:do$|^again V:listen$/.test(str)) return "wake up";
    if (/^(?:V:listen|mic|voice|listening)(?: @ko)? (?:band V:do|off V:do|V:stop|band|off)$/.test(str)) return "stop listening";
    if (/^(?:always|all) V:listen$/.test(str)) return "always listen";
    if (/^wake word(?: @ko)? (?:on V:do|start V:do|V:apply|on|V:do)$/.test(str)) return "use wake word";
    if (/^wake word(?: @ko)? (?:band V:do|off V:do|V:remove|off|band)$/.test(str)) return "always listen";

    // the number overlay: "number dikhao", "iska number dikhao", "number hatao"
    const NUMS = "^(?:(?:this|all) )*(?:number|numbers)(?: (?:this|all|@ko))* ";
    if (new RegExp(NUMS + "(?:V:show|on V:do|on|show V:do)$").test(str)) return "show numbers";
    if (new RegExp(NUMS + "(?:V:hide|V:remove|band V:do|off V:do|off|band|hide V:do|remove V:do)$").test(str)) return "hide numbers";

    if (has("panel")) {
      if (/^(?:this )?panel(?: @ko)? (?:V:hide|V:remove|hide V:do|band V:do)$/.test(str)) return "hide panel";
      if (/^(?:this )?panel(?: @ko)? (?:again )?(?:V:show|show V:do)$/.test(str)) return "show panel";
      const v = has("up") || has("top") ? "top" : has("down") || has("bottom") ? "bottom" : "";
      const h = has("left") ? "left" : has("right") ? "right" : "";
      if ((v || h) && all(new Set(["panel", "@ko", "@on", "@in", "up", "down", "top", "bottom", "left", "right", "V:go", "V:do", "V:move", "corner"])))
        return `move panel to the ${[v, h].filter(Boolean).join(" ")}`;
    }

    // media and sound
    if (/^(?:this )?sound(?: @ko)? (?:band V:do|V:stop|off V:do|band|off|mute V:do)$|^(?:this )?mute(?: V:do)?$/.test(str)) return "mute";
    if (/^(?:this )?sound(?: @ko)? (?:again )?(?:on V:do|start V:do|V:open|V:play|on|unmute V:do)$|^unmute(?: V:do)?$/.test(str)) return "unmute";
    const media = ls.some((l) => MEDIA.has(l));
    if (/^(?:this )?(?:(?:video|song|music) )?(?:@ko )?(?:V:stop|pause V:do|pause|stop V:do|band V:do)$/.test(str) && (media || /pause/.test(str)))
      return media ? "pause the video" : "pause";
    if (/^(?:this )?(?:(?:video|song|music) )?(?:@ko )?(?:again )?(?:V:play|play V:do|play|start V:do|on V:do)$/.test(str) && (media || /play/i.test(str)))
      return media ? "play the video" : "play";
    if (/^(?:this )?(?:scroll|scrolling)(?: @ko)? (?:V:stop|band V:do|stop V:do|stop|band)$/.test(str)) return "stop scrolling";
    if (/^(?:this )?(?:V:stop|stop V:do|stop|bas|bas V:do)$/.test(str)) return "stop";

    // closing things. A bare "band karo" (close it / turn it off) depends on what is happening, so it gets its own command
    // that stops a scroll, closes a popup or pauses what is playing (see "halt" in content.js)
    if (ls.some((l) => POPUP.has(l)) && /^(?:this )?(?:\S+ )?(?:@ko )?(?:close V:do|close|V:remove|remove V:do|band V:do|band|V:hide)$/.test(str)) return "close";
    if (/^(?:this )?(?:@ko )?(?:close V:do|close|V:remove|remove V:do)$/.test(str)) return "close";
    if (/^(?:this )?(?:@ko )?band V:do$/.test(str)) return "stop or close";
    if (/^escape(?: (?:V:press|press V:do|V:do))?$/.test(str)) return "press escape";
    if (/^(?:(?:this|all) )*(?:text(?: box)?(?: @ko)? )?(?:V:clear|clear V:do)$|^(?:(?:this|all) )*text(?: box)?(?: @ko)? (?:V:remove|remove V:do|delete V:do|clear)$/.test(str)) return "clear the text";
    if (/^(?:this )?(?:page )?(?:@ko )?(?:again )?(?:refresh|reload)(?: V:do)?$|^(?:page )?(?:@ko )?again load V:do$/.test(str)) return "refresh the page";
    if (/^enter(?: @ko)? (?:V:press|press V:do|click V:do|V:do)$/.test(str)) return "press enter";
    if (/^submit V:do$/.test(str)) return "submit";
    if (/^send(?: button)?(?: @ko| @on)? (?:V:press|press V:do|click V:do)$/.test(str)) return "press send";

    // shopping
    if (ls.some((l) => CART.has(l)) && (has("V:put") || has("add"))) return "add to cart"; // cart mein daalo, add to cart karo
    if (/^(?:this )?(?:@ko )?add(?: V:do| V:press)$/.test(str)) return "add to cart";
    if (has("V:buy")) return "click buy now"; // asks for a spoken "yes" first, like any purchase
    if (has("sort")) { // "price low to high sort karo", "sasta pehle sort karo"
      const rest = T.filter((t) => !["sort", "V:do", "@se", "@of", "@ko", "@in", "by", "one"].includes(t.lem));
      const r = rest.map((t) => t.lem).join(" ");
      if (/^(?:cheap|kam price|price kam)(?: first)?$/.test(r)) return "sort by price low to high";
      if (/^(?:costly|lot price|price lot)(?: first)?$/.test(r)) return "sort by price high to low";
      return rest.length ? `sort by ${rest.map((t) => (t.dev ? (t.lem === "~" ? readable(t.o) : t.lem) : t.o.toLowerCase())).join(" ")}` : "sort by";
    }

    // scrolling speed and direction
    if (/^aur (?:fast|quick)(?: V:do)?$|^(?:fast|quick) V:do$|^speed (?:V:increase|lot V:do|fast V:do)$/.test(str)) return "faster";
    if (/^aur slow(?: V:do)?$|^slow V:do$|^speed (?:V:decrease|kam V:do|slow V:do)$/.test(str)) return "slower";
    if (str === "slow") return "slowly";
    if (str === "fast" || str === "quick") return "fast";
    const place = has("@in") || has("@on") || has("V:go"); // "shuru mein", "end pe jao" (but "shuru karo" is not a place)
    if (all(SCROLLSET) && ls.some((l) => ["scroll", "up", "down", "top", "bottom"].includes(l) || ((l === "end" || l === "start") && place))) {
      const up = has("up"), down = has("down");
      if (up && down) return null; // "upar se neeche tak": a description, not a command
      if ((has("most") && up) || has("top") || (up && has("@to")) || (has("start") && !has("scroll"))) return "go to the top";
      if ((has("most") && down) || has("bottom") || (down && has("@to")) || (has("end") && !has("scroll"))) return "go to the bottom";
      const dir = up ? "up" : "down";
      const pace = has("slow") ? " slowly" : has("fast") || has("quick") ? " fast" : "";
      if (has("KEEP") || has("start")) return `keep scrolling ${dir}${pace}`;
      if (pace) return `scroll ${dir}${pace}`;
      return `scroll ${dir}${has("bit") ? " a bit" : has("lot") ? " a lot" : ""}`;
    }
    if (has("back") || has("previous")) {
      if (all(new Set(["back", "previous", "page", "@on", "@in", "V:go", "V:do", "V:move"]))) return "go back";
    }
    if (has("forward") && all(new Set(["forward", "page", "@on", "V:go", "V:do", "V:move"]))) return "go forward";
    if (has("next") && all(new Set(["next", "page", "@on", "@in", "V:go", "V:do", "V:open", "V:press", "one"]))) return "click next";

    // ---- a verb and its object: "doosra result kholo", "sign in pe click karo", "kholo teesra video" ----
    let vi = -1, vj = -1, verb = null;
    for (let i = ls.length - 1; i >= 0 && !verb; i--) if (VK[ls[i]]) { verb = VK[ls[i]]; vi = vj = i; }
    for (let i = ls.length - 1; i >= 1 && !verb; i--) if (ls[i] === "V:do" && EK[ls[i - 1]]) { verb = EK[ls[i - 1]]; vi = i - 1; vj = i; }
    if (!verb && EK[ls[0]]) {
      verb = EK[ls[0]]; vi = vj = 0;
      if (ls[1] === "V:do" || (verb === "show me" && T[1]?.o.toLowerCase() === "me")) vj = 1;
    }
    if (verb) {
      if (verb === "stop") return "stop";
      if (verb === "close") return "close";
      if (verb === "hide" || verb === "remove") return null;
      let o = renderObj(T.filter((_, i) => i < vi || i > vj));
      if (verb === "play") { if (!o || /^(?:video|song|music|this)$/.test(o)) return "play"; verb = "open"; } // "teesra video chalao"
      if (!o) return null;
      if (/^\d+$/.test(o)) return `click ${o}`; // "paanch number dabao", "5 नंबर पर क्लिक करो"
      if (verb === "select" && / filter$/.test(o)) o = o.replace(/ filter$/, ""); // "4 star filter lagao"
      return `${verb} ${o}`;
    }

    // no verb: "doosra wala", "sabse sasta", "number paanch" (as an answer to "which one?")
    const CTX = new Set([...ORDS, "most", "cheap", "costly", "good", "one", "this", "number", "result", "item", "product", "video",
      "link", "question", "button", "option", "tab", "@of", "@ko", "@on", "page", "kam", "price"]);
    if (ls.every((l) => CTX.has(l) || l[0] === "#")) {
      const o = renderObj(T);
      if (/^\d+$/.test(o) && has("number")) return `click ${o}`;
      if (ls.some((l) => ORDS.includes(l) || l === "cheap" || l === "costly")) return `open ${o}`;
    }
    return null;
  }

  // ---------- other sites, by name ----------
  // "open youtube", "go to gmail in a new tab". India-first where a site differs by country.
  const SITES = [
    ["youtube", "https://www.youtube.com/", ["you tube", "yt"]],
    ["gmail", "https://mail.google.com/", ["g mail", "google mail"]],
    ["google", "https://www.google.com/", []],
    ["google maps", "https://www.google.com/maps", ["maps", "map"]],
    ["google drive", "https://drive.google.com/", ["drive"]],
    ["google docs", "https://docs.google.com/document/", ["docs"]],
    ["google sheets", "https://docs.google.com/spreadsheets/", ["sheets"]],
    ["google slides", "https://docs.google.com/presentation/", ["slides"]],
    ["google calendar", "https://calendar.google.com/", ["calendar"]],
    ["google meet", "https://meet.google.com/", ["meet"]],
    ["google photos", "https://photos.google.com/", ["photos"]],
    ["google translate", "https://translate.google.com/", ["translate"]],
    ["chatgpt", "https://chatgpt.com/", ["chat gpt", "chat g p t", "open ai", "openai"]],
    ["claude", "https://claude.ai/", ["claude ai"]],
    ["gemini", "https://gemini.google.com/", ["google gemini"]],
    ["perplexity", "https://www.perplexity.ai/", []],
    ["github", "https://github.com/", ["git hub"]],
    ["stack overflow", "https://stackoverflow.com/", ["stackoverflow"]],
    ["leetcode", "https://leetcode.com/", ["leet code"]],
    ["geeksforgeeks", "https://www.geeksforgeeks.org/", ["geeks for geeks"]],
    ["linkedin", "https://www.linkedin.com/", ["linked in"]],
    ["naukri", "https://www.naukri.com/", []],
    ["indeed", "https://in.indeed.com/", []],
    ["instagram", "https://www.instagram.com/", ["insta"]],
    ["facebook", "https://www.facebook.com/", []],
    ["twitter", "https://x.com/", []],
    ["whatsapp", "https://web.whatsapp.com/", ["whatsapp web", "what's app"]],
    ["telegram", "https://web.telegram.org/", []],
    ["reddit", "https://www.reddit.com/", []],
    ["netflix", "https://www.netflix.com/", []],
    ["spotify", "https://open.spotify.com/", []],
    ["prime video", "https://www.primevideo.com/", ["amazon prime video", "amazon prime"]],
    ["hotstar", "https://www.hotstar.com/", ["disney hotstar", "jio hotstar"]],
    ["amazon", "https://www.amazon.in/", ["amazon india", "amazon in"]],
    ["flipkart", "https://www.flipkart.com/", []],
    ["myntra", "https://www.myntra.com/", []],
    ["swiggy", "https://www.swiggy.com/", []],
    ["zomato", "https://www.zomato.com/", []],
    ["irctc", "https://www.irctc.co.in/", []],
    ["wikipedia", "https://en.wikipedia.org/", ["wiki"]],
    ["bing", "https://www.bing.com/", []],
    ["duckduckgo", "https://duckduckgo.com/", ["duck duck go"]],
    ["outlook", "https://outlook.live.com/mail/", []],
    ["notion", "https://www.notion.so/", []],
    ["canva", "https://www.canva.com/", []],
    ["zoom", "https://zoom.us/", []],
    ["udemy", "https://www.udemy.com/", []],
    ["coursera", "https://www.coursera.org/", []],
  ];
  const SITE_INDEX = new Map();
  for (const [name, url, aliases] of SITES) for (const a of [name, ...aliases]) SITE_INDEX.set(a, { name, url });
  const TLD = "com|org|net|in|io|co|edu|gov|ai|dev|app|info|me|tv|us|uk|ly|gg|xyz";
  // A known site name, or something that is plainly an address; otherwise null (so "open the second result" is never taken for one)
  function siteFor(text) {
    let s = String(text || "").toLowerCase().trim().replace(/^(?:the|my)\s+/, "").replace(/\s+(?:website|site|app|page|homepage|home page|web)$/, "").replace(/\s+/g, " ");
    if (SITE_INDEX.has(s)) return SITE_INDEX.get(s);
    s = s.replace(/\s+dot\s+/g, ".").replace(/^https?:\/\//, "").replace(/^www\./, "");
    const dom = s.match(new RegExp(`^([a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD}))(/\\S*)?$`));
    return dom ? { name: dom[1], url: "https://" + dom[1] + (dom[2] || "/") } : null;
  }

  // "open the project and then chat" -> ["open the project", "chat"]. Only splits when what comes first is a real command that
  // does not take free text (a typed message may contain "then"), and keeps everything after a text command as one part.
  const NO_CHAIN = new Set(["type", "send", "search", "fill", "fillOrType", "typeEmail", "typeNumber", "typeDate", "dictate", "confirm"]);
  const CHAIN_SEP = /\s*,?\s*\b(?:and then|then|after that|afterwards)\b\s*,?\s*/i;
  function splitChain(raw) {
    const out = [];
    let rest = String(raw || "").trim();
    for (let i = 0; i < 4; i++) {
      const hit = rest.match(CHAIN_SEP);
      if (!hit) break;
      const left = rest.slice(0, hit.index).trim(), right = rest.slice(hit.index + hit[0].length).trim();
      if (!left || !right) break;
      const c = parse(left);
      // the first step must be a real command; later ones may be a command the AI will work out ("click the first result")
      const looksLikeOne = /^(?:click|open|press|select|tap|choose|pick|view|go|show|play|scroll|read)\b/i.test(left);
      if ((!c && (!out.length || !looksLikeOne)) || (c && NO_CHAIN.has(c.type))) break;
      out.push(left);
      rest = right;
    }
    if (!out.length) return null;
    out.push(rest);
    return out;
  }

  function parse(raw) {
    const t = normalize(raw);
    let m;
    if (!t) return null;

    if (/^(yes|yeah|yep|confirm|do it|go ahead)$/.test(t)) return { type: "confirm", yes: true };
    if (/^(no|nope|cancel|don'?t|never ?mind)$/.test(t)) return { type: "confirm", yes: false };

    // Help, undo, and reading what is on the screen
    if (/^(?:what can i say|what can you do|what do i say|what are the commands|what commands (?:are there|do you have)|(?:show|list|open|give me)(?: me)?(?: the)? (?:commands|command list)|help|help me|commands)$/.test(t)) return { type: "help" };
    if (/^(?:hide|close|dismiss)(?: the)? (?:help|commands|command list)$/.test(t)) return { type: "hideCard" };
    if (/^(?:undo|undo (?:that|this|it|the last (?:thing|one|action|command))|take (?:that|it) back|revert(?: that)?|reverse that|undo my last (?:thing|action))$/.test(t)) return { type: "undo" };
    if (/^(?:read|list|tell me)(?: me)?(?: out)?(?: the)? (?:results|options|items|products|videos|links)(?: on (?:the )?(?:screen|page))?$|^(?:what'?s|what is) (?:on )?(?:the |this )?screen$|^read (?:the )?screen$/.test(t)) return { type: "readResults" };

    // Which language the speech recognizer listens for ("hindi mein bolo" arrives here as "speak hindi", via toEnglish)
    if ((m = t.match(/^(?:speak|talk|listen)(?: in)? (hindi|english)$|^(?:switch|change)(?: the)?(?: language)? to (hindi|english)$|^(?:use|set)(?: the)? (hindi|english)(?: language)?$|^(hindi|english) (?:mode|language)$|^(?:set |change )?(?:the )?language (?:to )?(hindi|english)$/))) {
      return { type: "lang", lang: m.slice(1).find(Boolean) === "hindi" ? "hi-IN" : "en-IN" };
    }
    // "band karo": stop whatever is going on (a scroll, a popup, a video). Only toEnglish produces this phrase.
    if (t === "stop or close") return { type: "halt" };

    if (/^(stop listening|turn off( voice)?|switch off)$/.test(t)) return { type: "off" };
    if (/^(go to sleep|sleep|pause voice|snooze)$/.test(t)) return { type: "snooze" };
    if (/^(wake up|start listening|resume voice|i'?m back)$/.test(t)) return { type: "wakeUp" };
    if (/^(use|turn on|enable) (the )?(wake word|attention)( mode)?$/.test(t)) return { type: "attention", on: true };
    if (/^(always listen|turn off (the )?(wake word|attention)( mode)?|disable (the )?(wake word|attention)( mode)?)$/.test(t)) return { type: "attention", on: false };

    if (/^(close|dismiss|exit)( this| that| it| the)?( pop ?up| dialog| window| modal| menu| details| overlay| panel| sheet| card)?$|^(press )?(escape|esc)$/.test(t)) return { type: "close" };

    // ---- the voice log, tabs and other sites, video controls, scrolling a named part of the page, search, deselect ----
    if ((m = t.match(/^(?:show|open|view|see|display)(?: me)?(?: the)?(?: voice ?nav)?(?: voice)? (?:log|logs)$|^(?:voice ?nav )?log$/))) return { type: "log", view: "all" };
    if (/^(?:show|open|view|see|display)(?: me)?(?: the)? (?:failed|failing|failures?|errors?|unsuccessful|problem) (?:commands?|log|ones)?$|^what (?:failed|didn'?t work)$|^which commands? (?:failed|didn'?t work)$|^show (?:me )?(?:what|the things) (?:failed|that failed)$|^show failures$/.test(t)) return { type: "log", view: "failed" };
    if (/^(?:clear|delete|reset|empty)(?: the)?(?: voice ?nav)?(?: voice)? (?:log|logs)$/.test(t)) return { type: "logClear" };

    if (/^(?:use|turn on|enable|allow) (?:the )?(?:real|trusted|human) clicks?$|^(?:use|turn on|enable|allow) (?:real|trusted|human) clicking$/.test(t)) return { type: "trusted", on: true };
    if (/^(?:stop using|don'?t use|do not use|turn off|disable) (?:the )?(?:real|trusted|human) clicks?$|^(?:stop|disable) (?:real|trusted|human) clicking$/.test(t)) return { type: "trusted", on: false };
    // Which speech recogniser listens: Chrome's online one, or Whisper on this computer (works offline, and in Brave)
    if (/^(?:use|switch to|turn on|enable) (?:the )?(?:offline|local|whisper|private|on device)(?: speech)?(?: recogni[sz](?:er|tion))?(?: mode)?$/.test(t)) return { type: "stt", on: true };
    if (/^(?:use|switch to|turn on|enable) (?:the )?(?:chrome|online|google|browser)(?: speech)?(?: recogni[sz](?:er|tion))?$|^(?:stop using|turn off|disable) (?:the )?(?:offline|local|whisper)(?: speech)?(?: recogni[sz](?:er|tion))?(?: mode)?$/.test(t)) return { type: "stt", on: false };
    // Keyboard shortcuts, as real key presses: "press control shift s", "press tab", "press page down"
    if ((m = t.match(/^press ((?:(?:control|ctrl|shift|alt|option) )*)(?:(?:the )?(tab|space|spacebar|backspace|page up|page down|up arrow|down arrow|left arrow|right arrow)(?: key)?|([a-z0-9]))$/))) {
      const mods = m[1] || "";
      const named = { tab: ["Tab", "Tab", 9], space: [" ", "Space", 32], spacebar: [" ", "Space", 32], backspace: ["Backspace", "Backspace", 8], "page up": ["PageUp", "PageUp", 33], "page down": ["PageDown", "PageDown", 34],
        up: ["ArrowUp", "ArrowUp", 38], down: ["ArrowDown", "ArrowDown", 40], left: ["ArrowLeft", "ArrowLeft", 37], right: ["ArrowRight", "ArrowRight", 39] };
      const word = m[2] ? m[2].replace(/ arrow$/, "") : null;
      const ctrl = /control|ctrl/.test(mods), shift = /shift/.test(mods), alt = /alt|option/.test(mods);
      if (word && /^(?:tab|space|spacebar)$/.test(word) && !/ key$/.test(t)) { /* "press tab" may be a button called Tab: only "press the tab key" is the keyboard */ }
      else if (word) { const [key, code, vk] = named[word]; return { type: "pressKey", key: { key, code, vk, ctrl, shift, alt }, spoken: t.slice(6) }; }
      if (ctrl || alt) { // a bare letter is not a shortcut ("press a" is not a command); it needs control or alt
        const ch = m[3], up = ch.toUpperCase();
        return { type: "pressKey", key: { key: shift ? up : ch, code: /[0-9]/.test(ch) ? `Digit${ch}` : `Key${up}`, vk: up.charCodeAt(0), ctrl, shift, alt }, spoken: t.slice(6) };
      }
    }
    // Google Docs' own dictation, which is far steadier than typing into the editor from here
    if (/^(?:start|open|turn on|use|begin)(?: the)?(?: google)?(?: docs)? voice typing$|^voice typing(?: on)?$/.test(t)) return { type: "docsVoice" };
    // Guided tour: hear what is on the page. ("what's on the screen" stays the results list, below.)
    if (/^(?:what(?:'s| is) on (?:this|the) page|what(?:'s| is) (?:this|the) page|describe (?:this|the) page|(?:read|summari[sz]e|tell me about) (?:this|the) page|(?:give me )?(?:a |the )?(?:page )?(?:tour|overview)|where am i|what page (?:is this|am i on)|what can i do here)$/.test(t)) return { type: "tour" };
    if (/^(?:stop|quit|cancel|end) (?:reading|talking|speaking|the tour)$|^(?:be quiet|hush|shush|quiet|silence|shut up)$/.test(t)) return { type: "hush" };
    if (/^(?:talk|speak|read|answer) (?:back|aloud|out loud)(?: on)?$|^(?:turn on|enable|start) (?:talk ?back|spoken replies|speech|voice replies)$|^speak (?:the )?replies$/.test(t)) return { type: "talkBack", on: true };
    if (/^(?:stop talking back|don'?t talk back|talk ?back off|(?:turn off|disable) (?:talk ?back|spoken replies|speech|voice replies)|stop spoken replies)$/.test(t)) return { type: "talkBack", on: false };
    // YouTube comments
    if (/^(?:(?:i )?(?:want to|wanna|need to) )?(?:add|write|post|leave|make)(?: a| my)? comment(?: (?:on|for|to|under) (?:this|the|that)(?: video)?)?$|^comment(?: (?:on|under) (?:this|the|that)(?: video)?)?$|^(?:open|go to|show)(?: the)? comment ?box$/.test(t)) return { type: "comment" };

    // Tabs
    const TAB_TAIL = "(?: (?:that|which) (?:is|are|'s) (?:currently |already )?open(?:ed)?)?"; // "the first tab that is open"
    const ORD_TAB = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, last: -1, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };
    if (/^(?:open|create|start|make|add|give me)(?: a)?(?: new)?(?: blank| empty)? tab$|^new tab$/.test(t)) return { type: "tab", op: "new" };
    if (/^(?:(?:go|switch|move|jump|change)(?: back)? to |show |open )?(?:the )?next tab$|^tab (?:to the )?right$|^(?:switch|change|flip|toggle)(?: to)?(?: the)?(?: another| other)? tabs?$|^(?:go|switch|move|jump|change) to (?:the |an )?(?:other|another) tab$|^tab switch$/.test(t)) return { type: "tab", op: "next" };
    if (/^(?:(?:go|switch|move|jump|change)(?: back)? to |show |open |back to )?(?:the )?(?:previous|prior|last used|old|earlier|one before) tab$|^(?:go )?back to (?:the )?(?:previous|prior|old|earlier) tab$|^tab (?:to the )?left$/.test(t)) return { type: "tab", op: "prev" };
    if ((m = t.match(new RegExp(`^(?:go|switch|move|jump|change)(?: back)? to (?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|last|1st|2nd|3rd|4th|5th) tab${TAB_TAIL}$|^(?:the )?(first|last) tab${TAB_TAIL}$`)))) return { type: "tab", op: "index", n: ORD_TAB[m[1] || m[2]] };
    if ((m = t.match(/^(?:go|switch|move|jump|change) to (?:the )?tab (?:number )?(\w+)$|^tab (?:number )?(\d+)$/))) { const n = toNumber(m[1] || m[2]); if (n) return { type: "tab", op: "index", n }; }
    if (/^(?:list|show|read|what(?:'s| is| are)) (?:me )?(?:all )?(?:my |the |all )?(?:open |opened )?tabs(?: (?:are )?open)?$|^what tabs (?:are|do i have)(?: open)?$|^which tabs are open$/.test(t)) return { type: "tab", op: "list" };
    if (/^close (?:this|the current|current) tab$|^close tab$/.test(t)) return { type: "tab", op: "close" };
    if (/^(?:reopen|restore|bring back|undo close)(?: the)?(?: last| previous)?(?: closed)? tab$|^reopen closed tab$/.test(t)) return { type: "tab", op: "reopen" };
    // another site, by name ("open youtube", "go to gmail", "open amazon in a new tab") or by address ("open example.com")
    {
      const said2 = raw.trim().toLowerCase().replace(/[.,!?]+$/, "").replace(/\s+dot\s+/g, ".");
      if ((m = said2.match(/^(?:please |can you |could you )?(?:open|go to|visit|take me to|launch|navigate to|load)(?: up)? (.+?)(?: (?:in|on) (?:a |the )?(?:new|another) (?:tab|window))?$/))) {
        const newTab = / (?:in|on) (?:a |the )?(?:new|another) (?:tab|window)$/.test(said2);
        const site = siteFor(m[1]);
        if (site) return { type: "openSite", name: site.name, said: m[1].replace(/^(?:the|my)\s+/, ""), url: site.url, newTab };
      }
      if ((m = said2.match(/^(?:switch|go|jump|change|move) to (?:the )?(.+?)(?: tab| window| page)?$/))) {
        const site = siteFor(m[1]);
        if (site && !/^(?:top|bottom|left|right|next|previous|first|last)$/.test(m[1])) return { type: "tab", op: "site", name: site.name, url: site.url };
      }
    }

    // Video and audio beyond play and pause
    // the rate is read from the spoken text, because normalising drops the decimal point ("1.5" would become "15")
    const rl = raw.trim().toLowerCase().replace(/[!?,]+$/, "").replace(/\s+point\s+/g, ".").replace(/\.$/, "");
    if ((m = rl.match(/^(?:set |change |make |put |play (?:it |the video )?(?:at|in) )?(?:the )?(?:video |playback |play )?speed(?: to| at| of)? (\d+(?:\.\d+)?)(?: ?x| times)?$|^(\d+(?:\.\d+)?) ?(?:x|times)(?: speed)?$|^(\d+(?:\.\d+)?) speed$/))) {
      const rate = parseFloat(m[1] || m[2] || m[3]);
      if (rate > 0 && rate <= 16) return { type: "mediaSpeed", rate };
    }
    if ((m = t.match(/^(?:(?:set |change |make |put )?(?:the )?(?:video |playback )?speed (?:to |at )?)?(normal|regular|default|double|half|triple)(?: speed)?$/)) && /speed/.test(t)) return { type: "mediaSpeed", rate: { normal: 1, regular: 1, default: 1, double: 2, half: 0.5, triple: 3 }[m[1]] };
    if (/^(?:reset|restore) (?:the )?(?:video |playback )?speed$/.test(t)) return { type: "mediaSpeed", rate: 1 };
    if (/^(?:speed up|make|play) (?:it|the (?:video|song|audio|music)) (?:play )?faster$|^(?:increase|raise) (?:the )?(?:video |playback )?speed$|^(?:video|playback) (?:speed )?(?:faster|up)$|^faster (?:video|playback)$|^play faster$/.test(t)) return { type: "mediaSpeed", delta: 1 };
    if (/^(?:slow down|make|play) (?:it|the (?:video|song|audio|music)) (?:play )?slower$|^slow down (?:the )?(?:video|song|audio|music)$|^(?:decrease|lower|reduce) (?:the )?(?:video |playback )?speed$|^(?:video|playback) (?:speed )?(?:slower|down)$|^slower (?:video|playback)$|^play slower$/.test(t)) return { type: "mediaSpeed", delta: -1 };
    if ((m = t.match(/^(?:(skip|forward|fast forward|go forward|jump|move)(?: ahead| forward| on)?|(rewind|go back|skip back|back|jump back|move back|reverse)(?: by)?)(?: by)? (\w+)(?: (seconds?|secs?|minutes?|mins?))$/))) {
      const n = toNumber(m[3]);
      if (n) { const secs = n * (/^min/.test(m[4]) ? 60 : 1); return { type: "mediaSeek", by: (m[2] ? -1 : 1) * secs }; }
    }
    if ((m = t.match(/^(?:go to|jump to|seek to|skip to|start at) (\w+) (minutes?|mins?|seconds?|secs?)(?: (?:and )?(\w+) (?:seconds?|secs?))?$/))) {
      const a = toNumber(m[1]), b = m[3] ? toNumber(m[3]) : 0;
      if (a !== null && b !== null) return { type: "mediaSeek", to: /^min/.test(m[2]) ? a * 60 + b : a };
    }
    if (/^(?:restart|replay|start over|from the beginning)(?: the)?(?: video| song| audio)?$|^play (?:it )?again$/.test(t)) return { type: "mediaSeek", to: 0 };
    if (/^(?:full ?screen|go full ?screen|make (?:it|the video) full ?screen|enter full ?screen|play full ?screen)$/.test(t)) return { type: "mediaExtra", kind: "fullscreen" };
    if (/^(?:exit|leave|close|stop|come out of) full ?screen$|^(?:normal|small|regular) screen$/.test(t)) return { type: "mediaExtra", kind: "exitFullscreen" };
    if (/^(?:theat(?:er|re)|cinema) mode$|^(?:turn on |use )?theat(?:er|re) mode$/.test(t)) return { type: "mediaExtra", kind: "theater" };
    if ((m = t.match(/^(?:turn |switch )?(on |off )?(?:the )?(?:captions?|subtitles?|closed captions?|cc)(?: (on|off))?$/)) && (m[1] || m[2] || /^(?:turn|switch)/.test(t))) return { type: "mediaExtra", kind: "captions", on: (m[1] || m[2] || "on").trim() === "on" };
    if (/^(?:open|show|go to|switch to|expand|maxim[ie][sz]e|bring back|restore|enlarge|open up)(?: the)? (?:mini ?player|small player|little video|video in the (?:right |bottom )?corner|floating video|(?:video|player) (?:in|at|on) the (?:right |bottom |left )?(?:corner|side))$|^(?:expand|enlarge|maxim[ie][sz]e|bring back|restore) (?:the |this )?(?:video|player)$/.test(t)) return { type: "mediaExtra", kind: "expandMini" };
    if (/^(?:close|dismiss|remove|hide|stop)(?: the)? (?:mini ?player|small player|little video|floating video|video in the (?:right |bottom )?corner)$/.test(t)) return { type: "mediaExtra", kind: "closeMini" };
    if (/^(?:next|skip|play next|go to (?:the )?next) (?:video|song|track|episode)$|^next (?:one|song)$/.test(t) && !/^next one$/.test(t)) return { type: "mediaExtra", kind: "next" };
    if (/^(?:previous|prior|play previous|go to (?:the )?previous) (?:video|song|track|episode)$/.test(t)) return { type: "mediaExtra", kind: "previous" };
    if (/^(?:skip|close|skip past)(?: the| this| that)? (?:ads?|add|adds|advert|advertisement|commercial)$|^skip(?: it| this| that)?$/.test(t)) return { type: "mediaExtra", kind: "skipAd" };
    if (/^(?:like|thumbs up|give (?:it |this |the video )?a (?:like|thumbs up)|i like (?:this|it)|like (?:this|the|it)(?: video| song| one| post)?)$/.test(t)) return { type: "mediaExtra", kind: "like" };
    if (/^(?:dislike|thumbs down|give (?:it |this |the video )?a (?:dislike|thumbs down)|dislike (?:this|the|it)(?: video| song| one| post)?)$/.test(t)) return { type: "mediaExtra", kind: "dislike" };
    if (/^subscribe(?: to (?:this |the )?channel| to (?:this|it))?$|^subscribe$/.test(t)) return { type: "mediaExtra", kind: "subscribe" };

    // Scrolling one part of the page: "scroll down the recent chats", "scroll up in the sidebar"
    {
      const AREAS = "(?:left side ?bar|left sidebar|side ?bar|side panel|left panel|left side|left menu|left|recent chats?|chats? list|chat history|conversation list|history list|navigation|nav|menu|right side ?bar|right panel|right side|right|main chat|main area|main|chat|conversation|messages|thread|content|comments|inbox|email list|mail list|reading pane|results|list|page)";
      const area = (a) => (/left|side ?bar|side panel|recent|history|navigation|nav|menu/.test(a) && !/right/.test(a) ? "left" : /right/.test(a) ? "right" : /list|inbox|results|email|mail/.test(a) ? "list" : "main");
      if ((m = t.match(new RegExp(`^scroll(?:ing)? (down|up)(?: a (?:little )?bit| slightly| a lot| a little| more)?(?: (?:in|on|at|of|inside|within))?(?: the)? (${AREAS})$`)))) {
        return { type: "scroll", dir: m[1], amount: / a lot$/.test(t.replace(new RegExp(` ${AREAS}$`), "")) ? 1.5 : /bit|slightly|little/.test(t) ? 0.3 : 0.8, area: area(m[2]) };
      }
      if ((m = t.match(new RegExp(`^scroll(?:ing)? (?:the |in the |on the |through the )?(${AREAS}) (down|up)$`)))) return { type: "scroll", dir: m[2], amount: 0.8, area: area(m[1]) };
    }

    // "search" on its own: get to the search box (click the search icon if that is how the site hides it), then say what to look for
    if (/^(?:search|find|search here|start (?:a )?search|open search|click search|focus (?:on )?(?:the )?search|(?:go to|use|open|click|press|tap|select) (?:the )?search(?: box| bar| icon| button| field| chats?| menu)?)$/.test(t) || /^(?:search|find) (?:chats?|conversations?|messages?|history)$/.test(t)) return { type: "focusSearch" };

    // "clear all": the page's own button (filters, a list) if it has one; the AI otherwise
    if (/^(?:clear|reset) (?:all|everything|all filters|filters)$/.test(t)) return { type: "clickText", text: t };
    // Un-selecting what is selected ("deselect all emails")
    if (/^(?:deselect|unselect|un select|de select|uncheck|untick)(?: all| everything| these| them| selected| it)?(?: the)?(?: selection| selected)?(?: emails?| mails?| messages?| items?| conversations?| checkboxes| boxes| rows)?$/.test(t) || /^clear (?:the |my )?(?:selection|selected(?: emails?| mails?| messages?| items?)?)$/.test(t)) return { type: "uncheckAll" };
    if (/^(?:select|check|tick) (?:all|everything)(?: emails?| mails?| messages?| items?| conversations?)?$/.test(t) && !/^select all$/.test(t)) return { type: "selectAllItems" };

    // Back out of an open email / conversation / post, to the list it came from
    if (/^(?:close|exit|leave|dismiss)(?: the| this| that)? (?:email|e-mail|mail|message|conversation|thread)$|^back to (?:the )?(?:inbox|list|results|search results|mails?|emails?|messages|conversations?|all)$/.test(t)) return { type: "close", back: true };

    if (/^(show|display) (the )?numbers?$|^numbers on$/.test(t)) return { type: "numbers", on: true };
    if (/^(hide|remove) (the )?numbers?$|^numbers off$/.test(t)) return { type: "numbers", on: false };

    // Continuous scrolling: "scroll down slowly" keeps going until you say stop
    const PACE = "(slowly|slow|gently|steadily|fast|quickly|quick|continuously|automatically)";
    if ((m = t.match(new RegExp(`^(?:scroll|go|move) (down|up) (?:very |really |super |more )?${PACE}$`)))) return { type: "autoScroll", dir: m[1], speed: SPEED[m[2]] || "medium" };
    if ((m = t.match(new RegExp(`^(?:scroll|go|move) (?:very |really |super |more )?${PACE}(?: (down|up))?$`)))) return { type: "autoScroll", dir: m[2] || "down", speed: SPEED[m[1]] || "medium" };
    if ((m = t.match(/^(slowly|gently|steadily|quickly|fast) (?:scroll|go|move) (down|up)$/))) return { type: "autoScroll", dir: m[2], speed: SPEED[m[1]] };
    // Speech recognition often splits "scroll down slowly" into "scroll down" and then "slowly". The second half, said on
    // its own right after a scroll, turns that scroll into a continuous one.
    if ((m = t.match(/^(?:very |really )?(slowly|slow|gently|steadily|fast|quickly|quick)$/))) return { type: "scrollMore", speed: SPEED[m[1]] };
    if (/^(?:keep going|keep on going|carry on|continue scrolling|continue down)$/.test(t)) return { type: "scrollMore", speed: null };
    if ((m = t.match(/^(?:keep scrolling|start scrolling|auto ?scroll)(?: (down|up))?(?: (slowly|slow|gently|fast|quickly))?$/))) return { type: "autoScroll", dir: m[1] || "down", speed: SPEED[m[2]] || "medium" };
    if (/^(?:stop|pause|halt|freeze)(?: the)? scroll(?:ing)?$/.test(t)) return { type: "stopScroll" };
    if (/^(faster|speed up|scroll faster|go faster)$/.test(t)) return { type: "scrollSpeed", faster: true };
    if (/^(slower|slow down|scroll slower|go slower)$/.test(t)) return { type: "scrollSpeed", faster: false };

    // Get the control pill out of the way when it covers something
    const PANEL_OLD = "(?:panel|pill|voicenav|voice panel|controls?)";
    const PANEL = "(?:panel|pill|voicenav|voice panel|controls?|(?:voice |mic |microphone )?(?:icon|button|widget)|voice|mic|microphone)";
    const SPOT = "(top|bottom|left|right|up|down)(?: (left|right|top|bottom))?(?: corner| side)?";
    // "move the voice icon to the top right", "move it to the top left", "put the mic at the bottom"
    const moveM = t.match(new RegExp(`^(?:please )?(?:move|put|dock|shift|place|send) (?:the |this |my )?${PANEL}(?: to| at| in| on)?(?: the)? ${SPOT}$`)) ||
      t.match(new RegExp(`^(?:please )?(?:move|put|dock|shift|place|send) (?:it|this|that)(?: to| at| in| on)?(?: the)? ${SPOT}$`)) ||
      t.match(/^(?:please )?(?:move|put|dock|shift|place) (?:to|at) (?:the )?(top|bottom)[ -](left|right)(?: corner)?$/);
    if (moveM) {
      const out = { type: "movePanel", v: null, h: null };
      for (const w of [moveM[1], moveM[2]]) {
        const side = { up: "top", down: "bottom" }[w] || w;
        if (side === "top" || side === "bottom") out.v = side;
        else if (side === "left" || side === "right") out.h = side;
      }
      return out;
    }
    if (new RegExp(`^(?:hide|minimi[sz]e) (?:the )?${PANEL_OLD}$`).test(t)) return { type: "panel", show: false };
    if (new RegExp(`^(?:show|restore|bring back) (?:the )?${PANEL_OLD}$`).test(t)) return { type: "panel", show: true };

    if ((m = t.match(/^scroll (down|up)(?: just)?(?: a (?:little )?bit| a little| a tad| a touch| a smidge| slightly| little| bit)$/))) return { type: "scroll", dir: m[1], amount: 0.3 };
    if ((m = t.match(/^scroll (down|up) a lot$/))) return { type: "scroll", dir: m[1], amount: 1.5 };
    if ((m = t.match(/^(?:scroll|page|go) (down|up)$/))) return { type: "scroll", dir: m[1], amount: 0.8 };
    if (/^(?:scroll |go )?(?:to )?(?:the )?(?:top|beginning)(?: of (?:the )?page)?$/.test(t)) return { type: "scrollEdge", to: "top" };
    if (/^(?:scroll |go )?(?:to )?(?:the )?(?:bottom|end)(?: of (?:the )?page)?$/.test(t)) return { type: "scrollEdge", to: "bottom" };

    if (/^(go )?back$|^(go to )?(the )?previous page$/.test(t)) return { type: "nav", to: "back" };
    if (/^(go )?forward$/.test(t)) return { type: "nav", to: "forward" };
    if (/^(reload|refresh)( the)?( page)?$/.test(t)) return { type: "nav", to: "reload" };

    // "pause" is often heard as "paws" / "pores" / "pose"; "hold on" and "wait" also mean stop what is moving
    if (/^(pause|paused|paws|pawz|pores|pours|pose|stop|hold on|hold it|wait|freeze)( it| that)?( the)?( video| music| audio| playback)?$/.test(t)) return { type: "media", kind: "pause" };
    if (/^(play|resume|continue)( the)?( video| music| audio| playback)?$/.test(t)) return { type: "media", kind: "play" };
    if (/^mute( the)?( video| music| audio)?$/.test(t)) return { type: "media", kind: "mute" };
    if (/^unmute( the)?( video| music| audio)?$/.test(t)) return { type: "media", kind: "unmute" };

    // "add to card" / "ad to cart" are typical mishearings
    if (/^(?:add|ad|at) (?:this |it |that )?(?:to|too|2) (?:my |the )?(?:cart|card|kart|basket|bag)$/.test(t)) return { type: "clickText", text: "add to cart" };

    // Sorting: "sort by price low to high" picks that option; plain "sort by" opens the control
    if (/^sort(?: by)?$/.test(t)) return { type: "clickText", text: "sort by" };
    if ((m = t.match(/^sort(?: (?:the )?(?:results|items|list|products))?(?: by)? (.+)$/))) return { type: "sortBy", text: m[1] };

    // Chat sites: "send", "send it", "press send", "submit message". Checked before "press X" so it never becomes a
    // click on whatever is labelled "send" (a chat's Send button is often disabled until the text has registered).
    if (/^(submit|press enter|hit enter|press return|enter|go)$/.test(t)) return { type: "submit" }; // before "press X"
    if (SEND_ONLY.test(t)) return { type: "send" };
    // "type hello and send it", "send what is 2 plus 2", "ask Claude what is 2 plus 2": type into the message box, then send.
    // The text comes from what was said (case and "?" kept), not the normalised form.
    const said = rawCommand(raw);
    // Google Docs/Sheets/Slides: "rename the document to Trip plan", "type hello in the document", "type Trip plan in the title"
    if ((m = said.match(/^(?:rename|retitle)(?: (?:this|the|my))?(?: (?:document|doc|file|spreadsheet|sheet|presentation|slides?|it))? (?:to|as) (.+)$/i)) ||
        (m = said.match(/^(?:change|set|edit|update)(?: (?:this|the|my))?(?: (?:document|doc|file))? (?:title|name)(?: (?:to|as)) (.+)$/i)))
      return { type: "rename", text: m[1].replace(/[.]$/, "") };
    if ((m = said.match(/^(?:type|write|enter|put)\s+(.+?)\s+(?:in|into|on) (?:the |this |my )?(document|doc|page|body|file|title)$/i)))
      return { type: "typeIn", target: /title/i.test(m[2]) ? "title" : "document", text: m[1].replace(/[.]$/, ""), full: said.replace(/^(?:type|write|enter|put)\s+/i, "") };
    if ((m = said.match(/^(?:type|write|enter)\s+(.+?)\s+(?:in|into|on) (?:the |this |my )?gemini(?: (?:box|panel|chat|prompt))?$/i)))
      return { type: "typeIn", target: "gemini", text: m[1].replace(/[.]$/, ""), full: said.replace(/^(?:type|write|enter)\s+/i, "") };
    if ((m = said.match(TYPE_AND_SEND))) return { type: "send", text: cleanText(m[1]) };
    if ((m = said.match(/^(?:send|ask)\s+(.+)$/i))) {
      const text = cleanText(m[1].replace(/^(?:a |the )?message\s+(?:saying|that says)\s+/i, "").replace(ASSISTANT, ""));
      if (text && !/^(?:it|that|this)\b/i.test(text)) return { type: "send", text }; // "send it to mom" isn't a message
    }

    // ---- dictation, editing a box, and forms ----
    if (/^(?:start|begin|turn on|enable|switch to)(?: the)? dictation(?: mode)?$|^dictation(?: mode)?(?: on)?$|^dictate$/.test(t)) return { type: "dictate", on: true };
    if (/^(?:stop|end|finish|turn off|disable|exit|leave|quit)(?: the)? (?:dictation|dictating)(?: mode)?$|^dictation off$/.test(t)) return { type: "dictate", on: false };
    if (/^(?:go to |move to |jump to |press |hit )?(?:the )?next (?:form )?(?:field|box|input)$|^(?:press|hit) tab$/.test(t)) return { type: "nextField", dir: 1 };
    if (/^(?:go to |move to |jump to )?(?:the )?(?:previous|prior) (?:form )?(?:field|box|input)$|^(?:press |hit )?shift tab$|^back (?:one |a )?field$/.test(t)) return { type: "nextField", dir: -1 };
    if (/^(?:list|show|read)(?: me)?(?: out)?(?: all)?(?: the)? (?:form )?(?:fields|inputs|form)$|^what(?:'s| is| are)(?: in)? (?:the |this )?(?:form|fields)(?: here| on this page)?$|^what fields (?:are there|are here|do i have)$/.test(t)) return { type: "listFields" };
    if (/^(?:read|what(?:'s| is) in)(?: me)?(?: back)?(?: this| the current)? (?:field|box)$|^what did i (?:type|write|say)$|^read (?:back )?what i (?:typed|wrote|said)$/.test(t)) return { type: "readField" };
    if (/^(?:repeat|again|repeat that|do (?:it|that) again|same again|once more)$/.test(t)) return { type: "repeat" };
    // editing the box you are in
    if (/^(?:delete|remove|erase|scratch)(?: the)? last word$|^(?:delete|erase) word$|^backspace(?: a)? word$/.test(t)) return { type: "edit", op: "deleteWord" };
    if (/^(?:delete|remove|erase|scratch)(?: the)? last sentence$|^(?:delete|erase) sentence$/.test(t)) return { type: "edit", op: "deleteSentence" };
    if (/^(?:delete|remove|erase|scratch) (?:that|this|it)$/.test(t)) return { type: "edit", op: "deleteThat", heard: t };
    if (/^(?:backspace|delete (?:one |a |the last )?(?:character|letter))$/.test(t)) return { type: "edit", op: "backspace" };
    if (/^select (?:all|everything)(?: text)?$/.test(t)) return { type: "edit", op: "selectAll" };
    if (/^new line$/.test(t)) return { type: "edit", op: "newLine" };
    if (/^new paragraph$/.test(t)) return { type: "edit", op: "newParagraph" };

    // filling a named field. The value keeps the case of what was said ("Asha"), so these read the spoken text, not `t`.
    const spoken = rawCommand(raw);
    if ((m = spoken.match(/^(?:type|enter|write)(?: in)? (?:the |my )?(?:(?:phone |mobile |pin |zip |card |account )?(?:number|digits)|otp|pin(?: code)?|zip(?: code)?|code) (.+)$/i))) return { type: "typeNumber", full: cleanText(spoken.replace(/^(?:type|enter|write)\s+/i, "")), text: cleanText(m[1]) };
    if ((m = spoken.match(/^(?:type|enter|write)(?: in)? (?:the |my )?e-?mail(?: address| id)? (.+)$/i))) return { type: "typeEmail", full: cleanText(spoken.replace(/^(?:type|enter|write)\s+/i, "")), text: cleanText(m[1]) };
    if ((m = spoken.match(/^(?:type|enter|write)(?: in)? (?:the |my )?(?:date|birthday|date of birth|dob) (.+)$/i))) return { type: "typeDate", full: cleanText(spoken.replace(/^(?:type|enter|write)\s+/i, "")), text: cleanText(m[1]) };
    if ((m = spoken.match(/^(?:untick|uncheck)(?: the)? (.+?)(?: check ?box| box| switch| option)?$/i))) return { type: "check", hint: /check ?box$/i.test(spoken) ? "checkbox" : "", field: cleanText(m[1]), on: false };
    if ((m = spoken.match(/^(?:tick|check off)(?: the)? (.+?)(?: check ?box| box| switch| option)?$/i)) || (m = spoken.match(/^check (?:the )?(?!(?:the|out)\b)(.+?) (?:check ?box|box|switch)$/i))) return { type: "check", hint: /check ?box$/i.test(spoken) ? "checkbox" : "", field: cleanText(m[1]), on: true };
    if ((m = spoken.match(/^turn (on|off)(?: the)? (.+?) (?:switch|toggle|checkbox)$/i))) return { type: "check", hint: /check ?box$/i.test(spoken) ? "checkbox" : "", field: cleanText(m[2]), on: m[1].toLowerCase() === "on" };
    if ((m = spoken.match(/^(?:fill(?: in| out)?|set|change) (?:the |my )?(.+?) (?:with|to|as) (.+)$/i))) return { type: "fill", soft: !/^fill/i.test(spoken), heard: spoken, field: cleanText(m[1]), value: cleanText(m[2]) };
    if (!/^clear (?:the |my )?(?:text|field|box|input|all|everything|screen|page|cart|search|history)$/i.test(spoken) && (m = spoken.match(/^clear (?:the |my )?(?!the\b)(.+?)(?: field| box| input)?$/i))) return { type: "fill", soft: true, heard: spoken, field: cleanText(m[1]), value: "" };
    // "type Asha in name": a field if one is called that, otherwise it was just text that contains the word "in"
    if ((m = spoken.match(/^(?:type|enter|write|put) (.+?) (?:in|into) (?:the |my )?(.+?)(?: field| box| input)?$/i))) {
      return { type: "fillOrType", strict: /^put/i.test(spoken), heard: spoken, value: cleanText(m[1]), field: cleanText(m[2]), text: cleanText(spoken.replace(/^(?:type|enter|write|put)\s+/i, "")) };
    }

    if ((m = t.match(/^(?:number|no) (\w+)$/)) && toNumber(m[1]) !== null) return { type: "clickNumber", n: toNumber(m[1]) };
    if ((m = t.match(/^(click|open|press|select|tap|choose|pick|expand|go to|visit|view|see|look at|read|show me|take me to|check out)(?: on)?(?: number| item)? (.+)$/))) {
      const n = toNumber(m[2]);
      if (n !== null) return { type: "clickNumber", n };
      // "open the fresh mini orange page": "page", "link" and "button" are filler, not part of the label
      const phrase = m[2].replace(/^(?:more about|more of|about)\s+/, "").replace(/^the /, "").replace(/\s+(page|link|button|option|item|product|tab|one|ones)$/, "");
      if (isContextual(phrase)) return null;
      // opening/viewing something means following a link, never pressing an "Add to cart" button that mentions it
      return /^(open|go to|visit|view|see|look at|read|show me|take me to|check out)$/.test(m[1])
        ? { type: "clickText", text: phrase, navigate: true }
        : { type: "clickText", text: phrase };
    }

    if ((m = t.match(/^(?:search(?: for)?|look for) (.+)$/))) return { type: "search", text: m[1] };

    const typed = raw.trim().match(/^(?:type|write|enter)\s+(.+)$/i);
    if (typed) return { type: "type", text: typed[1].replace(/[.]$/, "") };
    if (/^(clear|delete) (the )?(text|field|box)$/.test(t)) return { type: "clear" };

    return null;
  }

  // The recognizer returns several guesses for one utterance, best first ("paws" / "pause" / "pose"). The best guess is the
  // right one most of the time, but when it isn't a command and a lower one is, the command is almost certainly what was said.
  // If none parses, keep the top guess (it may be something for the AI or for typing).
  function bestAlternative(alts) {
    const list = (alts || []).map((a) => String(a || "").trim()).filter(Boolean);
    if (!list.length) return "";
    const understood = (a) => { try { return parse(toEnglish(stripWake(a) ?? a)) !== null; } catch { return false; } };
    if (understood(list[0])) return list[0];
    return list.slice(1).find(understood) || list[0];
  }

  return { parse, toNumber, normalize, stripWake, toEnglish, siteFor, SITES, splitChain, bestAlternative };
});
