// app.js — مجلس مستشار أمد | Queue Mechanism + Dynamic Routing

const AGENTS_META = {
  planner:  { initial: 'س', color: '#1D9E75', bgColor: 'rgba(29,158,117,0.15)', borderColor: 'rgba(29,158,117,0.3)' },
  risk:     { initial: 'ن', color: '#185FA5', bgColor: 'rgba(24,95,165,0.15)',  borderColor: 'rgba(24,95,165,0.3)' },
  behavior: { initial: 'ف', color: '#B86A0A', bgColor: 'rgba(184,106,10,0.15)', borderColor: 'rgba(184,106,10,0.3)' },
};

// ─── حالة التطبيق ─────────────────────────────────────────────
let chatHistory      = [];    // { role, content }
let busy             = false; // هل المجلس يتحدث الآن؟
let currentAgentBubble = null;
let roundCount       = 0;

// ─── طابور الرسائل (Queue Mechanism) ──────────────────────────
let messageQueue     = [];    // رسائل معلقة في انتظار دور المعالجة

// ─── مساعدات DOM ───────────────────────────────────────────────
const $          = id => document.getElementById(id);
const messages   = $('messages');
const chatArea   = $('chat-area');
const userInput  = $('user-input');
const sendBtn    = $('send-btn');

function scrollBottom() {
  chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
}

// ─── استخدام اقتراح ────────────────────────────────────────────
function useSug(btn) {
  userInput.value = btn.querySelector('i').nextSibling.textContent.trim();
  sendMessage();
}

// ─── إدارة حجم textarea ────────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

// ─── مفتاح Enter ───────────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ─── إخفاء/إظهار sidebar على الجوال ──────────────────────────
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}

// ─── جلسة جديدة ────────────────────────────────────────────────
function newSession() {
  chatHistory  = [];
  roundCount   = 0;
  messageQueue = [];
  messages.innerHTML = '';
  $('welcome').style.display = 'flex';
  $('welcome').style.flexDirection = 'column';
  userInput.value = '';
  userInput.style.height = 'auto';
  resetAllStatuses();
}

function resetAllStatuses() {
  ['planner','risk','behavior'].forEach(id => {
    setStatus(id, 'idle');
    $('card-' + id).classList.remove('active','typing');
  });
}

// ─── حالة الوكيل في الـ sidebar ───────────────────────────────
function setStatus(agentId, state) {
  const dot  = $('status-' + agentId);
  const card = $('card-' + agentId);
  dot.className  = 'member-status ' + (state === 'typing' ? 'typing' : state === 'done' ? 'online' : '');
  card.classList.toggle('typing', state === 'typing');
  card.classList.toggle('active', state === 'done');
}

// ─── إضافة رسالة المستخدم ─────────────────────────────────────
function appendUserMsg(text, isPending = false) {
  const div = document.createElement('div');
  div.className = 'msg-user';
  if (isPending) div.setAttribute('data-pending', 'true');
  div.innerHTML = `
    <div class="msg-user-bubble" style="${isPending ? 'opacity:0.55;border:1.5px dashed rgba(255,255,255,0.2);' : ''}">
      ${escapeHtml(text)}
      ${isPending ? '<span style="font-size:11px;opacity:0.7;display:block;margin-top:4px;direction:rtl;">⏳ في انتظار دور المجلس...</span>' : ''}
    </div>
  `;
  messages.appendChild(div);
  scrollBottom();
  return div;
}

// ─── تفعيل رسالة معلقة (إزالة حالة الانتظار) ─────────────────
function activatePendingMsg(div) {
  div.removeAttribute('data-pending');
  const bubble = div.querySelector('.msg-user-bubble');
  bubble.style.opacity   = '';
  bubble.style.border    = '';
  const hint = bubble.querySelector('span');
  if (hint) hint.remove();
}

// ─── مؤشر الطابور ─────────────────────────────────────────────
function updateQueueBadge() {
  let badge = $('queue-badge');
  if (messageQueue.length === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'queue-badge';
    badge.style.cssText = `
      position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:rgba(29,158,117,0.9);color:#fff;
      padding:6px 16px;border-radius:20px;font-size:13px;
      z-index:999;backdrop-filter:blur(6px);
      box-shadow:0 2px 12px rgba(0,0,0,0.3);
      direction:rtl;
    `;
    document.body.appendChild(badge);
  }
  badge.textContent = `📋 ${messageQueue.length} رسالة في الانتظار`;
}

