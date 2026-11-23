/**
 * Offline rule-based English-to-Marathi phonetic transliteration engine.
 * Converts Roman/Latin phonetic typing to Devanagari script.
 * Works 100% offline with zero external network or model dependencies.
 */

export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

export function containsLatin(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

/** Common FMCG, grocery, brand, and retail words with standard Marathi spellings. */
export const PHONETIC_RETAIL_MAP: Record<string, string> = {
  // Groceries & Staples
  sakhar: 'साखर',
  shakkar: 'साखर',
  sugar: 'साखर',
  kanda: 'कांदा',
  kaanda: 'कांदा',
  onion: 'कांदा',
  onions: 'कांदे',
  batata: 'बटाटा',
  potato: 'बटाटा',
  potatoes: 'बटाटे',
  aalu: 'बटाटा',
  alu: 'बटाटा',
  tomato: 'टोमॅटो',
  tamatar: 'टोमॅटो',
  chaha: 'चहा',
  chai: 'चहा',
  tea: 'चहा',
  doodh: 'दूध',
  dudh: 'दूध',
  milk: 'दूध',
  tel: 'तेल',
  oil: 'तेल',
  toop: 'तूप',
  tup: 'तूप',
  ghee: 'तूप',
  loni: 'लोणी',
  butter: 'लोणी',
  dahi: 'दही',
  curd: 'दही',
  paneer: 'पनीर',
  cheese: 'चीज',
  gahu: 'गहू',
  gehu: 'गहू',
  wheat: 'गहू',
  tandul: 'तांदूळ',
  tandool: 'तांदूळ',
  rice: 'तांदूळ',
  poha: 'पोहे',
  pohe: 'पोहे',
  sabudana: 'साबुदाणा',
  rava: 'रवा',
  sooji: 'रवा',
  suji: 'रवा',
  besan: 'बेसन',
  maida: 'मैदा',
  atta: 'आटा',
  flour: 'पीठ',
  pith: 'पीठ',
  meeth: 'मीठ',
  mith: 'मीठ',
  salt: 'मीठ',
  halad: 'हळद',
  haldi: 'हळद',
  turmeric: 'हळद',
  mirchi: 'मिरची',
  chilli: 'मिरची',
  chili: 'मिरची',
  jeera: 'जिरे',
  jira: 'जिरे',
  cumin: 'जिरे',
  mohari: 'मोहरी',
  mustard: 'मोहरी',
  dhane: 'धणे',
  kothimbir: 'कोथिंबीर',
  coriander: 'कोथिंबीर',
  lasun: 'लसूण',
  lahsun: 'लसूण',
  garlic: 'लसूण',
  aale: 'आले',
  adrak: 'आले',
  ginger: 'आले',
  limbu: 'लिंबू',
  nimbu: 'लिंबू',
  lemon: 'लिंबू',
  shengdana: 'शेंगदाणे',
  groundnut: 'शेंगदाणे',
  peanut: 'शेंगदाणे',
  kaju: 'काजू',
  cashew: 'काजू',
  badam: 'बदाम',
  almond: 'बदाम',
  pista: 'पिस्ता',
  manuka: 'मनुका',
  kismis: 'मनुका',
  raisins: 'मनुका',
  dal: 'डाळ',
  daal: 'डाळ',
  toor: 'तूर',
  tur: 'तूर',
  moong: 'मूग',
  mung: 'मूग',
  urad: 'उडीद',
  chana: 'चना',
  masoor: 'मसूर',
  biscuit: 'बिस्किट',
  biscuits: 'बिस्किटे',
  bread: 'ब्रेड',
  toast: 'टोस्ट',
  khari: 'खारी',
  soap: 'साबण',
  sabun: 'साबण',
  shampoo: 'शॅम्पू',
  brush: 'ब्रश',
  paste: 'पेस्ट',
  detergent: 'डिटर्जंट',
  namkeen: 'नमकीन',
  farsan: 'फरसाण',
  chivda: 'चिवडा',
  shev: 'शेव',
  sev: 'शेव',
  chakli: 'चकली',
  samosa: 'समोसा',
  kachori: 'कचोरी',
  bhel: 'भेळ',
  ladoo: 'लाडू',
  laddu: 'लाडू',
  pedha: 'पेढा',
  barfi: 'बर्फी',
  dukan: 'दुकान',
  kirana: 'किराणा',
  grahak: 'ग्राहक',
  nag: 'नग',
  kilo: 'किलो',
  kg: 'किलो',
  gram: 'ग्रॅम',
  gm: 'ग्रॅम',
  litre: 'लिटर',
  liter: 'लिटर',
  ltr: 'लिटर',
  ml: 'मिली',
  pouch: 'पाऊच',
  packet: 'पॅकेट',
  bottle: 'बाटली',
  dabba: 'डबा',
  box: 'बॉक्स',
  bag: 'बॅग',
  agarbatti: 'अगरबत्ती',
  dhoop: 'धूप',
  kapoor: 'कापूर',
  egg: 'अंडे',
  eggs: 'अंडी',

  // Common Brands
  parle: 'पारले',
  'parle g': 'पारले जी',
  britannia: 'ब्रिटानिया',
  'good day': 'गुड डे',
  'marie gold': 'मारी गोल्ड',
  bourbon: 'बर्बन',
  monaco: 'मोनाको',
  krackjack: 'क्रॅकजॅक',
  'hide and seek': 'हाइड अँड सीक',
  oreo: 'ओरियो',
  'dark fantasy': 'डार्क फॅन्टसी',
  amul: 'अमूल',
  'amul butter': 'अमूल बटर',
  'amul milk': 'अमूल दूध',
  'amul cheese': 'अमूल चीज',
  'amul ghee': 'अमूल तूप',
  'amul paneer': 'अमूल पनीर',
  haldiram: 'हल्दीराम',
  haldirams: 'हल्दीराम',
  balaji: 'बालाजी',
  patanjali: 'पतंजली',
  tata: 'टाटा',
  'tata salt': 'टाटा मीठ',
  'tata tea': 'टाटा चहा',
  maggi: 'मॅगी',
  yippee: 'यिप्पी',
  everest: 'एव्हरेस्ट',
  mdh: 'एमडीएच',
  suhana: 'सुहाना',
  badshah: 'बादशाह',
  'surf excel': 'सर्फ एक्सेल',
  ariel: 'एरियल',
  tide: 'टाईड',
  rin: 'रिन',
  nirma: 'निरमा',
  ghadi: 'घडी',
  vim: 'व्हिम',
  'vim bar': 'व्हिम बार',
  pril: 'प्रिल',
  exo: 'एक्सो',
  dettol: 'डेटॉल',
  lifebuoy: 'लाइफबॉय',
  lux: 'लक्स',
  santoor: 'संतूर',
  dove: 'डव्ह',
  pears: 'पिअर्स',
  colgate: 'कोलगेट',
  'close up': 'क्लोज अप',
  pepsodent: 'पेप्सोडेंट',
  sensodyne: 'सेन्सोडाइन',
  parachute: 'पॅराशूट',
  bajaj: 'बजाज',
  navratna: 'नवरत्न',
  nivea: 'निव्हिया',
  vaseline: 'व्हॅसलीन',
  bisleri: 'बिसलेरी',
  aquafina: 'अॅक्वाफिना',
  kinley: 'किनले',
  frooti: 'फ्रुटी',
  maaza: 'माझा',
  'coca cola': 'कोका कोला',
  coke: 'कोक',
  pepsi: 'पेप्सी',
  'thums up': 'थम्स अप',
  sprite: 'स्प्राइट',
  fanta: 'फँटा',
  limca: 'लिम्का',
  sting: 'स्टिंग',
  lays: 'लेज',
  kurkure: 'कुरकुरे',
  bingo: 'बिंगो',
  cadbury: 'कॅडबरी',
  'dairy milk': 'डेअरी मिल्क',
  kitkat: 'किटकेट',
  '5 star': '५ स्टार',
  perk: 'पर्क',
  munch: 'मंच',
  shree: 'श्री',
  om: 'ॐ',
  swami: 'स्वामी',
};

const CONSONANTS: Array<{ en: string; mr: string }> = [
  { en: 'dny', mr: 'ज्ञ' },
  { en: 'jny', mr: 'ज्ञ' },
  { en: 'gya', mr: 'ज्ञा' },
  { en: 'gy', mr: 'ज्ञ' },
  { en: 'ksha', mr: 'क्षा' },
  { en: 'ksh', mr: 'क्ष' },
  { en: 'shra', mr: 'श्रा' },
  { en: 'shri', mr: 'श्री' },
  { en: 'shree', mr: 'श्री' },
  { en: 'shr', mr: 'श्र' },
  { en: 'tra', mr: 'त्रा' },
  { en: 'tr', mr: 'त्र' },
  { en: 'chh', mr: 'छ' },
  { en: 'shh', mr: 'ष' },
  { en: 'kh', mr: 'ख' },
  { en: 'gh', mr: 'घ' },
  { en: 'ng', mr: 'ङ' },
  { en: 'ch', mr: 'च' },
  { en: 'jh', mr: 'झ' },
  { en: 'th', mr: 'थ' },
  { en: 'dh', mr: 'ध' },
  { en: 'ph', mr: 'फ' },
  { en: 'bh', mr: 'भ' },
  { en: 'sh', mr: 'श' },
  { en: 'wh', mr: 'व' },
  { en: 'ld', mr: 'ळ' },
  { en: 'lh', mr: 'ळ' },
  { en: 'k', mr: 'क' },
  { en: 'g', mr: 'ग' },
  { en: 'c', mr: 'क' },
  { en: 'q', mr: 'क' },
  { en: 'j', mr: 'ज' },
  { en: 'z', mr: 'झ' },
  { en: 't', mr: 'त' },
  { en: 'd', mr: 'द' },
  { en: 'n', mr: 'न' },
  { en: 'p', mr: 'प' },
  { en: 'f', mr: 'फ' },
  { en: 'b', mr: 'ब' },
  { en: 'm', mr: 'म' },
  { en: 'y', mr: 'य' },
  { en: 'r', mr: 'र' },
  { en: 'l', mr: 'ल' },
  { en: 'v', mr: 'व' },
  { en: 'w', mr: 'व' },
  { en: 's', mr: 'स' },
  { en: 'h', mr: 'ह' },
  { en: 'x', mr: 'क्स' },
];

const VOWELS: Array<{ en: string; ind: string; matra: string }> = [
  { en: 'aau', ind: 'औ', matra: 'ौ' },
  { en: 'aai', ind: 'आई', matra: 'ाई' },
  { en: 'aa', ind: 'आ', matra: 'ा' },
  { en: 'ee', ind: 'ई', matra: 'ी' },
  { en: 'oo', ind: 'ऊ', matra: 'ू' },
  { en: 'ai', ind: 'ऐ', matra: 'ै' },
  { en: 'au', ind: 'औ', matra: 'ौ' },
  { en: 'ou', ind: 'औ', matra: 'ौ' },
  { en: 'ea', ind: 'ई', matra: 'ी' },
  { en: 'ei', ind: 'ऐ', matra: 'ै' },
  { en: 'ae', ind: 'ॲ', matra: 'ॅ' },
  { en: 'aw', ind: 'ऑ', matra: 'ॉ' },
  { en: 'a', ind: 'अ', matra: '' },
  { en: 'i', ind: 'इ', matra: 'ि' },
  { en: 'u', ind: 'उ', matra: 'ु' },
  { en: 'e', ind: 'ए', matra: 'े' },
  { en: 'o', ind: 'ओ', matra: 'ो' },
];

/** Convert a single Latin word to Marathi Devanagari using dictionary + rules. */
export function transliterateWord(rawWord: string): string {
  if (!rawWord) return '';
  if (hasDevanagari(rawWord)) return rawWord;

  const word = rawWord.trim().toLowerCase();
  if (PHONETIC_RETAIL_MAP[word]) {
    return PHONETIC_RETAIL_MAP[word];
  }

  // Handle single letters: e.g. "g" -> "जी" (as in Parle G)
  if (word === 'g') return 'जी';
  if (word === 't') return 'टी';
  if (word === 'a') return 'ए';
  if (word === 'b') return 'बी';
  if (word === 'c') return 'सी';
  if (word === 'd') return 'डी';

  let out = '';
  let i = 0;
  let prevWasConsonant = false;

  while (i < word.length) {
    // Anusvara: 'n' or 'm' before a consonant
    if ((word[i] === 'n' || word[i] === 'm') && prevWasConsonant && i + 1 < word.length) {
      const isNextCons = CONSONANTS.some((c) => word.startsWith(c.en, i + 1));
      const isNextVowel = VOWELS.some((v) => word.startsWith(v.en, i + 1));
      if (isNextCons && !isNextVowel) {
        out += 'ं';
        prevWasConsonant = false;
        i++;
        continue;
      }
    }

    // Match vowels
    let matchedVowel: (typeof VOWELS)[0] | null = null;
    let vLen = 0;
    for (const v of VOWELS) {
      if (word.startsWith(v.en, i)) {
        matchedVowel = v;
        vLen = v.en.length;
        break;
      }
    }

    if (matchedVowel) {
      if (prevWasConsonant) {
        // Single 'a' at the very end of word acts as 'ा' (kanda -> कांदा, batata -> बटाटा)
        if (matchedVowel.en === 'a' && i + 1 === word.length) {
          out += 'ा';
        } else {
          out += matchedVowel.matra;
        }
      } else {
        out += matchedVowel.ind;
      }
      prevWasConsonant = false;
      i += vLen;
      continue;
    }

    // Match consonants
    let matchedCons: (typeof CONSONANTS)[0] | null = null;
    let cLen = 0;
    for (const c of CONSONANTS) {
      if (word.startsWith(c.en, i)) {
        matchedCons = c;
        cLen = c.en.length;
        break;
      }
    }

    if (matchedCons) {
      if (prevWasConsonant) {
        out += '्';
      }
      out += matchedCons.mr;
      prevWasConsonant = true;
      i += cLen;
      continue;
    }

    // Non-alphabet characters
    prevWasConsonant = false;
    out += word[i];
    i++;
  }

  return out;
}

/**
 * Transliterates full text preserving whitespace, punctuation, digits, and existing Devanagari.
 */
export function transliterateText(text: string): string {
  if (!text) return '';
  if (!containsLatin(text)) return text;

  // Check multi-word dictionary hits first
  const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (PHONETIC_RETAIL_MAP[norm]) {
    return PHONETIC_RETAIL_MAP[norm];
  }

  // Tokenize into words, numbers with units (e.g. 500g, 1kg), and delimiters
  const tokens = text.split(/([a-zA-Z]+|\d+[a-zA-Z]+|\s+|[^a-zA-Z\d\s]+)/).filter(Boolean);
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token) || /^[^\w\s]+$/.test(token)) return token;
      if (/^\d+$/.test(token)) return token;

      // Handle numbers with units: e.g. 500g -> 500 ग्रॅम, 1kg -> 1 किलो, 250ml -> 250 मिली
      const unitMatch = token.match(/^(\d+)([a-zA-Z]+)$/);
      if (unitMatch) {
        const [, num, unit] = unitMatch;
        const u = unit.toLowerCase();
        const unitMr = PHONETIC_RETAIL_MAP[u] || transliterateWord(u);
        return `${num} ${unitMr}`;
      }

      if (containsLatin(token)) {
        return transliterateWord(token);
      }
      return token;
    })
    .join('');
}

