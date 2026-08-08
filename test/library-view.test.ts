// The form and document views — pure half and rendering.
//
// The assertion that earns its keep is that an instance's STATE and its WINDOW
// disagree, and the screen has to respect both. An instance can sit at `open`
// and still be outside its dates; offering it would collect answers the pack
// then refuses, which reads to a respondent as the system losing their work.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from '../src/dom.ts'
import { renderDocument, renderForm, type LibraryState } from '../src/render-library.ts'
import {
  describeInstance,
  formatByte,
  isInstanceAnswerable,
  orderVersion,
  shortHash,

  type DocumentRecord,
  type DocumentVersion,
  type FormInstance,
  type FormTemplate,
} from '../src/view/library.ts'
import { byClass, stubDocument, textOf } from './stub-dom.ts'

const element = createElement(stubDocument())
const NOW = new Date('2027-04-01T12:00:00.000Z')

function template(over: Partial<FormTemplate> = {}): FormTemplate {
  return {
    form_template_id: 'ft',
    form_template_code: 'intake',
    kind: 'survey',
    title: 'Intake',
    description: null,
    status: 'published',
    ...over,
  }
}

function instance(over: Partial<FormInstance> = {}): FormInstance {
  return {
    form_instance_id: 'fi',
    form_template_id: 'ft',
    form_version_id: 'fv',
    title: 'Intake round one',
    state: 'open',
    open_at: '2027-03-01T00:00:00.000Z',
    close_at: '2027-05-01T00:00:00.000Z',
    ...over,
  }
}

function record(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    document_id: 'd',
    document_code: 'house-rule',
    title: 'House Rule',
    kind: 'policy',
    current_version_id: 'dv',
    ...over,
  }
}

function version(over: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    document_version_id: 'dv',
    document_id: 'd',
    parent_version_id: null,
    version_ordinal: 1,
    is_current: true,
    note: null,
    content_sha256: 'abcdef0123456789abcdef',
    storage_key: 'k',
    mime_type: 'text/plain',
    byte_size: 2048,
    origin: 'upload',
    ...over,
  }
}

function state(over: Partial<LibraryState> = {}): LibraryState {
  return {
    status: 'ready',
    template: [template()],
    instance: [instance()],
    document: [record()],
    now: NOW,
    ...over,
  }
}

const NOOP = { onOpenTemplate: () => {}, onBack: () => {} }

describe('whether an instance can be answered', () => {
  it('is answerable when open and inside its window', () => {
    assert.equal(isInstanceAnswerable(instance(), NOW), true)
  })

  // THE one. State and window disagree, and offering the form would collect
  // answers the pack then refuses.
  it('is not answerable when open but outside its window', () => {
    const early = instance({ open_at: '2027-06-01T00:00:00.000Z' })
    const late = instance({ close_at: '2027-01-01T00:00:00.000Z' })

    assert.equal(isInstanceAnswerable(early, NOW), false)
    assert.equal(isInstanceAnswerable(late, NOW), false)
    assert.equal(early.state, 'open', 'the state alone would have said yes')
  })

  it('is not answerable in draft or closed, whatever the dates say', () => {
    assert.equal(isInstanceAnswerable(instance({ state: 'draft' }), NOW), false)
    assert.equal(isInstanceAnswerable(instance({ state: 'closed' }), NOW), false)
  })

  it('is answerable with no window set at all', () => {
    assert.equal(isInstanceAnswerable(instance({ open_at: null, close_at: null }), NOW), true)
  })
})

describe('describing an instance', () => {
  it('says why, in words rather than a state code', () => {
    assert.equal(describeInstance(instance(), NOW), 'open for response')
    assert.equal(describeInstance(instance({ state: 'draft' }), NOW), 'not published yet')
    assert.equal(describeInstance(instance({ state: 'closed' }), NOW), 'closed')
    assert.equal(
      describeInstance(instance({ open_at: '2027-06-01T00:00:00.000Z' }), NOW),
      'opens later',
    )
    assert.equal(
      describeInstance(instance({ close_at: '2027-01-01T00:00:00.000Z' }), NOW),
      'the window has passed',
    )
  })

  it('never returns a bare underscore-shaped code for a state it knows', () => {
    for (const one of ['open', 'draft', 'closed']) {
      assert.doesNotMatch(describeInstance(instance({ state: one }), NOW), /_/)
    }
  })
})

