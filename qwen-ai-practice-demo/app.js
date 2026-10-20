const $ = (selector) => document.querySelector(selector);
const state = { pc: null, stream: null, channel: null, channels: [], messages: [], pendingAi: null, connected: false, ending: false, micTrack: null, micSender: null };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

function setStatus(text, kind = '') {
  const node = $('#connection-state');
  node.className = `connection-state ${kind}`;
  node.querySelector('span').textContent = text;
}

function setDetail(text) {
  const node = $('#connection-detail');
  if (node) node.textContent = text;
}

function showSetupError(message) {
  const help = $('#config-help');
  help.textContent = message;
  help.style.color = '#bd6157';
}

function paintConversation() {
  const root = $('#conversation');
  if (!state.messages.length) {
    root.innerHTML = '<div class="empty-conversation"><span class="sound-mark">〰</span><strong>连接成功后，开始说出你的开场白</strong><small>AI 会根据场景扮演对方，并用语音回应</small></div>';
    return;
  }
  root.innerHTML = state.messages.map((m) => `<div class="message ${m.role}"><span class="speaker">${m.role === 'user' ? '我' : 'AI 对方'}</span><div class="bubble">${esc(m.text || (m.role === 'assistant' ? '正在组织回应…' : ''))}</div></div>`).join('');
  root.scrollTop = root.scrollHeight;
}

function addMessage(role, text = '') {
  const item = { role, text };
  state.messages.push(item);
  if (role === 'assistant') state.pendingAi = item;
  paintConversation();
  return item;
}

function currentAssistant() {
  if (!state.pendingAi) return addMessage('assistant', '');
  return state.pendingAi;
}

function appendAssistantText(source, delta) {
  const item = currentAssistant();
  item[source === 'audio' ? 'audioText' : 'textText'] = (item[source === 'audio' ? 'audioText' : 'textText'] || '') + (delta || '');
  item.text = item.audioText || item.textText || '';
  paintConversation();
}

function renderResult() {
  const root = $('#result-transcript');
  if (!state.messages.length) {
    root.innerHTML = '<p class="footnote">本次没有收到可展示的转录文本。</p>';
  } else {
    root.innerHTML = state.messages.filter((m) => m.text.trim()).map((m) => `<div class="message ${m.role}"><span class="speaker">${m.role === 'user' ? '我' : 'AI 对方'}</span><div class="bubble">${esc(m.text)}</div></div>`).join('');
  }
}

function instructions() {
  const scenario = $('#scenario').value === 'custom' ? '自定义商务沟通' : $('#scenario').value;
  return `你正在与用户进行中文电话沟通演练。你只扮演对方角色，不扮演教练。\n场景：${scenario}\n对方角色：${$('#role').value.trim()}\n用户沟通目的：${$('#goal').value.trim()}\n背景事实：${$('#background').value.trim()}\n期望结果：${$('#expected').value.trim()}\n难度：${$('#difficulty').value}\n\n请遵守：背景是本次虚构演练的设定，不宣称代表真实商家或企业。每次先回应用户刚说的内容，再提出一个相关追问或异议；每轮保持适合电话的短句。保持角色权限和难度，不替用户作决定，不编造新的金额、日期、政策或证据。较多异议时可以提出合理阻碍，但不要连续堆叠问题。用户明确要求提示或暂停时，暂时用教练身份给一个简短提示，随后询问是否回到角色。不要真实拨号，不创建联系人，不声称保存录音。`;
}

function sendSessionUpdate(channel) {
  channel.send(JSON.stringify({
    event_id: `event_${crypto.randomUUID()}`,
    type: 'session.update',
    session: {
      instructions: instructions(),
      modalities: ['text', 'audio'],
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
      audio: {
        input: { format: { type: 'pcm', sample_rate: 16000 } },
        output: { format: { type: 'pcm', sample_rate: 24000 }, voice: 'Tina' }
      },
      turn_detection: { type: 'semantic_vad', threshold: 0.5, silence_duration_ms: 800 },
      smooth_output: true
    }
  }));
}

