// A tiny translator: no dependency, so the viewer stays one self-contained file.
// To add a language: copy en.ts to <code>.ts, translate it, and list it in CATALOGS and LOCALES below.

import { en, type Catalog, type Message, type MessageKey } from './en.js';
import { cs } from './cs.js';
import { da } from './da.js';
import { de } from './de.js';
import { es } from './es.js';
import { fi } from './fi.js';
import { fr } from './fr.js';
import { nb } from './nb.js';
import { pl } from './pl.js';
import { sk } from './sk.js';
import { sv } from './sv.js';

export type { Catalog, Message, MessageKey, PluralMessage } from './en.js';

export const CATALOGS = { en, cs, da, de, es, fi, fr, nb, pl, sk, sv } satisfies Record<string, Catalog>;

export type Locale = keyof typeof CATALOGS;

/** Every locale with its name in its own language, for language pickers. */
export const LOCALES: { code: Locale; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'cs', name: 'Čeština' },
  { code: 'da', name: 'Dansk' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'nb', name: 'Norsk bokmål' },
  { code: 'pl', name: 'Polski' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'fi', name: 'Suomi' },
  { code: 'sv', name: 'Svenska' },
];

export type MessageParams = Record<string, string | number>;

/** A message to show later, in whatever locale the viewer picks. */
export interface MessageRef {
  code: MessageKey;
  params?: MessageParams;
}

const ALIASES: Record<string, Locale> = { no: 'nb', nn: 'nb' };

/** The supported locale closest to a BCP 47 tag such as `fr-CA`, `nb_NO` or `no`; English when there is none. */
export function resolveLocale(tag: string | null | undefined): Locale {
  const lower = (tag ?? '').trim().toLowerCase().replace(/_/g, '-');
  const base = lower.split('-')[0];
  for (const t of [lower, base]) {
    if (t in CATALOGS) return t as Locale;
    if (t in ALIASES) return ALIASES[t];
  }
  return 'en';
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralRule(locale: Locale) {
  let r = pluralRules.get(locale);
  if (!r) pluralRules.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
}

/** The message `key` in `locale`, with `{placeholders}` filled from `params`; plural messages pick their form by `params.n`. */
export function t(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const catalog: Catalog = CATALOGS[locale] ?? en;
  const m: Message = catalog[key] ?? en[key];
  const text = typeof m === 'string' ? m : (m[pluralRule(locale).select(Number(params.n ?? 0))] ?? m.other);
  return text.replace(/\{(\w+)\}/g, (all: string, name: string) => (name in params ? String(params[name]) : all));
}

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export function translator(locale: Locale): Translate {
  return (key, params) => t(locale, key, params);
}

/** A diagnostic (or any MessageRef) in `locale`. */
export function formatMessage(m: MessageRef, locale: Locale): string {
  return t(locale, m.code, m.params);
}

/** A MessageRef plus its English text, for results that carry both. */
export function msg(code: MessageKey, params?: MessageParams): MessageRef & { message: string } {
  return params ? { code, params, message: t('en', code, params) } : { code, message: t('en', code) };
}