describe('a byte count a person reads', () => {
  it('uses binary units, matching what an operating system reports', () => {
    assert.equal(formatByte(512), '512 B')
    assert.equal(formatByte(2048), '2.0 KiB')
    assert.equal(formatByte(1024 * 1024 * 3), '3.0 MiB')
  })

  it('drops the decimal once the number is large enough not to need it', () => {
    assert.equal(formatByte(1024 * 15), '15 KiB')
  })

  it('shortens a hash to something comparable by eye', () => {
    assert.equal(shortHash('abcdef0123456789abcdef'), 'abcdef012345')
  })
})

describe('version history', () => {
  it('orders newest first', () => {
    const ordered = orderVersion([version({ version_ordinal: 1 }), version({ version_ordinal: 3 })])
    assert.deepEqual(ordered.map((one) => one.version_ordinal), [3, 1])
  })

  // A reverted document has a current version that is NOT the highest ordinal.
  // Inferring "current" from the ordinal would mislabel exactly the case
  // somebody opened the history to understand.
  it('never infers current from the ordinal', () => {
    const ordered = orderVersion([
      version({ version_ordinal: 1, is_current: true }),
      version({ version_ordinal: 2, is_current: false }),
    ])
    assert.equal(ordered[0]?.version_ordinal, 2)
    assert.equal(ordered[0]?.is_current, false, 'the newest is not the current one here')
    assert.equal(ordered[1]?.is_current, true)
  })
})

describe('the form screen renders', () => {
  it('counts what is answerable, not what exists', () => {
    const tree = element(
      'div',
      {},
      renderForm(
        element,
        {
          display_name: 'Form',
          state: state({ instance: [instance(), instance({ state: 'closed' })] }),
        },
        NOOP,
      ),
    )
    assert.match(textOf(byClass(tree, 'summary')[0]), /1\s*open for response/)
  })

  it('marks a shut round differently from an answerable one', () => {
    const tree = element(
      'div',
      {},
      renderForm(
        element,
        { display_name: 'Form', state: state({ instance: [instance(), instance({ state: 'draft' })] }) },
        NOOP,
      ),
    )
    assert.equal(byClass(tree, 'answerable').length, 1)
    assert.equal(byClass(tree, 'shut').length, 1)
  })

  it('opens the template the button belongs to', () => {
    let chosen = ''
    const tree = element(
      'div',
      {},
      renderForm(
        element,
        {
          display_name: 'Form',
          state: state({
            template: [template(), template({ form_template_id: 'ft-2', title: 'Quiz' })],
          }),
        },
        { ...NOOP, onOpenTemplate: (one) => (chosen = one.form_template_id) },
      ),
    )
    byClass(tree, 'link')[1]!.listener['click']!({})
    assert.equal(chosen, 'ft-2')
  })

  it('says so when nothing is defined', () => {
    const tree = element(
      'div',
      {},
      renderForm(element, { display_name: 'Form', state: state({ template: [], instance: [] }) }, NOOP),
    )
    assert.match(textOf(tree), /No form defined yet/)
  })

  it('does not claim it is empty while it is still loading', () => {
    const tree = element(
      'div',
      {},
      renderForm(
        element,
        { display_name: 'Form', state: state({ status: 'loading', template: [], instance: [] }) },
        NOOP,
      ),
    )
    assert.doesNotMatch(textOf(tree), /No form defined yet/)
    assert.match(textOf(tree), /reading form/)
  })
})

describe('the document shelf renders', () => {
  it('lists a record with its code and kind', () => {
    const tree = element(
      'div',
      {},
      renderDocument(element, { display_name: 'Document', state: state() }, { onBack: () => {} }),
    )
    assert.match(textOf(byClass(tree, 'shelf')[0]), /House Rule/)
    assert.match(textOf(byClass(tree, 'shelf')[0]), /policy/)
  })

  // The route returns metadata only, and the screen must not imply otherwise.
  it('shows no content, no storage key, and no hash', () => {
    const tree = element(
      'div',
      {},
      renderDocument(element, { display_name: 'Document', state: state() }, { onBack: () => {} }),
    )
    const text = textOf(tree)
    assert.doesNotMatch(text, /storage/i)
    assert.doesNotMatch(text, /sha256|abcdef/i)
  })

  it('flags a record that was created and never filled', () => {
    const tree = element(
      'div',
      {},
      renderDocument(
        element,
        { display_name: 'Document', state: state({ document: [record({ current_version_id: null })] }) },
        { onBack: () => {} },
      ),
    )
    assert.match(textOf(byClass(tree, 'pill')[0]), /no content yet/)
  })

  it('says the shelf is empty rather than drawing an empty list', () => {
    const tree = element(
      'div',
      {},
      renderDocument(
        element,
        { display_name: 'Document', state: state({ document: [] }) },
        { onBack: () => {} },
      ),
    )
    assert.match(textOf(tree), /Nothing filed yet/)
  })
})
