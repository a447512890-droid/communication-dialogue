// Browser-side Qwen WebRTC session. The long-lived API key stays in the local server.
class QwenPracticeSession {
  constructor(goal, callbacks = {}) {
    this.goal = goal;
    this.callbacks = callbacks;
    this.pc = null;
    this.stream = null;
    this.audio = null;
    this.sender = null;
    this.channel = null;
    this.channels = new Set();
    this.abortController = new AbortController();
    this.confirmationTimer = null;
    this.closed = false;
    this.configured = false;
    this.pendingAudio = '';
    this.pendingText = '';
    this.updateSent = false;
    this.micMonitor = null;
    this.lastAudioAt = 0;
    this.lastServiceAt = 0;
  }

  emit(name, ...args) { this.callbacks[name]?.(...args); }

  instructions() {
    const g = this.goal;
    return `你正在与用户进行中文电话沟通演练。用户扮演${g.userRole}，你只扮演${g.role}。\n场景：${g.scenarioLabel}\n用户角色：${g.userRole}\n你的角色：${g.role}\n本次沟通目标：${g.objective}${g.background?.trim()?`\n背景：${g.background}`:''}${g.notes?.trim()?`\n用户备注：${g.notes}`:''}\n难度：${g.difficulty}\n每轮先回应用户，再提出一个相关追问或异议。使用适合电话的短句。备注仅作本次演练参考，不代表对方已知事实。不要编造金额、日期、政策或证据。较多异议时提出合理阻碍。始终保持对方角色，不宣称真实拨号或保存录音。`;
  }

  microphoneInfo(track) {
    this.emit('microphone', { label: track.label || '系统默认麦克风', deviceId: track.getSettings().deviceId || '' });
    track.onmute = () => { if (!this.closed) this.emit('micHint', '麦克风被系统暂停，请检查设备连接'); };
    track.onunmute = () => { if (!this.closed) this.emit('micHint', ''); };
    track.onended = () => { if (!this.closed && this.sender?.track === track) this.emit('error', new Error('麦克风已断开，请重新选择设备')); };
  }

