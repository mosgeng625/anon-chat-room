// ==================== 配置区（必须修改）====================
const SUPABASE_URL = 'https://你的项目名.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...你的anon key';
const ADMIN_PASSWORD = 'admin123';

// ==================== 全局变量（改为let，避免重复声明）====================
let supabase;
let myId = null;
let currentPrivateTarget = null;

// ==================== 初始化（单例模式 + 禁用存储访问）====================
if (!window.supabaseInstance) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
  window.supabaseInstance = supabase;
} else {
  supabase = window.supabaseInstance;
}

// ==================== 登录（绑定到window，确保全局可访问）====================
window.enterRoom = async function() {
  const input = document.getElementById('playerId').value.trim();
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  let num = input.replace(/[^\d]/g, '') || '1';
  num = Math.max(1, Math.min(8, parseInt(num) || 1));
  const id = num + '号';

  const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .eq('player_id', id)
    .gt('last_seen', thirtySecondsAgo)
    .maybeSingle();

  if (existing) {
    errorEl.textContent = '该编号已被使用，请换其他编号';
    return;
  }

  myId = id;

  await supabase.from('players').upsert({
    player_id: id,
    last_seen: new Date().toISOString()
  });

  setInterval(() => {
    supabase.from('players').upsert({
      player_id: id,
      last_seen: new Date().toISOString()
    });
  }, 10000);

  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('myId').textContent = '我是：' + myId;

  await supabase.from('messages').insert({
    type: 'system',
    from_id: 'system',
    to_id: 'all',
    content: myId + ' 进入了房间'
  });

  startListeners();
}

// ==================== 监听 ====================
function startListeners() {
  supabase.channel('messages')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadMessages())
    .subscribe();

  supabase.channel('players')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => loadPlayers())
    .subscribe();

  loadMessages();
  loadPlayers();
}

// ==================== 加载消息 ====================
async function loadMessages() {
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100);

  const container = document.getElementById('messages');
  container.innerHTML = '';
  if (!messages) return;

  messages.forEach(msg => {
    if (msg.type === 'system') {
      const div = document.createElement('div');
      div.style.cssText = 'text-align:center; color:#888; margin:10px 0; font-size:13px;';
      div.textContent = msg.content;
      container.appendChild(div);
      return;
    }

    if (msg.type === 'private' && msg.from_id !== myId && msg.to_id !== myId) return;

    const div = document.createElement('div');
    div.className = 'msg' + (msg.type === 'private' ? ' msg-private' : '');

    const header = document.createElement('div');
    header.className = 'msg-header';
    header.textContent = msg.type === 'private'
      ? '🔒 ' + msg.from_id + ' → ' + msg.to_id + ' (私聊)'
      : msg.from_id;

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = msg.content;

    div.appendChild(header);
    div.appendChild(content);
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

// ==================== 加载在线玩家 ====================
async function loadPlayers() {
  const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .gt('last_seen', thirtySecondsAgo)
    .order('player_id');

  const container = document.getElementById('playerList');
  container.innerHTML = '';
  if (!players) return;

  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.onclick = () => openPrivate(p.player_id);

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = p.player_id.replace('号', '');

    const name = document.createElement('div');
    name.innerHTML = `<div class="player-name">${p.player_id}</div><div class="online">● 在线</div>`;

    div.appendChild(avatar);
    div.appendChild(name);
    container.appendChild(div);
  });
}

// ==================== 公屏发送 ====================
window.sendMessage = async function() {
  const input = document.getElementById('msgInput');
  const content = input.value.trim();
  if (!content || !myId) return;

  await supabase.from('messages').insert({
    type: 'public',
    from_id: myId,
    to_id: 'all',
    content: content
  });

  input.value = '';
}

// ==================== 私聊 ====================
window.openPrivate = function(targetId) {
  if (targetId === myId) {
    alert('不能给自己发私聊');
    return;
  }
  currentPrivateTarget = targetId;
  document.getElementById('privateTitle').textContent = '与 ' + targetId + ' 私聊';
  document.getElementById('privateModal').style.display = 'flex';
  loadPrivateMessages();
}

window.closePrivate = function() {
  document.getElementById('privateModal').style.display = 'none';
  currentPrivateTarget = null;
}

async function loadPrivateMessages() {
  if (!currentPrivateTarget || !myId) return;

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('type', 'private')
    .or(`and(from_id.eq.${myId},to_id.eq.${currentPrivateTarget}),and(from_id.eq.${currentPrivateTarget},to_id.eq.${myId})`)
    .order('created_at', { ascending: true });

  const container = document.getElementById('privateMessages');
  container.innerHTML = '';
  if (!messages) return;

  messages.forEach(msg => {
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:10px; padding:8px; background:' +
      (msg.from_id === myId ? '#e94560' : '#533483') + '; border-radius:6px; color:#fff;';
    div.innerHTML = `<small>${msg.from_id}</small><br>${msg.content}`;
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

window.sendPrivate = async function() {
  const input = document.getElementById('privateInput');
  const content = input.value.trim();
  if (!content || !currentPrivateTarget || !myId) return;

  await supabase.from('messages').insert({
    type: 'private',
    from_id: myId,
    to_id: currentPrivateTarget,
    content: content
  });

  input.value = '';
  loadPrivateMessages();
}

// ==================== 管理员 ====================
window.showAdmin = function() {
  const pwd = prompt('请输入房主密码：');
  if (pwd === ADMIN_PASSWORD) {
    document.getElementById('adminModal').style.display = 'flex';
  } else if (pwd !== null) {
    alert('密码错误');
  }
}

window.closeAdmin = function() {
  document.getElementById('adminModal').style.display = 'none';
}

window.resetRoom = async function() {
  if (!confirm('确定要重置房间吗？所有聊天记录将被清空！')) return;

  await supabase.from('messages').delete().neq('id', 0);
  await supabase.from('players').delete().neq('id', 0);

  alert('房间已重置，请所有人重新进入');
  location.reload();
}

// ==================== 自动清理离线玩家 ====================
window.addEventListener('load', () => {
  setInterval(async () => {
    const expire = new Date(Date.now() - 30000).toISOString();
    await supabase.from('players').delete().lt('last_seen', expire);
  }, 30000);
});