// ─── فاصل جولة المجلس ─────────────────────────────────────────
function appendRoundDivider() {
  roundCount++;
  const div = document.createElement('div');
  div.className = 'council-round';
  div.innerHTML = `
    <div class="council-round-line"></div>
    <div class="council-round-label"><i class="ti ti-users"></i> جولة المجلس ${roundCount}</div>
    <div class="council-round-line"></div>
  `;
  messages.appendChild(div);
}

// ─── إنشاء فقاعة وكيل ─────────────────────────────────────────
function createAgentBubble(agentId, agentName, role, color) {
  const meta = AGENTS_META[agentId];
  const wrap = document.createElement('div');
  wrap.className = 'msg-agent';
  wrap.id = 'msg-' + agentId + '-' + roundCount;
  wrap.innerHTML = `
    <div class="agent-avatar typing-anim"
         style="background:${meta.bgColor};border:1.5px solid ${meta.borderColor};color:${meta.color}">
      ${meta.initial}
    </div>
    <div class="agent-content">
      <div class="agent-meta">
        <span class="agent-name" style="color:${meta.color}">${agentName}</span>
        <span class="agent-role">${role}</span>
      </div>
      <div class="agent-bubble streaming" id="bubble-${agentId}-${roundCount}">
        <div class="typing-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;
  messages.appendChild(wrap);
  scrollBottom();
  return $('bubble-' + agentId + '-' + roundCount);
}

// ─── بطاقة "تم تخطي الوكيل" ───────────────────────────────────
function appendSkippedAgent(agentId, agentName) {
  const meta = AGENTS_META[agentId];
  const wrap = document.createElement('div');
  wrap.className = 'msg-agent';
  wrap.style.opacity = '0.38';
  wrap.innerHTML = `
    <div class="agent-avatar"
         style="background:${meta.bgColor};border:1.5px dashed ${meta.borderColor};color:${meta.color}">
      ${meta.initial}
    </div>
    <div class="agent-content">
      <div class="agent-meta">
        <span class="agent-name" style="color:${meta.color}">${agentName}</span>
        <span class="agent-role" style="font-style:italic">لا يتعلق بتخصصه</span>
      </div>
      <div class="agent-bubble" style="font-size:12px;padding:6px 10px;opacity:0.6;">
        ⏭ تم التخطي
      </div>
    </div>
  `;
  messages.appendChild(wrap);
}

// ─── الإرسال الرئيسي ──────────────────────────────────────────
function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  // إخفاء شاشة الترحيب
  const welcome = $('welcome');
  if (welcome) {
    welcome.style.opacity = '0';
    welcome.style.transition = 'opacity 0.3s';
    setTimeout(() => { if (welcome) welcome.remove(); }, 300);
  }

  userInput.value = '';
  userInput.style.height = 'auto';

  // ─ إذا المجلس مشغول، أضف للطابور ─
  if (busy) {
    const pendingDiv = appendUserMsg(text, true);
    messageQueue.push({ text, pendingDiv });
    updateQueueBadge();
    return;
  }

  // ─ وإلا ابدأ مباشرة ─
  processMessage(text, null);
}

// ─── معالجة رسالة واحدة (الدورة الفعلية) ─────────────────────
async function processMessage(text, pendingDiv) {
  busy = true;
  resetAllStatuses();

  // إذا كانت الرسالة معلقة، فعّلها الآن
  if (pendingDiv) {
    activatePendingMsg(pendingDiv);
  } else {
    appendUserMsg(text);
  }

  chatHistory.push({ role: 'user', content: text });
  appendRoundDivider();

  try {
    const res = await fetch('/api/council', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: chatHistory }),
    });

    if (!res.ok) throw new Error('Server error: ' + res.status);

    const reader   = res.body.getReader();
    const decoder  = new TextDecoder();
    let   buffer   = '';
    let   agentTexts = {};
    let   anyResponded = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        // ─ تقييم جارٍ ─
        if (evt.type === 'evaluating') {
          // يمكن إضافة مؤشر خفيف لاحقاً
        }

        // ─ وكيل تم تخطيه — فقط نحدث الـ sidebar بدون أي مربع رسالة ─
        else if (evt.type === 'agent_skipped') {
          setStatus(evt.agentId, 'idle');
          // لا نظهر أي شيء في المحادثة للوكيل المتخطي
        }

        // ─ بدء وكيل ─
        else if (evt.type === 'agent_start') {
          anyResponded = true;
          setStatus(evt.agentId, 'typing');
          currentAgentBubble = createAgentBubble(evt.agentId, evt.agentName, evt.role, evt.color);
          agentTexts[evt.agentId] = '';
        }

        // ─ توكن جديد ─
        else if (evt.type === 'token') {
          if (agentTexts[evt.agentId] === '' && currentAgentBubble) {
            currentAgentBubble.innerHTML = '';
            currentAgentBubble.classList.remove('streaming');
          }
          agentTexts[evt.agentId] += evt.token;
          if (currentAgentBubble) {
            currentAgentBubble.innerHTML = formatText(agentTexts[evt.agentId]);
          }
          scrollBottom();
        }

        // ─ انتهاء وكيل ─
        else if (evt.type === 'agent_done') {
          const wrapId = 'msg-' + evt.agentId + '-' + roundCount;
          const wrap = $(wrapId);
          if (wrap) wrap.querySelector('.agent-avatar')?.classList.remove('typing-anim');
          if (currentAgentBubble) currentAgentBubble.classList.remove('streaming');
          setStatus(evt.agentId, 'done');
        }

        // ─ لا أحد رد ─
        else if (evt.type === 'no_agents') {
          appendInfoMsg(evt.message);
        }

        // ─ انتهاء المجلس ─
        else if (evt.type === 'council_done') {
          const combined = Object.entries(agentTexts)
            .map(([id, t]) => `[${getAgentName(id)}]: ${t}`)
            .join('\n\n');
          if (combined.trim()) {
            chatHistory.push({ role: 'assistant', content: combined });
          }
        }

        // ─ خطأ ─
        else if (evt.type === 'error') {
          appendErrorMsg(evt.message);
        }
      }
    }

  } catch (err) {
    console.error(err);
    appendErrorMsg('تعذّر الاتصال بالمجلس. تأكد من تشغيل الخادم وصحة API Key.');
  }

  busy = false;

  // ─ سحب الرسالة التالية من الطابور تلقائياً ─
  if (messageQueue.length > 0) {
    const next = messageQueue.shift();
    updateQueueBadge();
    // تأخير بسيط للقراءة
    await new Promise(r => setTimeout(r, 400));
    processMessage(next.text, next.pendingDiv);
  } else {
    updateQueueBadge();
    userInput.focus();
  }
}

// ─── رسائل مساعدة ─────────────────────────────────────────────
function appendErrorMsg(msg) {
  const div = document.createElement('div');
  div.style.cssText = 'padding:10px 14px;background:rgba(218,54,51,0.1);border:1px solid rgba(218,54,51,0.3);border-radius:10px;font-size:13px;color:#f87171;margin:8px 0;';
  div.textContent = '⚠ ' + msg;
  messages.appendChild(div);
  scrollBottom();
}

function appendInfoMsg(msg) {
  const div = document.createElement('div');
  div.style.cssText = 'padding:10px 14px;background:rgba(255,200,0,0.08);border:1px solid rgba(255,200,0,0.25);border-radius:10px;font-size:13px;color:#fbbf24;margin:8px 0;text-align:center;';
  div.textContent = 'ℹ️ ' + msg;
  messages.appendChild(div);
  scrollBottom();
}

// ─── تنسيق النص ────────────────────────────────────────────────
function formatText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,   '<em>$1</em>')
    .replace(/\n/g,          '<br>');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getAgentName(id) {
  const names = { planner: 'سلمان', risk: 'نورة', behavior: 'فهد' };
  return names[id] || id;
}

// ─── تهيئة ──────────────────────────────────────────────────────
userInput.addEventListener('focus', () => {});
