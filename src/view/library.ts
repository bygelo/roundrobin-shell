// The form and document views.
//
// Paired for the same reason gate.ts pairs membership and access: they are the
// two packs an operator reaches for when the question is "what did we write
// down", and they share the one idea that matters here — **a version is a fact,
// and facts are not edited.** Form freezes a version at answer time so a
// template edit cannot move an already-scored result; document keeps an
// immutable version chain so a re-issued statement does not rewrite the one
// already sent. Two packs, one discipline, one place to get it right.
//
// Both shipped without a collection read, so neither screen could be started
// until `GET /api/v1/form/template`, `/form/instance`, and `/document` existed.

import type { ShellClient, Session } from '../discovery.ts'

export type FormTemplate = {
  form_template_id: string
  form_template_code: string
  kind: string
  title: string
  description: string | null
  status: string
}

export type FormInstance = {
  form_instance_id: string
  form_template_id: string
  form_version_id: string
  title: string
  state: string
  open_at: string | null
  close_at: string | null
}

export type DocumentRecord = {
  document_id: string
  document_code: string
  title: string
  kind: string
  current_version_id: string | null
}

export type DocumentVersion = {
  document_version_id: string
  document_id: string
  parent_version_id: string | null
  version_ordinal: number
  is_current: boolean
  note: string | null
  content_sha256: string
  storage_key: string
  mime_type: string
  byte_size: number
  origin: string
}

export type LibraryApi = {
  listTemplate: (session: Session, filter?: { kind?: string }) => Promise<FormTemplate[]>
  listInstance: (session: Session, filter?: { form_template_id?: string }) => Promise<FormInstance[]>
  listDocument: (session: Session, filter?: { kind?: string }) => Promise<DocumentRecord[]>
}

export function createLibraryApi(client: ShellClient): LibraryApi {
  return {
    listTemplate: async (session, filter) =>
      (
        await client.get<{ form_template: FormTemplate[] }>(session, '/api/v1/form/template', {
          kind: filter?.kind,
        })
      ).form_template,

    listInstance: async (session, filter) =>
      (
        await client.get<{ form_instance: FormInstance[] }>(session, '/api/v1/form/instance', {
          form_template_id: filter?.form_template_id,
        })
      ).form_instance,

    listDocument: async (session, filter) =>
      (
        await client.get<{ document: DocumentRecord[] }>(session, '/api/v1/document', {
          kind: filter?.kind,
        })
      ).document,
  }
}

// ---------------------------------------------------------------------------
// the pure part
// ---------------------------------------------------------------------------

/**
 * Can somebody answer this instance right now?
 *
 * State AND the window, because they disagree in a way that matters: an
 * instance can be `open` and still outside its dates, and a screen that offered
 * a form nobody may submit would collect answers the pack will refuse.
 *
 * `now` is a parameter so a list is judged against one instant and a test does
 * not have to wait.
 */
export function isInstanceAnswerable(instance: FormInstance, now: Date): boolean {
  if (instance.state !== 'open') return false
  const at = now.getTime()
  if (instance.open_at && at < new Date(instance.open_at).getTime()) return false
  if (instance.close_at && at > new Date(instance.close_at).getTime()) return false
  return true
}

/** Why an instance is not answerable, in words rather than a state code. */
export function describeInstance(instance: FormInstance, now: Date): string {
  if (isInstanceAnswerable(instance, now)) return 'open for response'
  if (instance.state === 'draft') return 'not published yet'
  if (instance.state === 'closed') return 'closed'
  const at = now.getTime()
  if (instance.open_at && at < new Date(instance.open_at).getTime()) return 'opens later'
  if (instance.close_at && at > new Date(instance.close_at).getTime()) return 'the window has passed'
  return instance.state
}

/**
 * A byte count a person reads.
 *
 * Binary units, because a file listing that disagrees with the operating
 * system's own figure invites a bug report about the wrong thing.
 */
export function formatByte(byte_size: number): string {
  if (byte_size < 1024) return `${byte_size} B`
  const unit = ['KiB', 'MiB', 'GiB']
  let value = byte_size / 1024
  let index = 0
  while (value >= 1024 && index < unit.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit[index]}`
}

/** A short, recognisable slice of a content hash — enough to compare by eye. */
export function shortHash(content_sha256: string): string {
  return content_sha256.slice(0, 12)
}

/**
 * Newest version first, with the current one identifiable.
 *
 * The chain is immutable and `is_current` is the pack's own answer; this never
 * infers it from the ordinal, because a reverted document has a current version
 * that is NOT the highest ordinal, and guessing would mislabel exactly the case
 * somebody is looking at the history to understand.
 */
export function orderVersion(version: DocumentVersion[]): DocumentVersion[] {
  return [...version].sort((left, right) => right.version_ordinal - left.version_ordinal)
}

export type LibraryTally = {
  template_count: number
  answerable_count: number
  document_count: number
}

export function tallyLibrary(
  template: FormTemplate[],
  instance: FormInstance[],
  document: DocumentRecord[],
  now: Date,
): LibraryTally {
  return {
    template_count: template.length,
    answerable_count: instance.filter((one) => isInstanceAnswerable(one, now)).length,
    document_count: document.length,
  }
}
