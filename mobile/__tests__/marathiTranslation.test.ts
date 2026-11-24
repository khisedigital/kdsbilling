jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import {
  translateToMarathi,
  hasDevanagari,
  transliterateText,
  transliterateWord,
  transliterateWhileTyping,
} from '../src/i18n/translateToMarathi';
import { glossaryTranslate } from '../src/i18n/marathiGlossary';
import { fillMarathiFromEnglish, transliterateMarathiField } from '../src/hooks/useAutoMarathi';

describe('Marathi Translation & Transliteration Engine', () => {
  describe('Offline Glossary', () => {
    it('translates common grocery items offline', () => {
      expect(glossaryTranslate('sugar')).toBe('साखर');
      expect(glossaryTranslate('wheat')).toBe('गहू');
      expect(glossaryTranslate('milk')).toBe('दूध');
      expect(glossaryTranslate('oil')).toBe('तेल');
      expect(glossaryTranslate('tea')).toBe('चहा');
      expect(glossaryTranslate('soap')).toBe('साबण');
      expect(glossaryTranslate('salt')).toBe('मीठ');
    });

    it('translates categories and retail phrases offline', () => {
      expect(glossaryTranslate('Personal Care')).toBe('वैयक्तिक काळजी');
      expect(glossaryTranslate('Cold Drinks')).toBe('शीतपेये');
      expect(glossaryTranslate('Bakery')).toBe('बेकरी');
      expect(glossaryTranslate('Snacks')).toBe('स्नॅक्स');
    });

    it('translates compound items with numbers and units', () => {
      const res = glossaryTranslate('Sugar 1kg');
      expect(res).toBeTruthy();
      expect(res).toContain('साखर');
      expect(res).toContain('1 किलो');
    });

    it('translates Test Product and retail terms correctly to Marathi (not phonetic te-sta)', () => {
      expect(glossaryTranslate('Test Product')).toBe('नमुना उत्पादन');
      expect(glossaryTranslate('test product')).toBe('नमुना उत्पादन');
      expect(glossaryTranslate('Product')).toBe('उत्पादन');
      expect(glossaryTranslate('Products')).toBe('उत्पादने');
      expect(glossaryTranslate('Test')).toBe('नमुना');
      expect(glossaryTranslate('Sample Product')).toBe('नमुना उत्पादन');
      expect(glossaryTranslate('Test Product 500g')).toBe('नमुना उत्पादन 500 ग्रॅम');
    });
  });

  describe('Phonetic Transliteration Engine (Offline Mode)', () => {
    it('transliterates phonetic words to Marathi Devanagari', () => {
      expect(transliterateWord('sakhar')).toBe('साखर');
      expect(transliterateWord('kanda')).toBe('कांदा');
      expect(transliterateWord('batata')).toBe('बटाटा');
      expect(transliterateWord('chaha')).toBe('चहा');
      expect(transliterateWord('doodh')).toBe('दूध');
      expect(transliterateWord('shree')).toBe('श्री');
      expect(transliterateWord('poha')).toBe('पोहे');
      expect(transliterateWord('sabudana')).toBe('साबुदाणा');
    });

    it('transliterates brand names', () => {
      expect(transliterateWord('parle')).toBe('पारले');
      expect(transliterateWord('amul')).toBe('अमूल');
      expect(transliterateWord('haldiram')).toBe('हल्दीराम');
      expect(transliterateWord('balaji')).toBe('बालाजी');
      expect(transliterateWord('patanjali')).toBe('पतंजली');
      expect(transliterateWord('tata')).toBe('टाटा');
    });

    it('transliterates full phrases with numbers and units', () => {
      const result = transliterateText('Amul Butter 500g');
      expect(result).toBeTruthy();
      expect(result).toContain('अमूल');
      expect(result).toContain('500');
      expect(hasDevanagari(result)).toBe(true);
    });

    it('leaves existing Devanagari text intact', () => {
      expect(transliterateText('कांदा बटाटा')).toBe('कांदा बटाटा');
      expect(transliterateText('साखर 1 किलो')).toBe('साखर 1 किलो');
    });
  });

  describe('While-typing Transliteration in Input Fields', () => {
    it('transliterates completed word when space is typed', () => {
      const res = transliterateWhileTyping('kanda ');
      expect(res.changed).toBe(true);
      expect(res.text).toBe('कांदा ');
    });

    it('transliterates second word when space is typed', () => {
      const res = transliterateWhileTyping('कांदा batata ');
      expect(res.changed).toBe(true);
      expect(res.text).toBe('कांदा बटाटा ');
    });

    it('converts test product when typed in Marathi field', () => {
      const res = transliterateWhileTyping('test product ');
      expect(res.changed).toBe(true);
      expect(res.text).toBe('नमुना उत्पादन ');
    });

    it('does not prematurely convert incomplete word while typing without space', () => {
      const res = transliterateWhileTyping('kand');
      expect(res.changed).toBe(false);
      expect(res.text).toBe('kand');
    });

    it('transliterates on blur / field helper', () => {
      expect(transliterateMarathiField('samosa')).toBe('समोसा');
      expect(transliterateMarathiField('haldiram bhujia')).toContain('हल्दीराम');
    });
  });

  describe('Full translateToMarathi Pipeline', () => {
    it('returns translation and source', async () => {
      const res = await translateToMarathi('Sugar');
      expect(res.text).toBe('साखर');
      expect(hasDevanagari(res.text)).toBe(true);
    });

    it('returns Devanagari unchanged', async () => {
      const res = await translateToMarathi('तांदूळ');
      expect(res.text).toBe('तांदूळ');
      expect(res.source).toBe('unchanged');
    });

    it('translates product names for Price Management', async () => {
      const res = await fillMarathiFromEnglish('Tata Tea 250g');
      expect(res).toBeTruthy();
      expect(hasDevanagari(res)).toBe(true);
    });

    it('translates Test Product to नमुना उत्पादन via translateToMarathi and fillMarathiFromEnglish', async () => {
      const res = await translateToMarathi('Test Product');
      expect(res.text).toBe('नमुना उत्पादन');
      expect(res.source).toBe('glossary');

      const filled = await fillMarathiFromEnglish('Test Product');
      expect(filled).toBe('नमुना उत्पादन');
    });
  });
});
