import { describe, expect, it } from 'vitest';
import { CATALOGS, LOCALES, buildGraph, formatMessage, parseJenkinsfile, renameError, resolveLocale, t, toMermaid, type Locale, type Message, type MessageKey } from '../src/index.js';

const placeholders = (m: Message) => {
  const forms = typeof m === 'string' ? [m] : Object.values(m);
  return forms.map((f) => [...f!.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(','));
};

describe('catalogs', () => {
  const en = CATALOGS.en;
  const keys = Object.keys(en) as MessageKey[];

  it('lists every catalog in LOCALES', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(Object.keys(CATALOGS).sort());
  });

  for (const locale of Object.keys(CATALOGS) as Locale[]) {
    describe(locale, () => {
      const cat = CATALOGS[locale];

      it('has exactly the English keys', () => {
        expect(Object.keys(cat).sort()).toEqual([...keys].sort());
      });

      it('uses the same placeholders as English', () => {
        for (const k of keys) {
          const want = new Set(placeholders(en[k]));
          for (const got of placeholders(cat[k])) expect({ key: k, got }).toEqual({ key: k, got: [...want][0] });
        }
      });

      it('gives plural messages every form whole numbers need', () => {
        const rules = new Intl.PluralRules(locale);
        const needed = new Set(Array.from({ length: 200 }, (_, n) => rules.select(n)));
        for (const k of keys) {
          const m = cat[k];
          expect({ key: k, plural: typeof m !== 'string' }).toEqual({ key: k, plural: typeof en[k] !== 'string' });
          if (typeof m === 'string') continue;
          for (const form of needed) if (form !== 'other') expect({ key: k, form, has: form in m }).toEqual({ key: k, form, has: true });
        }
      });
    });
  }
});

describe('translator', () => {
  it('fills placeholders and picks plural forms', () => {
    expect(t('en', 'ui.errors', { n: 1 })).toBe('1 error');
    expect(t('en', 'ui.errors', { n: 3 })).toBe('3 errors');
    expect(t('cs', 'ui.errors', { n: 1 })).toBe('1 chyba');
    expect(t('cs', 'ui.errors', { n: 3 })).toBe('3 chyby');
    expect(t('cs', 'ui.errors', { n: 5 })).toBe('5 chyb');
    expect(t('pl', 'ui.stages', { n: 22 })).toBe('22 etapy');
    expect(t('pl', 'ui.stages', { n: 25 })).toBe('25 etapów');
    expect(t('de', 'rename.taken', { name: 'Build' })).toBe("Eine andere Stage heißt bereits 'Build'.");
  });

  it('leaves literal braces alone', () => {
    expect(t('en', 'diag.needsBlock', { name: 'steps' })).toBe('steps needs a { ... } block.');
  });

  it('resolves locale tags', () => {
    expect(resolveLocale('fr-CA')).toBe('fr');
    expect(resolveLocale('nb_NO')).toBe('nb');
    expect(resolveLocale('no')).toBe('nb');
    expect(resolveLocale('nn-NO')).toBe('nb');
    expect(resolveLocale('CS')).toBe('cs');
    expect(resolveLocale('xx')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });
});

describe('localized output', () => {
  const src = `pipeline {
  agent any
  stages {
    stage('A') { steps { echo 'a' } }
    stage('A') { steps { echo 'b' } }
  }
}`;

  it('keeps English diagnostics and formats them in other locales', () => {
    const d = parseJenkinsfile(src).diagnostics.find((x) => x.code === 'diag.duplicateStage')!;
    expect(d.message).toBe("Duplicate stage name 'A'. Stage names must be unique.");
    expect(formatMessage(d, 'cs')).toBe("Duplicitní název fáze 'A'. Názvy fází musí být jedinečné.");
  });

  it('carries codes for lexer and brace issues', () => {
    const d = parseJenkinsfile("pipeline { agent any\n stages { stage('A') { steps { echo 'x } } }").diagnostics;
    expect(d.map((x) => x.code)).toContain('lex.unterminatedString');
  });

  it('labels the diagram in the chosen locale', () => {
    const p = parseJenkinsfile(src).pipeline!;
    const labels = (locale?: Locale) => buildGraph(p, { locale }).nodes.filter((n) => n.kind === 'start' || n.kind === 'end').map((n) => n.label);
    expect(labels()).toEqual(['Start', 'End']);
    expect(labels('cs')).toEqual(['Začátek', 'Konec']);
    expect(labels('de')).toEqual(['Start', 'Ende']);
    expect(buildGraph(p, { locale: 'fi' }).nodes.find((n) => n.stageId)?.badges[0].label).toBe('1 askel');
    expect(toMermaid(p, { locale: 'fr' })).toContain('start((Début))');
  });

  it('localizes rename errors', () => {
    const p = parseJenkinsfile(src.replace("stage('A') { steps { echo 'b' } }", "stage('B') { steps { echo 'b' } }")).pipeline!;
    expect(renameError(p, p.stages[0].id, 'B')).toBe("Another stage is already named 'B'.");
    expect(renameError(p, p.stages[0].id, 'B', 'sv')).toBe("En annan fas heter redan 'B'.");
  });
});
