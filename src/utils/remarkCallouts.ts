import { visit } from 'unist-util-visit';

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

export function remarkCallouts() {
  return (tree: MdNode) => {
    visit(tree, 'blockquote', (node: MdNode) => {
      const paragraph = node.children?.[0];
      const first = paragraph?.children?.[0];
      if (first?.type !== 'text' || !first.value) return;
      const match = first.value.match(CALLOUT);
      if (!match) return;
      const kind = match[1].toLowerCase();
      first.value = first.value.slice(match[0].length);
      node.data = {
        ...node.data,
        hName: 'aside',
        hProperties: { className: [`callout`, `callout-${kind}`], 'data-callout': kind },
      };
    });
  };
}
