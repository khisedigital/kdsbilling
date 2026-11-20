/**
 * Instant offline EN → MR for common shop / product words.
 * Used before the Paar model or online API so typing feels instant.
 */
export const MARATHI_GLOSSARY: Record<string, string> = {
  // Shop / settings
  shop: 'दुकान',
  store: 'स्टोअर',
  market: 'बाजार',
  supermarket: 'सुपरमार्केट',
  kirana: 'किराणा',
  grocery: 'किराणा',
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

  // Categories / brands (generic)
  food: 'अन्न',
  foods: 'अन्नपदार्थ',
  snacks: 'स्नॅक्स',
  beverages: 'पेये',
  drinks: 'पेये',
  dairy: 'दुग्धजन्य',
  bakery: 'बेकरी',
  personal: 'वैयक्तिक',
  care: 'काळजी',
  household: 'घरगुती',
  cleaning: 'स्वच्छता',
  stationery: 'स्टेशनरी',
  electronics: 'इलेक्ट्रॉनिक्स',
  clothing: 'कपडे',
  clothes: 'कपडे',
  kids: 'मुले',
  baby: 'बाळ',
  pet: 'पाळीव',
  general: 'सामान्य',
  others: 'इतर',
  other: 'इतर',
  packing: 'पॅकिंग',
  wholesale: 'घाऊक',
  retail: 'किरकोळ',

  // Staples
  rice: 'तांदूळ',
  wheat: 'गहू',
  flour: 'पीठ',
  atta: 'आटा',
  sugar: 'साखर',
  salt: 'मीठ',
  oil: 'तेल',
  ghee: 'तूप',
  butter: 'लोणी',
  milk: 'दूध',
  curd: 'दही',
  yogurt: 'दही',
  paneer: 'पनीर',
  cheese: 'चीज',
  egg: 'अंडे',
  eggs: 'अंडी',
  bread: 'ब्रेड',
  biscuit: 'बिस्किट',
  biscuits: 'बिस्किटे',
  chocolate: 'चॉकलेट',
  tea: 'चहा',
  coffee: 'कॉफी',
  water: 'पाणी',
  juice: 'ज्यूस',
  soda: 'सोडा',
  soap: 'साबण',
  shampoo: 'शॅम्पू',
  toothpaste: 'टूथपेस्ट',
  detergent: 'डिटर्जंट',
  spice: 'मसाला',
  spices: 'मसाले',
  chilli: 'मिरची',
  chili: 'मिरची',
  turmeric: 'हळद',
  cumin: 'जिरे',
  coriander: 'कोथिंबीर',
  onion: 'कांदा',
  onions: 'कांदे',
  potato: 'बटाटा',
  potatoes: 'बटाटे',
  tomato: 'टोमॅटो',
  tomatoes: 'टोमॅटो',
  garlic: 'लसूण',
  ginger: 'आले',
  lemon: 'लिंबू',
  fruit: 'फळ',
  fruits: 'फळे',
  vegetable: 'भाजी',
  vegetables: 'भाज्या',
  banana: 'केळी',
  apple: 'सफरचंद',
  mango: 'आंबा',
  orange: 'संत्रे',
  grapes: 'द्राक्षे',
  coconut: 'नारळ',
  groundnut: 'शेंगदाणे',
  peanut: 'शेंगदाणे',
  almond: 'बदाम',
  cashew: 'काजू',
  dal: 'डाळ',
  lentils: 'डाळी',
  chickpea: 'हरभरा',
  toor: 'तूर',
  moong: 'मूग',
  urad: 'उडीद',
  basmati: 'बासमती',
  refined: 'रिफाइंड',
  mustard: 'मोहरी',
  coconut_oil: 'नारळ तेल',
  sunflower: 'सूर्यफूल',
  packet: 'पॅकेट',
  pack: 'पॅक',
  bottle: 'बाटली',
  bag: 'पिशवी',
  box: 'बॉक्स',
  kg: 'किलो',
  g: 'ग्रॅम',
  gram: 'ग्रॅम',
  grams: 'ग्रॅम',
  litre: 'लिटर',
  liter: 'लिटर',
  ml: 'मिली',
  piece: 'नग',
  pieces: 'नग',
  dozen: 'डझन',
  fresh: 'ताजे',
  organic: 'सेंद्रिय',
  premium: 'प्रीमियम',
  special: 'विशेष',
  combo: 'कॉम्बो',
  offer: 'ऑफर',
  new: 'नवीन',
};

/** Whole-phrase glossary hit, or word-by-word for short product labels. */
export function glossaryTranslate(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const exact = MARATHI_GLOSSARY[trimmed.toLowerCase()];
  if (exact) return exact;

  const parts = trimmed.split(/(\s+|[-_/])/);
  let hit = 0;
  let total = 0;
  const out = parts.map((part) => {
    if (!part || /^[\s\-_/]+$/.test(part) || /^\d/.test(part)) return part;
    total += 1;
    const word = MARATHI_GLOSSARY[part.toLowerCase()];
    if (word) {
      hit += 1;
      return word;
    }
    return part;
  });
  if (total > 0 && hit / total >= 0.7) return out.join('');
  return null;
}
