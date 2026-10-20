// Product limits. Count normalized Unicode code points, not UTF-16 units or tokens.
window.INPUT_RULES = Object.freeze({
  goal: {
    userRole: { label: '我扮演', min: 1, max: 20 },
    role: { label: 'AI 扮演', min: 1, max: 20 },
    objective: { label: '对话目的', min: 1, max: 100 },
    background: { label: '背景', min: 0, max: 100 },
    notes: { label: '备注', min: 0, max: 60 }
  },
  search: { max: 100 },
  phone: { digits: 11 },
  aiBudget: { initialInstructionsTokens: 4096, analysisInputTokens: 24000,
    analysisOutputTokens: 4096, safetyTokens: 4096,
    chunkTokens: 8000, chunkOverlapTokens: 300 }
});
window.normalizeInputText = value => String(value ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
window.countInputText = value => [...window.normalizeInputText(value)].length;
window.validateInputFields = (group, values) => {
  for (const [key, rule] of Object.entries(window.INPUT_RULES[group])) {
    const length = window.countInputText(values[key]);
    if (length < rule.min) return `请填写${rule.label}。`;
    if (length > rule.max) return `${rule.label}最多${rule.max}字，当前${length}字，请精简后再提交。`;
  }
  return '';
};
