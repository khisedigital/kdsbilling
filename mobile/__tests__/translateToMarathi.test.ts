import { glossaryTranslate, MARATHI_GLOSSARY } from '../src/i18n/marathiGlossary';

describe('marathi glossary (offline instant)', () => {
  it('covers common retail words', () => {
    expect(MARATHI_GLOSSARY.rice).toBe('तांदूळ');
    expect(MARATHI_GLOSSARY.sugar).toBe('साखर');
    expect(MARATHI_GLOSSARY.milk).toBe('दूध');
    expect(MARATHI_GLOSSARY.onion).toBe('कांदा');
  });

  it('translates exact and multi-word grocery labels offline', () => {
    expect(glossaryTranslate('Rice')).toBe('तांदूळ');
    expect(glossaryTranslate('sugar')).toBe('साखर');
    expect(glossaryTranslate('Fresh Milk')).toBe('ताजे दूध');
  });
});
