import { transliterateWord, hasDevanagari } from './marathiTransliterate';

/**
 * Instant offline EN → MR for common shop / product words, categories, brands, and units.
 * Works 100% offline.
 */
export const MARATHI_GLOSSARY: Record<string, string> = {
  // Shop / settings / general
  shop: 'दुकान',
  store: 'स्टोअर',
  market: 'बाजार',
  supermarket: 'सुपरमार्केट',
  kirana: 'किराणा',
  grocery: 'किराणा',
  groceries: 'किराणा सामान',
  address: 'पत्ता',
  road: 'रोड',
  street: 'रस्ता',
  colony: 'कॉलनी',
  nagar: 'नगर',
  city: 'शहर',
  village: 'गाव',
  taluka: 'तालुका',
  district: 'जिल्हा',
  maharashtra: 'महाराष्ट्र',
  pune: 'पुणे',
  mumbai: 'मुंबई',
  nagpur: 'नागपूर',
  nashik: 'नाशिक',
  aurangabad: 'औरंगाबाद',
  kolhapur: 'कोल्हापूर',
  satara: 'सातारा',
  sangli: 'सांगली',
  solapur: 'सोलापूर',
  customer: 'ग्राहक',
  supplier: 'पुरवठादार',
  bill: 'बिल',
  invoice: 'बिल',
  price: 'किंमत',
  mrp: 'एमआरपी',
  cost: 'खरेदी किंमत',
  rate: 'दर',
  discount: 'सूट',
  total: 'एकूण',
  stock: 'साठा',
  quantity: 'प्रमाण',
  payment: 'पेमेंट',
  cash: 'रोख',

  // Retail & Product Management
  test: 'नमुना',
  tests: 'नमुने',
  product: 'उत्पादन',
  products: 'उत्पादने',
  'test product': 'नमुना उत्पादन',
  'test products': 'नमुना उत्पादने',
  sample: 'नमुना',
  samples: 'नमुने',
  'sample product': 'नमुना उत्पादन',
  'sample products': 'नमुना उत्पादने',
  trial: 'नमुना',
  demo: 'डेमो',
  item: 'वस्तू',
  items: 'वस्तू',
  'test item': 'नमुना वस्तू',
  'test items': 'नमुना वस्तू',
  'sample item': 'नमुना वस्तू',
  'sample items': 'नमुना वस्तू',
  goods: 'माल',
  commodity: 'वस्तू',
  brand: 'ब्रँड',
  brands: 'ब्रँड',
  category: 'प्रकार',
  categories: 'प्रकार',
  variant: 'प्रकार',
  variants: 'प्रकार',
  unit: 'एकक',
  units: 'एकके',
  piece: 'नग',
  pieces: 'नग',
  qty: 'प्रमाण',
  barcode: 'बारकोड',
  sku: 'एसकेयू',
  hsn: 'एचएसएन',
  batch: 'बॅच',
  sale: 'विक्री',
  sales: 'विक्री',
  selling: 'विक्री',
  purchase: 'खरेदी',
  purchases: 'खरेदी',
  order: 'ऑर्डर',
  orders: 'ऑर्डर',
  bills: 'बिले',
  receipt: 'पावती',
  subtotal: 'उप-एकूण',
  tax: 'कर',
  gst: 'जीएसटी',
  customers: 'ग्राहक',
  suppliers: 'पुरवठादार',
  vendor: 'विक्रेता',
  inventory: 'साठा',

  // Categories / departments
  food: 'अन्न',
  foods: 'अन्नपदार्थ',
  snacks: 'स्नॅक्स',
  beverages: 'पेये',
  drinks: 'पेये',
  'cold drinks': 'शीतपेये',
  'soft drinks': 'शीतपेये',
  dairy: 'दुग्धजन्य',
  'dairy products': 'दुग्धजन्य पदार्थ',
  bakery: 'बेकरी',
  personal: 'वैयक्तिक',
  care: 'काळजी',
  'personal care': 'वैयक्तिक काळजी',
  household: 'घरगुती',
  'household items': 'घरगुती वस्तू',
  'home care': 'घरगुती काळजी',
  cleaning: 'स्वच्छता',
  stationery: 'स्टेशनरी',
  electronics: 'इलेक्ट्रॉनिक्स',
  electricals: 'इलेक्ट्रिकल्स',
  hardware: 'हार्डवेअर',
  clothing: 'कपडे',
  clothes: 'कपडे',
  garments: 'कपडे',
  footwear: 'पादत्राणे',
  cosmetics: 'सौंदर्य प्रसाधने',
  plastic: 'प्लॅस्टिक',
  gifting: 'भेटवस्तू',
  toys: 'खेळणी',
  kids: 'मुले',
  baby: 'बाळ',
  pet: 'पाळीव',
  general: 'सामान्य',
  others: 'इतर',
  other: 'इतर',
  packing: 'पॅकिंग',
  wholesale: 'घाऊक',
  retail: 'किरकोळ',
  spices: 'मसाले',
  condiments: 'मसाले',
  staples: 'धान्य आणि कडधान्ये',
  grains: 'धान्य',
  pulses: 'कडधान्ये',
  dryfruits: 'सुकामेवा',
  'dry fruits': 'सुकामेवा',
  sweets: 'मिठाई',
  confectionery: 'गोडधोड',
  puja: 'पूजा',
  'puja items': 'पूजेचे साहित्य',

  // Staples & Groceries
  rice: 'तांदूळ',
  wheat: 'गहू',
  flour: 'पीठ',
  atta: 'आटा',
  'wheat flour': 'गव्हाचे पीठ',
  maida: 'मैदा',
  besan: 'बेसन',
  sooji: 'रवा',
  suji: 'रवा',
  rava: 'रवा',
  poha: 'पोहे',
  pohe: 'पोहे',
  sabudana: 'साबुदाणा',
  sugar: 'साखर',
  jaggery: 'गूळ',
  salt: 'मीठ',
  oil: 'तेल',
  'cooking oil': 'खाद्यतेल',
  'edible oil': 'खाद्यतेल',
  'sunflower oil': 'सूर्यफूल तेल',
  'groundnut oil': 'शेंगदाणा तेल',
  'mustard oil': 'मोहरीचे तेल',
  'soybean oil': 'सोयाबीन तेल',
  'coconut oil': 'खोबरेल तेल',
  ghee: 'तूप',
  'cow ghee': 'गाईचे तूप',
  butter: 'लोणी',
  milk: 'दूध',
  curd: 'दही',
  yogurt: 'दही',
  paneer: 'पनीर',
  cheese: 'चीज',
  cream: 'क्रिम',
  egg: 'अंडे',
  eggs: 'अंडी',
  bread: 'ब्रेड',
  toast: 'टोस्ट',
  khari: 'खारी',
  bun: 'बन',
  pav: 'पाव',
  cake: 'केक',
  pastry: 'पेस्ट्री',
  biscuit: 'बिस्किट',
  biscuits: 'बिस्किटे',
  cookie: 'कुकी',
  cookies: 'कुकीज',
  chocolate: 'चॉकलेट',
  tea: 'चहा',
  'tea powder': 'चहा पावडर',
  coffee: 'कॉफी',
  water: 'पाणी',
  'mineral water': 'मिनरल वॉटर',
  juice: 'ज्यूस',
  soda: 'सोडा',

  // Dal & Pulses
  dal: 'डाळ',
  daal: 'डाळ',
  lentils: 'डाळी',
  toor: 'तूर',
  'toor dal': 'तूर डाळ',
  tur: 'तूर',
  'tur dal': 'तूर डाळ',
  moong: 'मूग',
  'moong dal': 'मूग डाळ',
  urad: 'उडीद',
  'urad dal': 'उडीद डाळ',
  chana: 'चना',
  'chana dal': 'चना डाळ',
  masoor: 'मसूर',
  'masoor dal': 'मसूर डाळ',
  chickpea: 'हरभरा',
  chickpeas: 'हरभरे',
  rajma: 'राजमा',
  chole: 'छोले',
  matki: 'मटकी',
  watana: 'वटाणा',
  peas: 'मटार',

  // Spices & Condiments
  spice: 'मसाला',
  masala: 'मसाला',
  'garam masala': 'गरम मसाला',
  turmeric: 'हळद',
  'turmeric powder': 'हळद पावडर',
  halad: 'हळद',
  chilli: 'मिरची',
  chili: 'मिरची',
  'red chilli': 'लाल मिरची',
  'chilli powder': 'मिरची पावडर',
  cumin: 'जिरे',
  jeera: 'जिरे',
  mustard: 'मोहरी',
  mohari: 'मोहरी',
  coriander: 'धणे',
  dhane: 'धणे',
  'coriander powder': 'धणे पावडर',
  kothimbir: 'कोथिंबीर',
  garlic: 'लसूण',
  lasun: 'लसूण',
  ginger: 'आले',
  aale: 'आले',
  hing: 'हिंग',
  asafetida: 'हिंग',
  clove: 'लवंग',
  lavang: 'लवंग',
  cinnamon: 'दालचिनी',
  dalchini: 'दालचिनी',
  cardamom: 'वेलची',
  elaichi: 'वेलची',
  blackpepper: 'काळी मिरी',
  pepper: 'मिरी',

  // Vegetables & Fruits
  onion: 'कांदा',
  onions: 'कांदे',
  potato: 'बटाटा',
  potatoes: 'बटाटे',
  tomato: 'टोमॅटो',
  tomatoes: 'टोमॅटो',
  lemon: 'लिंबू',
  lemons: 'लिंबू',
  fruit: 'फळ',
  fruits: 'फळे',
  vegetable: 'भाजी',
  vegetables: 'भाज्या',
  banana: 'केळी',
  bananas: 'केळी',
  apple: 'सफरचंद',
  apples: 'सफरचंद',
  mango: 'आंबा',
  mangoes: 'आंबे',
  orange: 'संत्रे',
  oranges: 'संत्री',
  grapes: 'द्राक्षे',
  coconut: 'नारळ',
  coconuts: 'नारळ',
  pomegranate: 'डाळिंब',
  papaya: 'पपई',
  watermelon: 'कलिंगड',
  spinach: 'पालक',
  methi: 'मेथी',
  fenugreek: 'मेथी',
  brinjal: 'वांगी',
  carrot: 'गाजर',
  cabbage: 'कोबी',
  cauliflower: 'फ्लॉवर',
  cucumber: 'काकडी',

  // Nuts & Dry Fruits
  groundnut: 'शेंगदाणे',
  peanut: 'शेंगदाणे',
  peanuts: 'शेंगदाणे',
  almond: 'बदाम',
  almonds: 'बदाम',
  cashew: 'काजू',
  cashews: 'काजू',
  pista: 'पिस्ता',
  raisin: 'मनुका',
  raisins: 'मनुका',
  walnut: 'अक्रोड',
  makhana: 'मखाना',

  // Snacks & Ready Foods
  namkeen: 'नमकीन',
  farsan: 'फरसाण',
  chivda: 'चिवडा',
  sev: 'शेव',
  shev: 'शेव',
  bhujia: 'भुजिया',
  chakli: 'चकली',
  wafers: 'वेफर्स',
  chips: 'चिप्स',
  noodles: 'नुडल्स',
  sauce: 'सॉस',
  ketchup: 'केचप',
  jam: 'जॅम',
  pickle: 'लोणचे',
  papad: 'पापड',

  // Cleaning & Personal Care
  soap: 'साबण',
  shampoo: 'शॅम्पू',
  conditioner: 'कंडिशनर',
  toothpaste: 'टूथपेस्ट',
  toothbrush: 'टूथब्रश',
  detergent: 'डिटर्जंट',
  'washing powder': 'डिटर्जंट पावडर',
  'dishwash bar': 'भांडी घासण्याचा साबण',
  'dishwash liquid': 'डिशवॉश लिक्विड',
  handwash: 'हँडवॉश',
  sanitizer: 'सॅनिटायझर',
  harpic: 'हार्पिक',
  agarbatti: 'अगरबत्ती',
  dhoop: 'धूप',
  camphor: 'कापूर',
  kapoor: 'कापूर',
  matchbox: 'काडेपेटी',

  // Units
  kg: 'किलो',
  kilo: 'किलो',
  g: 'ग्रॅम',
  gm: 'ग्रॅम',
  gram: 'ग्रॅम',
  grams: 'ग्रॅम',
  litre: 'लिटर',
  liter: 'लिटर',
  ltr: 'लिटर',
  ml: 'मिली',
  piece: 'नग',
  pieces: 'नग',
  dozen: 'डझन',
  packet: 'पॅकेट',
  pack: 'पॅक',
  bottle: 'बाटली',
  bag: 'पिशवी',
  box: 'बॉक्स',
  pouch: 'पाऊच',
  roll: 'रोल',
  set: 'सेट',
  pair: 'जोडी',
  strip: 'पट्टी',
  meter: 'मीटर',

  // Common Brands
  tata: 'टाटा',
  amul: 'अमूल',
  parle: 'पारले',
  'parle g': 'पारले जी',
  britannia: 'ब्रिटानिया',
  haldiram: 'हल्दीराम',
  haldirams: 'हल्दीराम',
  balaji: 'बालाजी',
  patanjali: 'पतंजली',
  maggi: 'मॅगी',
  everest: 'एव्हरेस्ट',
  mdh: 'एमडीएच',
  suhana: 'सुहाना',
  'surf excel': 'सर्फ एक्सेल',
  ariel: 'एरियल',
  tide: 'टाईड',
  rin: 'रिन',
  nirma: 'निरमा',
  vim: 'व्हिम',
  dettol: 'डेटॉल',
  lifebuoy: 'लाइफबॉय',
  lux: 'लक्स',
  santoor: 'संतूर',
  dove: 'डव्ह',
  colgate: 'कोलगेट',
  parachute: 'पॅराशूट',
  bajaj: 'बजाज',
  bisleri: 'बिसलेरी',
  frooti: 'फ्रुटी',
  maaza: 'माझा',
  pepsi: 'पेप्सी',
  'coca cola': 'कोका कोला',
  lays: 'लेज',
  kurkure: 'कुरकुरे',
  cadbury: 'कॅडबरी',

  // Modifiers
  fresh: 'ताजे',
  organic: 'सेंद्रिय',
  premium: 'प्रीमियम',
  special: 'विशेष',
  combo: 'कॉम्बो',
  offer: 'ऑफर',
  new: 'नवीन',
  pure: 'शुद्ध',
  natural: 'नैसर्गिक',
  red: 'लाल',
  green: 'हिरवा',
  yellow: 'पिवळा',
  white: 'पांढरा',
  black: 'काळा',
  gold: 'गोल्ड',
  regular: 'रेग्युलर',
  mini: 'मिनी',
  small: 'लहान',
  medium: 'मध्यम',
  large: 'मोठा',
  and: 'आणि',
  with: 'सह',
};

