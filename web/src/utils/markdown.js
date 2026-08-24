import DOMPurify from 'dompurify';
import { marked } from 'marked';

const SANITIZE_OPTIONS = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'template'],
  FORBID_ATTR: ['srcdoc'],
};

export function renderMarkdown(source = '') {
  return DOMPurify.sanitize(marked.parse(source), SANITIZE_OPTIONS);
}
