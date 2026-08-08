// The one DOM primitive the browser layer is built on.
//
// It lives here rather than inline in web/shell.js so it can be tested, because
// it is the piece with real edge cases: conditional children rendered as `''`,
// nested arrays from `.map()`, event handlers distinguished from attributes.
// Every one of those is something the render code does on nearly every line,
// and getting one wrong produces a page that is subtly missing a button rather
// than an error anybody sees.
//
// It takes the document as an argument, so a test can pass a stub and a browser
// passes its own. That is the whole reason this is testable at all.

/** The slice of the DOM this needs. Deliberately tiny, so a stub is cheap. */
export type NodeLike = {
  className: string
  append: (...child: unknown[]) => void
  setAttribute: (name: string, value: string) => void
  addEventListener: (type: string, handler: (event: unknown) => void) => void
}

export type DocumentLike = {
  createElement: (tag: string) => NodeLike
  createTextNode: (text: string) => unknown
}

export type Attribute = Record<string, string | ((event: unknown) => void)>

/**
 * A child may be a node, a string, or `false`/`''`/`null` from a conditional.
 *
 * Falsy children are DROPPED rather than rendered. The alternative is what the
 * first draft did: `condition ? node : ''` appended an empty text node, which
 * is harmless until it lands between two inline elements and eats the spacing.
 */
export type Child = unknown

export function createElement(document: DocumentLike) {
  return function element(tag: string, attribute: Attribute = {}, child: Child | Child[] = []): NodeLike {
    const node = document.createElement(tag)

    for (const [key, value] of Object.entries(attribute)) {
      if (typeof value === 'function') {
        // onclick -> click. Checked by type rather than by an `on` prefix,
        // because `onclick` and an attribute literally named `on` are not
        // distinguishable by name alone.
        node.addEventListener(key.replace(/^on/, ''), value)
        continue
      }
      if (key === 'class') {
        node.className = value
        continue
      }
      node.setAttribute(key, value)
    }

    for (const one of flatten(child)) {
      if (one === null || one === undefined || one === false || one === '') continue
      node.append(typeof one === 'string' ? document.createTextNode(one) : one)
    }

    return node
  }
}

/** One level of nesting is all the render code produces, but depth is free. */
function flatten(child: Child | Child[]): Child[] {
  return Array.isArray(child) ? child.flat(Infinity) : [child]
}
