// Element creation. JSX compiles to jsx() (tsconfig "jsxImportSource"), so files using JSX import nothing for it;
// h() is for when the element's own type is needed (an input's value, a button's disabled).
type Tag = keyof HTMLElementTagNameMap;
type Props<K extends Tag> = Partial<NoInfer<HTMLElementTagNameMap[K]>>;
export type Child = Node | string | number | null | undefined | false | Child[];

declare global {
  namespace JSX {
    type Element = HTMLElement;
    type ElementChildrenAttribute = { children: unknown };
    type IntrinsicElements = { [K in Tag]: Omit<Partial<HTMLElementTagNameMap[K]>, "children"> & { children?: Child } };
  }
}

const nodes = (children: Child[]): (Node | string)[] =>
  children.flatMap((child) => {
    if (Array.isArray(child)) return nodes(child);
    if (child == null || child === false) return [];
    return typeof child === "number" ? String(child) : child;
  });

function create<K extends Tag>(tag: K, props: object | null | undefined, children: Child[]) {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...nodes(children));
  return element;
}

export const h = <K extends Tag>(tag: K, props?: Props<K> | null, ...children: Child[]) => create(tag, props, children);

// props were already checked against JSX.IntrinsicElements
export const jsx = (tag: Tag, { children, ...props }: { children?: Child }) => create(tag, props, [children]);
export { jsx as jsxs, jsx as jsxDEV };
