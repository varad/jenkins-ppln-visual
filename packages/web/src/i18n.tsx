import { createContext, useContext, useMemo } from 'react';
import { resolveLocale, translator, type Locale, type Translate } from '@jpv/core';

export const LocaleContext = createContext<Locale>('en');

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}

const LOCALE_KEY = 'jpv.locale';

/** `?lang=` first, then the viewer's last choice, then the browser's language. */
export function initialLocale(): Locale {
  const param = new URLSearchParams(location.search).get('lang');
  if (param) return resolveLocale(param);
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved) return resolveLocale(saved);
  } catch {
    // Storage can be blocked; fall through to the browser's language.
  }
  return resolveLocale(navigator.language);
}

export function saveLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // The choice then just lasts until reload.
  }
}
