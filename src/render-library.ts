// The node trees for view/form and view/document.
//
// Third render module, same contract as the other two: take an `element`
// factory, return a tree, touch no global, take every side effect as a
// callback.
//
// The decision these screens carry is that a **state code is not a sentence**.
// A form instance sitting at `draft`, or `open` but outside its window, means
// something different to the person looking at it, and the difference decides
// whether they should be handed a link to it.

import type { Element } from './render.ts'
import { renderFailure } from './render.ts'
import type { Failure } from './view/failure.ts'
import type { DocumentRecord, FormInstance, FormTemplate } from './view/library.ts'
import {
  describeInstance,
  isInstanceAnswerable,
  tallyLibrary,
} from './view/library.ts'

export type LibraryState = {
  status: 'loading' | 'ready'
  template: FormTemplate[]
  instance: FormInstance[]
  document: DocumentRecord[]
  failure?: Failure | undefined
  now: Date
}

export type LibraryHandler = {
  onOpenTemplate: (template: FormTemplate) => void
  onBack: () => void
}

/**
 * view/form — what has been written down, and what can still be answered.
 */
export function renderForm(
  element: Element,
  input: { display_name: string; state: LibraryState },
  handler: LibraryHandler,
): unknown[] {
  const { state } = input
  const tally = tallyLibrary(state.template, state.instance, state.document, state.now)

  return [
    element('h2', {}, input.display_name),
    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading form…') : '',

    state.status === 'ready'
      ? element('div', { class: 'summary' }, [
          element('strong', {}, `${tally.template_count}`),
          element('span', { class: 'muted' }, ' form · '),
          element('strong', {}, `${tally.answerable_count}`),
          element('span', { class: 'muted' }, ' open for response'),
        ])
      : '',

    state.status === 'ready' && state.template.length === 0
      ? element('p', { class: 'muted' }, 'No form defined yet.')
      : '',

    state.status === 'ready' && state.template.length > 0
      ? element('div', { class: 'template-list' }, [
          element('h3', {}, 'Form'),
          element(
            'ul',
            { class: 'plain' },
            state.template.map((one) =>
              element('li', { class: 'template' }, [
                element(
                  'button',
                  { class: 'small link', onclick: () => handler.onOpenTemplate(one) },
                  one.title,
                ),
                element('span', { class: 'muted' }, ` ${one.kind} · ${one.status}`),
              ]),
            ),
          ),
        ])
      : '',

    state.status === 'ready' && state.instance.length > 0
      ? element('div', { class: 'instance-list' }, [
          element('h3', {}, 'Round'),
          element(
            'ul',
            { class: 'plain' },
            state.instance.map((one) =>
              element(
                'li',
                {
                  class: isInstanceAnswerable(one, state.now)
                    ? 'instance answerable'
                    : 'instance shut',
                },
                [
                  element('strong', {}, one.title),
                  // A state code is not a sentence, and the difference decides
                  // whether somebody should be handed a link to this.
                  element('span', { class: 'muted' }, ` ${describeInstance(one, state.now)}`),
                ],
              ),
            ),
          ),
        ])
      : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}

/**
 * view/document — the shelf.
 *
 * Metadata only, deliberately, matching the route: `listDocument` never touches
 * the blob store, and `getDocument` stays the one path that reads bytes and
 * checks the audience ACL. A library screen that eagerly fetched content would
 * both hammer storage and route around the only ACL check there is.
 */
export function renderDocument(
  element: Element,
  input: { display_name: string; state: LibraryState },
  handler: { onBack: () => void },
): unknown[] {
  const { state } = input

  return [
    element('h2', {}, input.display_name),
    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading the shelf…') : '',

    state.status === 'ready' && state.document.length === 0
      ? element('p', { class: 'muted' }, 'Nothing filed yet.')
      : '',

    state.status === 'ready' && state.document.length > 0
      ? element('div', { class: 'shelf' }, [
          element('h3', {}, 'Document'),
          element(
            'ul',
            { class: 'plain' },
            state.document.map((one) =>
              element('li', { class: 'document' }, [
                element('strong', {}, one.title),
                element('span', { class: 'muted' }, ` ${one.kind} · ${one.document_code}`),
                // A record with no current version has been created and never
                // filled. Saying so beats a row that looks complete.
                one.current_version_id
                  ? ''
                  : element('span', { class: 'pill' }, 'no content yet'),
              ]),
            ),
          ),
        ])
      : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}