/**
 * Transliteration while typing in Marathi fields:
 * - When the user types a space / punctuation (word boundary), the completed word is transliterated.
 * - Leaves untouched if already Devanagari.
 */
export function transliterateWhileTyping(currentText: string): { text: string; changed: boolean } {
  if (!currentText || !containsLatin(currentText)) {
    return { text: currentText, changed: false };
  }

  // If text ends with a space or word boundary, transliterate words preceding the boundary
  if (/[\s,.!?;:\n]$/.test(currentText)) {
    const trailingWhitespace = currentText.match(/[\s,.!?;:\n]+$/)?.[0] || '';
    const body = currentText.slice(0, currentText.length - trailingWhitespace.length);
    const convertedBody = transliterateText(body);
    const next = convertedBody + trailingWhitespace;
    return { text: next, changed: next !== currentText };
  }

  return { text: currentText, changed: false };
}

/**
 * Online transliteration via Google Input Tools API (mr-t-i0-und).
 * Fallback to offline rule-based transliteration on error or timeout.
 */
export async function transliterateOnline(text: string): Promise<string | null> {
  const query = text.trim();
  if (!query || !containsLatin(query)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(query)}&itc=mr-t-i0-und&num=1`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as [string, Array<[string, string[]]>];
    if (data && data[0] === 'SUCCESS' && data[1]?.[0]?.[1]?.[0]) {
      const candidate = String(data[1][0][1][0]).trim();
      if (hasDevanagari(candidate)) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}