function receiveEvent(raw, channel) {
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  if (event.type === 'session.created') {
    setDetail(`已收到 session.created，通过 ${channel.label || '数据通道'} 发送会话配置…`);
    sendSessionUpdate(channel);
    setStatus('会话初始化中…', '');
    return;
  }
  if (event.type === 'session.updated') {
    if (state.micTrack && state.micSender && !state.micSender.track) {
      state.micSender.replaceTrack(state.micTrack).catch((error) => {
        setDetail(`会话已配置，但麦克风音轨添加失败：${error.message}`);
        showSetupError(`无法添加麦克风音轨：${error.message}`);
      });
    }
    state.connected = true;
    if (state.micTrack) state.micTrack.enabled = true;
    setStatus('已连接 · 可以开始说话', 'connected');
    $('#mic-label').textContent = '麦克风已开启';
    setDetail('会话配置已确认，麦克风音频已开始上行。');
    $('#mic-indicator').classList.add('active');
    $('#end-btn').disabled = false;
    setTimeout(() => {
      if (!state.connected || state.ending || $('#practice-card').classList.contains('hidden')) return;
      if (!state.messages.some((message) => message.role === 'user')) setStatus('正在听你说话…', 'connected');
    }, 1800);
    return;
  }
  if (event.type === 'input_audio_buffer.speech_started') {
    setStatus('检测到声音，正在听你说话…', 'connected');
    return;
  }
  if (event.type === 'input_audio_buffer.speech_stopped') {
    setStatus('收到语音，正在识别…', 'connected');
    return;
  }
  if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) {
    addMessage('user', event.transcript.trim());
    setStatus('收到你的内容，Qwen 正在组织回应…', 'connected');
  } else if (event.type === 'response.audio_transcript.delta') {
    setStatus('Qwen 正在语音回复…', 'connected');
    appendAssistantText('audio', event.delta);
  } else if (event.type === 'response.audio_transcript.done') {
    const text = event.transcript?.trim();
    if (text) {
      const target = state.pendingAi;
      if (!target) addMessage('assistant', text);
      else target.text = text;
      paintConversation();
    }
    state.pendingAi = null;
  } else if (event.type === 'response.text.delta') {
    setStatus('Qwen 正在回复…', 'connected');
    appendAssistantText('text', event.delta);
  } else if (event.type === 'response.text.done') {
    const text = event.text?.trim();
    const target = state.pendingAi;
    if (text && target && !target.audioText && !target.text) {
      target.text = text;
      paintConversation();
    }
  } else if (event.type === 'response.done') {
    state.pendingAi = null;
    if (state.connected) setStatus('可以继续说话…', 'connected');
    paintConversation();
  } else if (event.type === 'error') {
    const detail = event.error?.message || '实时服务返回错误';
    setStatus('服务错误', 'error');
    setDetail(`千问返回错误：${detail}`);
    showSetupError(`实时服务错误：${detail}`);
    toast(detail);
  }
}

function waitForIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待网络协商超时，请检查网络后重试。')), 15000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
    });
  });
}