/**
 * Whole-phrase glossary hit, or multi-word phrase and word-by-word glossary translation.
 * Translates known retail/grocery terms, compound items, and numbers + units offline.
 * Returns null if phrase contains untranslated Latin words so online AI translators
 * or offline models can translate the full phrase without being preempted by transliteration.
 */
export function glossaryTranslate(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const exact = MARATHI_GLOSSARY[lower];
  if (exact) return exact;

  // Split into tokens: words, number+unit tokens, numbers, and delimiters/spaces
  const tokens = trimmed.split(/(\s+|[-_/(),:;]+)/).filter(Boolean);
  if (tokens.length === 0) return null;

  const out: string[] = [];
  let i = 0;
  let hasTranslated = false;
  let hasUnmatchedLatin = false;

  while (i < tokens.length) {
    const token = tokens[i];

    // Delimiters or whitespace
    if (/^[\s\-_/(),:;]+$/.test(token)) {
      out.push(token);
      i++;
      continue;
    }

    // Pure number
    if (/^\d+$/.test(token)) {
      out.push(token);
      i++;
      continue;
    }

    // Already Devanagari
    if (hasDevanagari(token) && !/[a-zA-Z]/.test(token)) {
      out.push(token);
      hasTranslated = true;
      i++;
      continue;
    }

    // Number + unit: e.g. "500g", "1kg", "250ml", "1L"
    const numUnitMatch = token.match(/^(\d+)([a-zA-Z]+)$/);
    if (numUnitMatch) {
      const [, num, unit] = numUnitMatch;
      const unitLower = unit.toLowerCase();
      const unitMr = MARATHI_GLOSSARY[unitLower];
      if (unitMr) {
        out.push(`${num} ${unitMr}`);
        hasTranslated = true;
        i++;
        continue;
      }
    }

    // Check 3-word phrase: tokens[i] + ' ' + tokens[i+2] + ' ' + tokens[i+4]
    if (
      i + 4 < tokens.length &&
      /^\s+$/.test(tokens[i + 1]) &&
      /^\s+$/.test(tokens[i + 3])
    ) {
      const phrase3 = `${tokens[i]} ${tokens[i + 2]} ${tokens[i + 4]}`.toLowerCase();
      const match3 = MARATHI_GLOSSARY[phrase3];
      if (match3) {
        out.push(match3);
        hasTranslated = true;
        i += 5;
        continue;
      }
    }

    // Check 2-word phrase: tokens[i] + ' ' + tokens[i+2]
    if (i + 2 < tokens.length && /^\s+$/.test(tokens[i + 1])) {
      const phrase2 = `${tokens[i]} ${tokens[i + 2]}`.toLowerCase();
      const match2 = MARATHI_GLOSSARY[phrase2];
      if (match2) {
        out.push(match2);
        hasTranslated = true;
        i += 3;
        continue;
      }
    }

    // Single word match in MARATHI_GLOSSARY
    const single = MARATHI_GLOSSARY[token.toLowerCase()];
    if (single) {
      out.push(single);
      hasTranslated = true;
      i++;
      continue;
    }

    // If token has Latin characters and was not found in glossary
    if (/[a-zA-Z]/.test(token)) {
      hasUnmatchedLatin = true;
      out.push(token);
      i++;
      continue;
    }

    out.push(token);
    i++;
  }

  // If all Latin words were matched in the glossary and at least one was translated:
  if (hasTranslated && !hasUnmatchedLatin) {
    const result = out.join('');
    if (hasDevanagari(result)) return result;
  }

  return null;
}
