import type { ReactNode } from 'react';

// The Markdown an operator may write in a league rule, turned into elements and never into raw HTML:
// paragraphs, bulleted and numbered lists, headings, **bold**, *italic*, `code` and links. Anything else is
// shown as it was typed.
const inline = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g;
function spans(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(inline)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const key = m.index;
    if (m[1] !== undefined) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<em key={key}>{m[2] ?? m[3]}</em>);
    else if (m[4] !== undefined) out.push(<code key={key}>{m[4]}</code>);
    else out.push(<a key={key} href={m[6] ?? m[7]} rel="nofollow noreferrer">{m[5] ?? m[7]}</a>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
// Lines of one paragraph keep their breaks, as someone writing a rule would expect
const lines = (text: string[]) => text.flatMap((line, i) => (i ? [<br key={'br' + i} />, ...spans(line)] : spans(line)));
const bullet = /^\s*[-*+]\s+/;
const numbered = /^\s*\d+[.)]\s+/;
export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((block) => block.split('\n').filter((line) => line.trim())).filter((block) => block.length);
  return (
    <div className="prose">
      {blocks.map((block, i) => {
        if (block.every((line) => bullet.test(line))) return <ul key={i}>{block.map((line, j) => <li key={j}>{spans(line.replace(bullet, ''))}</li>)}</ul>;
        if (block.every((line) => numbered.test(line))) return <ol key={i}>{block.map((line, j) => <li key={j}>{spans(line.replace(numbered, ''))}</li>)}</ol>;
        const heading = block.length === 1 && block[0].match(/^#{1,6}\s+(.*)$/);
        if (heading) return <p key={i} className="prose-heading">{spans(heading[1])}</p>;
        return <p key={i}>{lines(block)}</p>;
      })}
    </div>
  );
}
