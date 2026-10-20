// Read the Markdown source directly; no generated data file is required.
window.REQUIREMENTS = Object.create(null);
window.REQUIREMENTS_COMMON_RULES = '';
window.requirementsLoadState = { loaded: false, error: '' };
(() => {
  let pending = null;
  let lastSource = null;
  const fields = ['标题', '功能说明', '模块说明', '数据来源', '技术参考实现方案', '前置条件', '后置结果', '显示数量限制', '排序规则'];
  function parse(source) {
    const result = Object.create(null);
    for (const block of source.replace(/\r\n?/g, '\n').split(/^## /m).slice(1)) {
      const end = block.indexOf('\n');
      const key = block.slice(0, end).trim();
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
      const body = block.slice(end + 1);
      const matches = [...body.matchAll(/^- ([^:：\n]+)[:：][ \t]*(.*)$/gm)].filter(m => fields.includes(m[1]));
      const note = Object.create(null);
      matches.forEach((match, i) => {
        const content = body.slice(match.index + match[0].length, matches[i + 1]?.index ?? body.length);
        const value = (match[2] + '\n' + content).trim();
        if (match[1] !== '数据来源' || !value.includes('|')) { note[match[1]] = value; return; }
        const rows = value.split('\n').filter(line => /^\s*\|/.test(line)).map(line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
        const headers = rows.shift() || [];
        note.数据来源 = rows.filter(row => !row.every(cell => /^[-: ]+$/.test(cell))).map(row => Object.fromEntries(headers.map((header, index) => [header.startsWith('字段名称') ? '字段名称' : header, row[index] || ''])));
      });
      if (!note.标题) throw new Error(`模块 ${key} 缺少“标题”，请检查需求说明.md`);
      result[key] = note;
    }
    if (!Object.keys(result).length) throw new Error('需求说明.md中没有可读取的模块');
    return result;
  }
  window.refreshRequirements = () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch('../docs/产品需求/需求说明.md', { cache: 'no-store' });
        if (!response.ok) throw new Error(`读取需求说明.md失败（${response.status}）`);
        const source = await response.text();
        const changed = source !== lastSource || !!window.requirementsLoadState.error;
        if (source !== lastSource) { window.REQUIREMENTS = parse(source); window.REQUIREMENTS_COMMON_RULES = source.replace(/\r\n?/g, '\n').match(/^## 通用规则\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim() || ''; lastSource = source; }
        window.requirementsLoadState = { loaded: true, error: '' };
        if (changed) window.dispatchEvent(new Event('requirements-updated'));
      } catch (error) {
        window.requirementsLoadState.error = error.message || '读取需求说明.md失败';
        window.dispatchEvent(new Event('requirements-updated'));
      } finally { pending = null; }
    })();
    return pending;
  };
  window.refreshRequirements();
  setInterval(() => { if (!document.hidden && document.querySelector('.workspace-grid.spec-open')) window.refreshRequirements(); }, 2000);
  window.addEventListener('focus', () => window.refreshRequirements());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) window.refreshRequirements(); });
})();
