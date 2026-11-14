import type { ListItem, Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

/**
 * Flips the `index`-th task (`- [ ]` / `- [x]`) in document order, the order the rendered
 * checkboxes appear in, and returns the new Markdown. Only that marker changes; code blocks
 * and frontmatter never count as tasks because the real parser decides what a task is.
 */
export function toggleTask(markdown: string, index: number, checked: boolean): string {
  const tree = parser.parse(markdown) as Root;
  const tasks: ListItem[] = [];
  visit(tree, "listItem", (item: ListItem) => {
    if (typeof item.checked === "boolean") tasks.push(item);
  });
  const task = tasks[index];
  const start = task?.position?.start.offset;
  if (start === undefined) throw new RangeError(`No task #${index}`);
  const marker = /\[([ xX])\]/.exec(markdown.slice(start));
  if (!marker) throw new RangeError(`No task marker for task #${index}`);
  const at = start + marker.index + 1;
  return markdown.slice(0, at) + (checked ? "x" : " ") + markdown.slice(at + 1);
}
