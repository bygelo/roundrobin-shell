// A document just rich enough to render into, plus the queries a test needs.
//
// Not jsdom. The render code goes through exactly one primitive
// (src/dom.ts) and never touches a global, so the surface a stub has to cover
// is four methods — which is cheaper to read than a dependency, and makes the
// assertions below say what they mean instead of `querySelectorAll`.

import type { DocumentLike, NodeLike } from '../src/dom.ts'

export type StubNode = NodeLike & {
  tag: string
  className: string
  child: unknown[]
  attribute: Record<string, string>
  listener: Record<string, (event: unknown) => void>
}

export type StubText = { text: string }

export function isNode(value: unknown): value is StubNode {
  return typeof value === 'object' && value !== null && 'tag' in value
}

export function isText(value: unknown): value is StubText {
  return typeof value === 'object' && value !== null && 'text' in value
}

export function stubDocument(): DocumentLike {
  return {
    createElement(tag: string): StubNode {
      const node: StubNode = {
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
      return node
    },
    createTextNode: (text: string): StubText => ({ text }),
  }
}

/** Every node in the tree, depth first, including the root. */
export function walk(root: unknown): StubNode[] {
  if (!isNode(root)) return []
  return [root, ...root.child.flatMap((one) => walk(one))]
}

/** All the text in a tree, flattened — for "does this say X anywhere" checks. */
export function textOf(root: unknown): string {
  if (isText(root)) return root.text
  if (!isNode(root)) return ''
  return root.child.map((one) => textOf(one)).join('')
}

/** Nodes carrying a class, matched on whole words so `small` ≠ `small-text`. */
export function byClass(root: unknown, name: string): StubNode[] {
  return walk(root).filter((one) => one.className.split(/\s+/).includes(name))
}

export function byTag(root: unknown, tag: string): StubNode[] {
  return walk(root).filter((one) => one.tag === tag)
}

/** The visible label of every button in a tree, in document order. */
export function buttonLabel(root: unknown): string[] {
  return byTag(root, 'button').map((one) => textOf(one).trim())
}

/** Fire a node's handler, the way a click would. */
export function fire(node: StubNode, type = 'click'): void {
  const handler = node.listener[type]
  if (!handler) throw new Error(`no ${type} handler on <${node.tag}>`)
  handler({ preventDefault: () => {} })
}
