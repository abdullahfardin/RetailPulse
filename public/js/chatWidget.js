// ==========================================================================
// RETAILPULSE CONVERSATIONAL AI CHAT WIDGET & VOICE INTERFACE (T-1.5 & T-1.6)
// Engineered by Md Ebrahim Hossen for RetailPulse Studio
// Multi-turn Gemini assistant with Web Speech Recognition & Vocal Synthesis
// ==========================================================================

(function () {
  let conversationHistory = [];
  let isWidgetOpen = false;
  let isSending = false;
  let isVoiceMuted = false;
  let speechRecognition = null;
  let isListening = false;

  document.addEventListener('DOMContentLoaded', () => {
    // Only mount if authenticated
    if (!API.getToken()) return;
    initChatWidget();
    initSpeechEngine();
  });

  function initChatWidget() {
    // 1. Create Floating Launcher & Widget Markup
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'rpAiWidgetRoot';
    widgetContainer.innerHTML = `
      <!-- Launcher Button -->
      <button class="rp-chat-launcher" id="rpChatLauncher" title="Open RetailPulse AI Assistant">
        <div class="launcher-icon">
          <i class="bi bi-stars"></i>
        </div>
        <span>Ask Retail AI</span>
      </button>

      <!-- Chat Window -->
      <div class="rp-chat-widget collapsed" id="rpChatWidget">
        <!-- Header -->
        <div class="rp-chat-header">
          <div class="d-flex align-items-center gap-2">
            <div class="stat-icon bg-primary-subtle text-primary" style="width: 32px; height: 32px; font-size: 1rem; border-radius: 8px;">
              <i class="bi bi-robot"></i>
            </div>
            <div>
              <div class="fw-bold text-dark small mb-0">RetailPulse AI</div>
              <small class="text-muted" style="font-size: 0.72rem;">
                <span class="agent-status-dot me-1"></span> Gemini Flash • Voice Ready
              </small>
            </div>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button type="button" class="btn btn-sm btn-link text-muted p-1 border-0" id="rpBtnToggleVoiceMute" title="Toggle AI Vocal Responses">
              <i class="bi bi-volume-up" id="rpVoiceIcon"></i>
            </button>
            <button type="button" class="btn btn-sm btn-link text-muted p-1 border-0" id="rpBtnClearHistory" title="Clear Chat History">
              <i class="bi bi-trash"></i>
            </button>
            <button type="button" class="btn btn-sm btn-link text-muted p-1 border-0" id="rpBtnCloseChat" title="Close Chat">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
        </div>

        <!-- Messages Area -->
        <div class="rp-chat-messages" id="rpChatMessages">
          <div class="rp-chat-msg agent">
            <div class="msg-bubble">
              <div class="fw-bold mb-1" style="font-size: 0.82rem; color: var(--rp-primary);">
                👋 Hello! I am RetailPulse AI
              </div>
              I can check live inventory, query stock deficits, aggregate sales totals, and execute safe store mutations. Speak or type your request!
            </div>
          </div>
        </div>

        <!-- Quick Chips -->
        <div class="rp-quick-chips">
          <button class="rp-chip-btn" data-query="Check current low stock items">⚠️ Low Stock</button>
          <button class="rp-chip-btn" data-query="Give me today's sales summary">📊 Today's Sales</button>
          <button class="rp-chip-btn" data-query="Search for beverages in stock">🥤 Beverages</button>
          <button class="rp-chip-btn" data-query="What are the top 3 selling products?">🏆 Top Sellers</button>
        </div>

        <!-- Input Area -->
        <form class="rp-chat-input-area" id="rpChatForm">
          <div id="rpVoiceToast" class="rp-voice-toast d-none">
            <i class="bi bi-mic-fill text-danger me-1"></i> Listening... Speak now
          </div>
          <input type="text" class="form-control form-control-sm" id="rpChatInput" placeholder="Ask or speak about inventory..." autocomplete="off" required>
          <button type="button" class="rp-btn-voice" id="rpBtnVoice" title="Click to speak (Voice Recognition)">
            <i class="bi bi-mic" id="rpMicIcon"></i>
          </button>
          <button type="submit" class="btn btn-primary btn-sm rounded-circle d-flex align-items-center justify-content-center" id="rpBtnSend" style="width: 38px; height: 38px;" title="Send Message">
            <i class="bi bi-arrow-up"></i>
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(widgetContainer);

    // 2. Setup Event Listeners
    setupWidgetEvents();
  }

  function setupWidgetEvents() {
    const launcher = document.getElementById('rpChatLauncher');
    const widget = document.getElementById('rpChatWidget');
    const btnClose = document.getElementById('rpBtnCloseChat');
    const btnClear = document.getElementById('rpBtnClearHistory');
    const btnVoice = document.getElementById('rpBtnVoice');
    const btnVoiceMute = document.getElementById('rpBtnToggleVoiceMute');
    const form = document.getElementById('rpChatForm');
    const input = document.getElementById('rpChatInput');

    launcher.addEventListener('click', () => toggleWidget(true));
    btnClose.addEventListener('click', () => toggleWidget(false));

    btnClear.addEventListener('click', () => {
      conversationHistory = [];
      const messagesContainer = document.getElementById('rpChatMessages');
      messagesContainer.innerHTML = `
        <div class="rp-chat-msg agent">
          <div class="msg-bubble">
            <small class="text-muted d-block mb-1">Conversation history cleared.</small>
            How can I assist your retail operations right now?
          </div>
        </div>
      `;
    });

    btnVoiceMute.addEventListener('click', () => {
      isVoiceMuted = !isVoiceMuted;
      const icon = document.getElementById('rpVoiceIcon');
      if (isVoiceMuted) {
        icon.className = 'bi bi-volume-mute';
        btnVoiceMute.title = 'AI Voice Muted (Click to enable)';
      } else {
        icon.className = 'bi bi-volume-up';
        btnVoiceMute.title = 'AI Voice Active (Click to mute)';
      }
    });

    btnVoice.addEventListener('click', toggleVoiceInput);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || isSending) return;
      input.value = '';
      await sendUserMessage(text);
    });

    // Quick Chips delegation
    document.querySelector('.rp-quick-chips').addEventListener('click', (e) => {
      if (e.target.classList.contains('rp-chip-btn')) {
        const query = e.target.getAttribute('data-query');
        if (query) {
          input.value = query;
          form.dispatchEvent(new Event('submit'));
        }
      }
    });
  }

  // ================= SPEECH ENGINE (T-1.6) =================

  function initSpeechEngine() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('Web Speech Recognition API is not supported in this browser.');
      return;
    }

    speechRecognition = new SpeechRec();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = () => {
      isListening = true;
      const btnVoice = document.getElementById('rpBtnVoice');
      const micIcon = document.getElementById('rpMicIcon');
      const voiceToast = document.getElementById('rpVoiceToast');
      
      btnVoice.classList.add('listening');
      micIcon.className = 'bi bi-mic-fill';
      voiceToast.classList.remove('d-none');
    };

    speechRecognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const input = document.getElementById('rpChatInput');
      if (finalTranscript) {
        input.value = finalTranscript;
        // Auto-submit recognized speech command
        setTimeout(() => {
          document.getElementById('rpChatForm').dispatchEvent(new Event('submit'));
        }, 300);
      } else if (interimTranscript) {
        input.value = interimTranscript;
      }
    };

    speechRecognition.onerror = (err) => {
      console.warn('Speech Recognition error:', err.error);
      stopVoiceInput();
    };

    speechRecognition.onend = () => {
      stopVoiceInput();
    };
  }

  function toggleVoiceInput() {
    if (!speechRecognition) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening) {
      speechRecognition.stop();
      stopVoiceInput();
    } else {
      try {
        speechRecognition.start();
      } catch (err) {
        console.warn('Speech recognition start failed:', err);
      }
    }
  }

  function stopVoiceInput() {
    isListening = false;
    const btnVoice = document.getElementById('rpBtnVoice');
    const micIcon = document.getElementById('rpMicIcon');
    const voiceToast = document.getElementById('rpVoiceToast');

    if (btnVoice) btnVoice.classList.remove('listening');
    if (micIcon) micIcon.className = 'bi bi-mic';
    if (voiceToast) voiceToast.classList.add('d-none');
  }

  function speakReply(text) {
    if (isVoiceMuted || !('speechSynthesis' in window)) return;

    // Clean markdown and HTML for natural speech synthesis
    const cleanSpeech = text
      .replace(/<[^>]*>/g, '')
      .replace(/[*_#`~]/g, '')
      .replace(/৳/g, ' Taka ')
      .trim();

    window.speechSynthesis.cancel(); // Cancel any ongoing vocalization
    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }

  // ================= WIDGET LIFECYCLE & MESSAGING =================

  function toggleWidget(open) {
    const widget = document.getElementById('rpChatWidget');
    const launcher = document.getElementById('rpChatLauncher');
    isWidgetOpen = open;
    if (open) {
      widget.classList.remove('collapsed');
      launcher.style.display = 'none';
      setTimeout(() => document.getElementById('rpChatInput').focus(), 150);
    } else {
      widget.classList.add('collapsed');
      launcher.style.display = 'flex';
      if (isListening) stopVoiceInput();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
  }

  async function sendUserMessage(text) {
    isSending = true;
    appendMessage('user', text);

    const typingId = showTypingIndicator();
    const btnSend = document.getElementById('rpBtnSend');
    btnSend.disabled = true;

    try {
      const res = await API.post('/api/agent/chat', {
        message: text,
        conversation_history: conversationHistory
      });

      removeTypingIndicator(typingId);

      if (res.success) {
        appendMessage('agent', res.reply, {
          toolsUsed: res.tools_used || [],
          pendingConfirmation: res.pending_confirmation || null
        });

        if (Array.isArray(res.conversation_history)) {
          conversationHistory = res.conversation_history;
        }

        // Vocalize agent response via Text-to-Speech
        speakReply(res.reply);
      } else {
        appendMessage('agent', `⚠️ ${res.error || 'Failed to process request.'}`);
      }
    } catch (err) {
      removeTypingIndicator(typingId);
      appendMessage('agent', `⚠️ Error connecting to AI Agent: ${err.message}`);
    } finally {
      isSending = false;
      btnSend.disabled = false;
    }
  }

  function appendMessage(role, text, meta = {}) {
    const container = document.getElementById('rpChatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `rp-chat-msg ${role}`;

    let toolBadgeHtml = '';
    if (meta.toolsUsed && meta.toolsUsed.length > 0) {
      toolBadgeHtml = meta.toolsUsed.map(t => `
        <div class="rp-tool-tag">
          <i class="bi bi-gear-fill"></i> Executed: <strong>${escapeHtml(t.tool || t)}</strong>
        </div>
      `).join('');
    }

    let confirmationHtml = '';
    if (meta.pendingConfirmation) {
      const conf = meta.pendingConfirmation;
      confirmationHtml = `
        <div class="rp-confirm-card" id="cardConf_${conf.token}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold small text-dark"><i class="bi bi-shield-exclamation text-warning me-1"></i> Confirmation Required</span>
            <span class="confirm-badge">${escapeHtml(conf.token)}</span>
          </div>
          <div class="small text-muted mb-2">${escapeHtml(conf.summary || 'Approve inventory mutation')}</div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-primary py-0 px-2 rounded-pill" onclick="window.rpConfirmAction('${conf.token}')">
              <i class="bi bi-check2"></i> Confirm Action
            </button>
            <button class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" onclick="this.closest('.rp-confirm-card').remove()">
              Cancel
            </button>
          </div>
        </div>
      `;
    }

    msgDiv.innerHTML = `
      ${toolBadgeHtml}
      <div class="msg-bubble">
        ${formatAgentText(text)}
        ${confirmationHtml}
      </div>
    `;

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  function showTypingIndicator() {
    const container = document.getElementById('rpChatMessages');
    const id = 'typing_' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = id;
    typingDiv.className = 'rp-chat-msg agent';
    typingDiv.innerHTML = `
      <div class="msg-bubble py-2 px-3">
        <span class="spinner-grow spinner-grow-sm text-primary me-1" style="width: 7px; height: 7px;"></span>
        <span class="spinner-grow spinner-grow-sm text-primary me-1" style="width: 7px; height: 7px; animation-delay: 0.15s;"></span>
        <span class="spinner-grow spinner-grow-sm text-primary" style="width: 7px; height: 7px; animation-delay: 0.3s;"></span>
        <small class="text-muted ms-2" style="font-size: 0.75rem;">Thinking...</small>
      </div>
    `;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;
    return id;
  }

  function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // Two-Phase Confirmation Executor (Exposed globally for onclick)
  window.rpConfirmAction = async function (token) {
    const card = document.getElementById(`cardConf_${token}`);
    if (card) {
      card.innerHTML = `<small class="text-muted"><span class="spinner-border spinner-border-sm me-1"></span> Executing confirmed mutation...</small>`;
    }

    try {
      const res = await API.post('/api/agent/confirm', { token });
      if (res.success) {
        if (card) {
          card.innerHTML = `<small class="text-success fw-bold"><i class="bi bi-check-circle-fill me-1"></i> Confirmed & Executed successfully!</small>`;
        }
        appendMessage('agent', `Action verified: ${res.message || 'Inventory database state updated.'}`);
      } else {
        if (card) {
          card.innerHTML = `<small class="text-danger"><i class="bi bi-x-circle me-1"></i> Failed: ${res.error}</small>`;
        }
      }
    } catch (err) {
      if (card) {
        card.innerHTML = `<small class="text-danger"><i class="bi bi-x-circle me-1"></i> Error: ${err.message}</small>`;
      }
    }
  };

  function formatAgentText(text) {
    if (!text) return '';
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
})();
