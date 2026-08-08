// The app's words, over the kernel's nouns.
//
// The OS knows `resource`, `session`, `party`. It has never heard of a court, a
// chair, or a bay, and the two-app law exists to keep it that way. But a clinic
// receptionist should read "chair", not "resource" — so the translation has to
// happen somewhere, and the only correct somewhere is above the API.
//
// This is that layer, and it is deliberately dumb: a lookup with a fallback.
// Anything cleverer (pluralisation rules, inflection, gendered articles) is a
// natural-language library wearing a config file's clothes, and the moment it
// gets one case wrong it is worse than the untranslated noun.

/** One word, in the two forms an interface actually needs. */
export type Word = {
  one: string
  /**
   * The collective form.
   *
   * Named `many` rather than made plural, because the house convention is
   * singular identifiers everywhere — and because in the languages this ships
   * into, the collective is frequently the same string as `one`.
   */
  many: string
}

export type Vocabulary = Record<string, Word>

/**
 * What the OS calls things, used when the app says nothing.
 *
 * These are the kernel and pack nouns verbatim. An app that supplies no
 * vocabulary gets a working, honest, slightly clinical interface rather than a
 * broken one.
 */
export const DEFAULT_VOCABULARY: Vocabulary = {
  resource: { one: 'resource', many: 'resource' },
  session: { one: 'session', many: 'session' },
  booking: { one: 'booking', many: 'booking' },
  party: { one: 'party', many: 'party' },
  invoice: { one: 'invoice', many: 'invoice' },
  payment: { one: 'payment', many: 'payment' },
  site: { one: 'site', many: 'site' },
}

export type Translator = {
  /** One of something: "chair", "court", "bay". */
  one: (noun: string) => string
  /** The collective: "chair", "court", "bay". */
  many: (noun: string) => string
  /** "3 chair" / "1 chair" — count first, because that is how a label reads. */
  count: (noun: string, count_value: number) => string
}

/**
 * Build a translator from the app's overrides.
 *
 * An unknown noun returns itself rather than throwing or rendering an empty
 * string. A missing translation should look like an untranslated interface,
 * which is embarrassing and obvious, rather than like a blank one, which is a
 * bug report about the wrong thing.
 */
export function createTranslator(override: Vocabulary = {}): Translator {
  const table: Vocabulary = { ...DEFAULT_VOCABULARY, ...override }

  const word = (noun: string): Word => table[noun] ?? { one: noun, many: noun }

  return {
    one: (noun) => word(noun).one,
    many: (noun) => word(noun).many,
    count: (noun, count_value) =>
      `${count_value} ${count_value === 1 ? word(noun).one : word(noun).many}`,
  }
}
