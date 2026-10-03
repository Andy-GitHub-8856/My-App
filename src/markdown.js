// 簡易且安全的 Markdown 渲染（先跳脫 HTML 再轉換）

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/「([^」]{1,80})」/g, '<span class="q">「$1」</span>');

export function renderMarkdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, para = [], table = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
    const [head, ...body] = rows;
    out.push(`<div class="tbl"><table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    table = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); (table ||= []).push(line); continue; }
    flushTable();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushAll();
      const lv = Math.min(6, Math.max(3, m[1].length + 1));
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
    } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushAll(); out.push('<hr>');
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushAll(); out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara(); if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(m[1]);
    } else {
      flushList(); para.push(line);
    }
  }
  flushAll();
  return out.join('\n');
}
