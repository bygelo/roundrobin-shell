// The DOM primitive, against a stub document.
//
// This does not prove the page renders. It proves the one helper every line of
// render code goes through handles the shapes that code actually passes it —
// which is where a missing button comes from, and a missing button is a bug
// nobody reports because nobody saw it.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement, type DocumentLike, type NodeLike } from '../src/dom.ts'

type Fake = NodeLike & {
  tag: string
  child: unknown[]
  attribute: Record<string, string>
  listener: Record<string, (event: unknown) => void>
}

function fakeDocument(): DocumentLike & { made: Fake[] } {
  const made: Fake[] = []
  return {
    made,
    createElement(tag: string) {
      const node: Fake = {
        tag,
        className: '',
        child: [],
        attribute: {},
        listener: {},
        append: (...one: unknown[]) => node.child.push(...one),
        setAttribute: (name, value) => {
          node.attribute[name] = value
        },
        addEventListener: (type, handler) => {
          node.listener[type] = handler
        },
      }
      made.push(node)
      return node
    },
    createTextNode: (text: string) => ({ text }),
  }
}

describe('createElement', () => {
  it('sets className from `class`, and everything else as an attribute', () => {
    const document = fakeDocument()
    const node = createElement(document)('input', { class: 'small', type: 'password' }) as Fake

    assert.equal(node.className, 'small')
    assert.deepEqual(node.attribute, { type: 'password' })
    assert.ok(!('class' in node.attribute), 'class must not also become an attribute')
  })

  it('binds a function as a listener and strips the on prefix', () => {
    const document = fakeDocument()
    let fired = false
    const node = createElement(document)('button', { onclick: () => (fired = true) }) as Fake

    assert.deepEqual(Object.keys(node.listener), ['click'])
    node.listener['click']?.(null)
    assert.equal(fired, true)
    assert.deepEqual(node.attribute, {}, 'a handler is not also written as an attribute')
  })

  // The render code is full of `condition ? node : ''`. Appending that empty
  // string produced a stray text node, which is harmless until it lands
  // between two inline elements and eats the spacing.
  it('drops a falsy child instead of appending an empty text node', () => {
    const document = fakeDocument()
    const node = createElement(document)('div', {}, ['keep', '', null, undefined, false]) as Fake

    assert.equal(node.child.length, 1)
    assert.deepEqual(node.child[0], { text: 'keep' })
  })

  it('flattens the nested arrays that .map() produces', () => {
    const document = fakeDocument()
    const element = createElement(document)
    const node = element('div', {}, [
      'header',
      ['a', 'b'].map((one) => element('span', {}, one)),
    ]) as Fake

    assert.equal(node.child.length, 3, 'the array is spliced, not appended as one child')
  })

  it('accepts a single child that is not an array', () => {
    const document = fakeDocument()
    const node = createElement(document)('h1', {}, 'Booking') as Fake
    assert.deepEqual(node.child, [{ text: 'Booking' }])
  })

  it('wraps a string child as a text node but passes an element through', () => {
    const document = fakeDocument()
    const element = createElement(document)
    const inner = element('em', {}, 'now')
    const node = element('p', {}, ['before ', inner]) as Fake

    assert.deepEqual(node.child[0], { text: 'before ' })
    assert.equal(node.child[1], inner, 'an element is appended as itself, not stringified')
  })
})
