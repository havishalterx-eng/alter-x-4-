export const supportedLocales = ["en", "hi"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export interface I18nBundle {
  locale: SupportedLocale;
  namespace: string;
  messages: Record<string, string>;
}

export interface LanguagePreference {
  language: SupportedLocale;
}

export interface I18nBundleRow {
  key: string;
  value: string;
}

interface NullableLanguageRow {
  language: SupportedLocale | null;
}

export type UserLanguageRow = NullableLanguageRow;
export type WorkspaceLanguageRow = NullableLanguageRow;