  async switchMicrophone(deviceId) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true } });
      if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('所选麦克风没有音频轨道');
      const oldStream = this.stream;
      await this.sender.replaceTrack(track);
      if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.microphoneInfo(track);
      oldStream?.getTracks().forEach(t => t.stop());
      this.lastAudioAt = Date.now();
      this.emit('micHint', '');
      try { localStorage.setItem('practice-microphone-id', deviceId); } catch {}
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (!this.closed) this.emit('micHint', '麦克风切换失败：' + error.message);
    }
  }

  monitorMicrophone() {
    this.lastAudioAt = this.lastServiceAt = Date.now();
    clearInterval(this.micMonitor);
    let energy = null;
    this.micMonitor = setInterval(async () => {
      if (this.closed || !this.pc) return;
      try {
        const stats = await this.pc.getStats();
        if (this.closed) return;
        const source = [...stats.values()].find(r => r.type === 'media-source' && r.kind === 'audio');
        if (!source) return;
        if (source.audioLevel > 0.01 || (energy !== null && source.totalAudioEnergy > energy + 0.0001)) this.lastAudioAt = Date.now();
        energy = source.totalAudioEnergy;
        const quiet = Date.now() - this.lastAudioAt > 8000;
        const noRecognition = Date.now() - this.lastServiceAt > 20000 && !quiet;
        this.emit('micHint', this.sender?.track?.muted ? '麦克风被系统暂停，请检查设备连接' : quiet ? '未检测到声音，请检查或切换麦克风' : noRecognition ? '已采集到声音，但暂未收到识别，请重新连接' : '');
      } catch {}
    }, 1500);
  }

  async waitForIce() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('等待网络协商超时')), 15000);
      this.pc.addEventListener('icegatheringstatechange', () => {
        if (this.pc.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
      });
    });
  }

  attachChannel(channel) {
    this.channels.add(channel);
    channel.onmessage = ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      this.onEvent(event, channel);
    };
    channel.onerror = () => this.emit('error', new Error('实时事件通道发生错误'));
  }

  onEvent(event, channel) {
    if (this.closed) return;
    if (event.type.startsWith('input_audio_buffer.speech_') || event.type.startsWith('conversation.item.input_audio_transcription.') || event.type.startsWith('response.')) this.lastServiceAt = Date.now();
    if (event.type === 'session.created' && !this.updateSent) {
      this.updateSent = true;
      channel.send(JSON.stringify({
        event_id: `event_${crypto.randomUUID()}`,
        type: 'session.update',
        session: {
          instructions: this.instructions(),
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
      this.emit('status', '正在配置会话');
      return;
    }
    if (event.type === 'session.updated' && !this.configured) {
      this.configured = true;
      clearTimeout(this.confirmationTimer);
      const track = this.stream.getAudioTracks()[0];
      this.sender.replaceTrack(track).then(() => {
        if (this.closed) return;
        track.enabled = true;
        this.microphoneInfo(track);
        this.monitorMicrophone();
        this.emit('ready');
        this.emit('status', '正在听');
      }).catch(error => this.emit('error', error));
      return;
    }
    if (event.type === 'input_audio_buffer.speech_started') this.emit('status', '正在听');
    if (event.type === 'input_audio_buffer.speech_stopped') this.emit('status', '正在识别');
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) this.emit('userText', event.transcript.trim());
    if (event.type === 'response.audio_transcript.delta' || event.type === 'response.text.delta') {
      const field = event.type === 'response.audio_transcript.delta' ? 'pendingAudio' : 'pendingText';
      this[field] += event.delta || '';
      this.emit('assistantText', this.pendingAudio || this.pendingText);
      this.emit('status', '正在回应');
    }
    if (event.type === 'response.audio_transcript.done' || event.type === 'response.text.done') {
      const finalText = (event.type === 'response.audio_transcript.done'
        ? event.transcript || this.pendingAudio
        : this.pendingAudio || event.text || this.pendingText).trim();
      if (finalText) this.emit('assistantText', finalText);
    }
    if (event.type === 'response.done') {
      this.pendingAudio = '';
      this.pendingText = '';
      this.emit('assistantDone');
      this.emit('status', '正在听');
    }
    if (event.type === 'error') this.emit('error', new Error(event.error?.message || '千问实时服务返回错误'));
  }

  async start() {
    try {
      if (!window.hasDataProcessingConsent?.()) throw new Error('请先同意数据处理说明');
      const inputError = window.validateInputFields('goal', this.goal);
      if (inputError) throw new Error(inputError);
      // Match the demo: the SDP endpoint reports missing configuration itself.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法访问麦克风，请使用 localhost 或 HTTPS 打开演练');
      this.emit('status', '请求麦克风权限');
      const devices = await navigator.mediaDevices.enumerateDevices();
      let preferred = '';
      try { preferred = localStorage.getItem('practice-microphone-id') || ''; } catch {}
      const selected = (preferred && devices.find(d => d.kind === 'audioinput' && d.deviceId === preferred))
        || devices.find(d => d.kind === 'audioinput' && /iphone/i.test(d.label));
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(selected ? { deviceId: { exact: selected.deviceId } } : {}), echoCancellation: true, noiseSuppression: true } });
      if (this.closed) { this.stream.getTracks().forEach(track => track.stop()); return; }
      const track = this.stream.getAudioTracks()[0];
      if (!track) throw new Error('浏览器没有提供可用的麦克风音轨');
      track.enabled = false;
      this.pc = new RTCPeerConnection({ iceServers: [] });
      // Register the actual stream before creating the SDP, so the remote side
      // receives its stream identity. Gate audio until session configuration.
      this.sender = this.pc.addTrack(track, this.stream);
      await this.sender.replaceTrack(null);
      this.audio = new Audio();
      this.audio.autoplay = true;
      this.pc.ontrack = async event => {
        this.audio.srcObject = event.streams[0];
        try { await this.audio.play(); } catch { this.emit('error', new Error('浏览器阻止了语音播放，请点击页面后重试')); }
      };
      this.pc.onconnectionstatechange = () => {
        if (!this.closed && ['failed', 'disconnected'].includes(this.pc.connectionState)) this.emit('error', new Error('实时连接已中断'));
      };
      this.channel = this.pc.createDataChannel('oai-events');
      this.attachChannel(this.channel);
      this.pc.ondatachannel = event => this.attachChannel(event.channel);
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.emit('status', '正在连接千问');
      await this.waitForIce();
      const response = await fetch('/api/realtime-sdp', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: this.pc.localDescription.sdp, signal: this.abortController.signal });
      const answer = await response.text();
      if (!response.ok) {
        let detail = answer;
        try { const data = JSON.parse(answer); detail = [data.error, data.detail].filter(Boolean).join('：'); } catch {}
        throw new Error(detail || `千问连接失败（${response.status}）`);
      }
      const normalized = answer.trim().replace(/\r?\n/g, '\r\n');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n` });
      if (this.closed) return;
      this.confirmationTimer = setTimeout(() => {
        if (!this.closed && !this.configured) this.emit('error', new Error('等待千问会话确认超时'));
      }, 15000);
    } catch (error) {
      if (!this.closed) {
        const message = error.name === 'NotAllowedError' ? '麦克风权限未开启，请允许访问麦克风后重新连接'
          : error.name === 'NotFoundError' ? '未找到可用麦克风，请连接麦克风后重试'
          : error instanceof TypeError ? '无法连接本地语音服务，请从 http://127.0.0.1:8766/ 打开并重新连接' : error.message;
        this.emit('error', new Error(message));
      }
    }
  }


  close() {
    this.closed = true;
    clearTimeout(this.confirmationTimer);
    clearInterval(this.micMonitor);
    this.abortController.abort();
    this.channels.forEach(channel => { try { channel.close(); } catch {} });
    this.channels.clear();
    this.stream?.getTracks().forEach(track => track.stop());
    try { this.channel?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
  }
}
