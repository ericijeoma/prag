import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownAnswer({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-slate prose-pre:bg-slate-900/60 prose-pre:border prose-pre:border-slate-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
