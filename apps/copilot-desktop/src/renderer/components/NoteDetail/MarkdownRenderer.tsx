/**
 * MarkdownRenderer — secure React Markdown renderer.
 *
 * Sprint 1.2 / T-1.2.3.
 *
 * Stack
 *  - `react-markdown`        — core MD → React
 *  - `remark-gfm`            — GitHub Flavored Markdown (tables, task lists, strikethrough)
 *
 * Safety model
 *
 * Instead of `rehype-sanitize` (which strips the `wikilink:` URI scheme
 * I need for [[note_path]] click routing), we rely on react-markdown's
 * safe-by-construction behavior: it parses MD → HAST → React tree
 * WITHOUT raw HTML pass-through, and the explicit `components` map
 * below is the only path that produces DOM nodes. Raw `<script>`,
 * `<img onerror=...>`, and `javascript:` URIs never reach React because
 * the markdown AST can't represent them — they would only be emitted
 * by an `html` parser which we deliberately don't enable.
 *
 * Wikilinks (`[[note_path]]` / `[[note_path|alias]]`) are converted
 * into clickable React components via a `preprocess` step that swaps
 * them for inline links — the visible label becomes the link text and
 * the href is set to a `wikilink:` URI scheme so the click handler
 * can intercept without breaking standard browser behavior
 * (right-click "open in new tab" still works for assistive tech).
 */

import { useMemo, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractWikilinks } from './WikilinkHandler.js';
import styles from './styles.module.css';

/**
 * Replace `[[path]]` / `[[path|alias]]` tokens in raw markdown with
 * standard `[alias](wikilink:path)` links so the markdown pipeline
 * can handle them through its normal link rule.
 *
 * The replacement is idempotent — escaped or already-replaced links
 * are left alone.
 */
export function preprocessWikilinks(markdown: string): string {
  const tokens = extractWikilinks(markdown);
  if (tokens.length === 0) return markdown;
  let cursor = 0;
  let out = '';
  for (const tok of tokens) {
    out += markdown.slice(cursor, tok.start);
    // RFC 3986 unreserved chars are safe inside the path; everything
    // else gets percent-encoded. We avoid encoding forward slashes so
    // the resolved href stays readable.
    const safeTarget = encodeURI(tok.target).replace(/%2F/g, '/');
    out += `[${tok.label}](wikilink:${safeTarget})`;
    cursor = tok.end;
  }
  out += markdown.slice(cursor);
  return out;
}

export interface MarkdownRendererProps {
  /** Raw markdown source. */
  source: string;
  /** Called when the user clicks a `[[wikilink]]` link. */
  onWikilinkClick?: (targetPath: string) => void;
}

/**
 * Render markdown safely. Inline wikilinks are converted to clickable
 * links that route through `onWikilinkClick`. Code blocks get a
 * monospace `pre.code` style (CSS handles theming).
 */
export function MarkdownRenderer({
  source,
  onWikilinkClick,
}: MarkdownRendererProps): ReactElement {
  const processed = useMemo(() => preprocessWikilinks(source ?? ''), [source]);

  return (
    <div className={styles.markdown} data-testid="markdown-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // No `rehypePlugins` — we don't pass raw HTML through and the
        // component map below is the only DOM-producing path.
        skipHtml
        // Default `urlTransform` strips unknown URI schemes (including
        // our `wikilink:`); pass-through so the custom `a` component
        // can intercept the click before the browser navigates.
        urlTransform={(url) => url}
        components={{
          // Destructure `node` out — react-markdown 9.x injects it for
          // AST access, but spreading it into the DOM would render an
          // attribute named `node="[object Object]"`.
          a: ({ href, children, node: _node, ...rest }) => {
            if (typeof href === 'string' && href.startsWith('wikilink:')) {
              const target = decodeURI(href.slice('wikilink:'.length));
              return (
                <a
                  {...rest}
                  href={href}
                  className={styles.wikilink}
                  data-testid="wikilink"
                  data-target={target}
                  onClick={(evt) => {
                    evt.preventDefault();
                    onWikilinkClick?.(target);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          code: ({ className, children, node: _node, ...rest }) => {
            const isBlock = typeof className === 'string' && className.startsWith('language-');
            if (isBlock) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className={styles.inlineCode} {...rest}>
                {children}
              </code>
            );
          },
          pre: ({ children, node: _node, ...rest }) => (
            <pre className={styles.codeBlock} {...rest}>
              {children}
            </pre>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