async function startSession() {
  const startButton = $('#start-btn');
  startButton.disabled = true;
  startButton.querySelector('span:first-child').textContent = '正在请求麦克风…';
  $('#config-help').style.color = '#75837a';
  $('#config-help').textContent = '请在浏览器中允许麦克风访问；连接状态会显示在对练卡片右上角。';
  state.messages = [];
  state.pendingAi = null;
  state.ending = false;
  state.channels = [];
  $('#result-card').classList.add('hidden');
  $('#setup-card').classList.add('hidden');
  $('#practice-card').classList.remove('hidden');
  $('#scenario-summary').innerHTML = `<strong>${esc($('#scenario').value === 'custom' ? '自定义商务沟通' : $('#scenario').value)} · ${esc($('#role').value)}</strong><br>目标：${esc($('#goal').value)}<br>期望：${esc($('#expected').value)}`;
  paintConversation();
  setStatus('等待麦克风授权', '');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [micTrack] = state.stream.getAudioTracks();
    if (!micTrack) throw new Error('浏览器没有提供可用的麦克风音轨。');
    state.micTrack = micTrack;
    micTrack.onmute = () => setStatus('麦克风音轨被系统静音', 'error');
    micTrack.onunmute = () => { if (state.connected) setStatus('麦克风已恢复，可以继续说话…', 'connected'); };
    $('#mic-label').textContent = '已授权，等待 Qwen 会话';
    setDetail('麦克风已授权，正在建立 WebRTC 连接…');
    state.pc = new RTCPeerConnection({ iceServers: [] });
    const pc = state.pc;
    micTrack.enabled = false;
    state.micSender = pc.addTrack(micTrack, state.stream);
    await state.micSender.replaceTrack(null);
    pc.ontrack = async (event) => {
      const audio = $('#remote-audio');
      audio.srcObject = event.streams[0];
      try { await audio.play(); } catch { toast('浏览器阻止了语音播放，请点击页面后重试。'); }
    };
    pc.onconnectionstatechange = () => {
      setDetail(`WebRTC 状态：${pc.connectionState}；事件通道：${state.channels.map((ch) => ch.readyState).join(', ') || '尚未打开'}`);
      if (pc.connectionState === 'connected' && state.connected) setStatus('正在进行语音对练', 'connected');
      else if (['failed', 'disconnected'].includes(pc.connectionState) && !state.ending) {
        setStatus('连接中断', 'error');
        toast('实时连接已中断，可以结束后重试。');
      }
    };
    const channel = pc.createDataChannel('oai-events');
    channel.label = '客户端通道';
    state.channel = channel;
    state.channels.push(channel);
    const attachChannel = (activeChannel) => {
      activeChannel.onopen = () => setDetail(`事件通道已打开：${activeChannel.label}`);
      activeChannel.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setDetail(`收到 Qwen 事件：${parsed.type || '未知'}`);
        } catch {}
        receiveEvent(event.data, activeChannel);
      };
      activeChannel.onerror = () => {
        setDetail(`事件通道错误：${activeChannel.label}`);
        toast('实时事件通道发生错误。');
      };
      activeChannel.onclose = () => setDetail(`事件通道已关闭：${activeChannel.label}`);
    };
    attachChannel(channel);
    pc.ondatachannel = (event) => {
      event.channel.label = event.channel.label || '服务端通道';
      state.channels.push(event.channel);
      attachChannel(event.channel);
    };
    // Configure the session before attaching the microphone sender. Qwen rejects
    // turn_detection updates once an input audio buffer has started collecting data.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    setStatus('正在连接 Qwen…', '');
    setDetail('Offer 已创建，正在等待网络协商…');
    await waitForIce(pc);
    const response = await fetch('/api/realtime-sdp', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
    const answer = await response.text();
    if (!response.ok) {
      let message = answer;
      try { message = JSON.parse(answer).error + (JSON.parse(answer).detail ? `：${JSON.parse(answer).detail}` : ''); } catch {}
      throw new Error(message || `千问请求失败 (${response.status})`);
    }
    const normalized = answer.trim().replace(/\r?\n/g, '\r\n');
    await pc.setRemoteDescription({ type: 'answer', sdp: normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n` });
    setStatus('已建立连接，等待会话就绪…', '');
    setDetail(`SDP 交换成功；WebRTC=${pc.connectionState}；事件通道=${state.channels.map((ch) => ch.readyState).join(', ')}`);
    setTimeout(() => {
      if (!state.connected && !state.ending && !$('#practice-card').classList.contains('hidden')) {
        const channelState = state.channels.map((ch) => `${ch.label}:${ch.readyState}`).join(', ') || '无';
        const detail = `WebRTC=${pc.connectionState}；事件通道=${channelState}；未收到 session.updated`;
        setStatus('等待 Qwen 会话确认超时', 'error');
        setDetail(detail);
        showSetupError(`${detail}。请把此状态和终端 [realtime] 日志发给我。`);
      }
    }, 15000);
  } catch (error) {
    await endSession(false);
    $('#practice-card').classList.add('hidden');
    $('#setup-card').classList.remove('hidden');
    startButton.disabled = false;
    startButton.querySelector('span:first-child').textContent = '开始语音对练';
    const message = error.message || '无法开始演练，请检查麦克风和服务配置。';
    showSetupError(message);
    toast(message);
    setStatus('连接失败', 'error');
  }
}

async function endSession(showResult = true) {
  if (state.ending) return;
  state.ending = true;
  state.connected = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.micTrack = null;
  state.micSender = null;
  state.channels.forEach((channel) => { try { channel.close(); } catch {} });
  state.channels = [];
  try { state.channel?.close(); } catch {}
  state.channel = null;
  try { state.pc?.close(); } catch {}
  state.pc = null;
  const audio = $('#remote-audio');
  audio.pause();
  audio.srcObject = null;
  $('#mic-indicator').classList.remove('active');
  $('#mic-label').textContent = '麦克风已关闭';
  $('#end-btn').disabled = true;
  if (showResult) {
    renderResult();
    $('#result-card').classList.remove('hidden');
    $('#practice-card').classList.add('hidden');
  }
  state.ending = false;
}

async function checkConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    const status = $('#config-status');
    if (config.configured) {
      status.textContent = `服务已配置 · ${config.model}`;
      status.classList.add('ready');
      $('#start-btn').disabled = false;
      $('#config-help').textContent = 'API Key 保存在本地服务端，不会发送到浏览器。开始后才会申请麦克风。';
      $('#config-help').style.color = '#75837a';
    } else {
      status.textContent = '等待配置 API';
      status.classList.add('error');
      $('#config-help').textContent = '请复制 .env.example 为 .env，填写千问 AI 平台 API Key，然后重启服务。';
    }
  } catch {
    $('#config-status').textContent = '本地服务未启动';
    $('#config-status').classList.add('error');
    $('#config-help').textContent = '请根据 README 启动本地服务，再刷新页面。';
  }
}

$('#start-btn').addEventListener('click', startSession);
$('#end-btn').addEventListener('click', () => endSession(true));
$('#again-btn').addEventListener('click', () => {
  $('#result-card').classList.add('hidden');
  $('#setup-card').classList.remove('hidden');
  $('#start-btn').querySelector('span:first-child').textContent = '开始语音对练';
  $('#start-btn').disabled = false;
  checkConfig();
});
$('#scenario').addEventListener('change', () => {
  const roleMap = { 退款协商: '售后客服', 商务报价: '采购经理', 客户跟进: '潜在客户', 求职面试: '面试官' };
  if (roleMap[$('#scenario').value]) $('#role').value = roleMap[$('#scenario').value];
});
checkConfig();
