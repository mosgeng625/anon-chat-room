// ==================== 配置区（必须修改）====================
const SUPABASE_URL = 'https://mronesaayjtjuhwvzouj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yb25lc2FheWp0anVod3Z6b3VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MTQ4NzUsImV4cCI6MjA5MjE5MDg3NX0.rejXofvcyx8iwDBx-8p01xAgQxqAn0KcyS5boCnWkIY';
const ADMIN_PASSWORD = 'admin123';

// ==================== 初始化（只执行一次）====================
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let myId = null;
let currentPrivateTarget = null;

// ==================== 登录（无验证，任何输入都能进）====================
async function enterRoom() {
    const input = document.getElementById('playerId').value.trim();
    const errorEl = document.getElementById('loginError');
    
    // 提取数字，默认1号
    let num = input.replace(/[^\d]/g, '') || '1';
    if (num < 1 || num > 8) num = '1';
    
    const id = num + '号';
    
    // 检查是否在线
    const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
    const { data: existing } = await supabase
        .from('players')
        .select('*')
        .eq('player_id', id)
        .gt('last_seen', thirtySecondsAgo)
        .single();
    
    if (existing) {
        errorEl.textContent = '该编号已被使用，请换其他编号';
        return;
    }
    
    myId = id;
    
    // 写入玩家
    await supabase.from('players').upsert({ 
        player_id: id, 
        last_seen: new Date().toISOString() 
    });
    
    // 定期更新状态
    setInterval(() => {
        supabase.from('players').upsert({ 
            player_id: id, 
            last_seen: new Date().toISOString() 
        });
    }, 10000);
    
    // 显示主界面
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('myId').textContent = '我是：' + myId;
    
    // 系统消息
    await supabase.from('messages').insert({
        type: 'system',
        from_id: 'system',
        to_id: 'all',
        content: myId + ' 进入了房间'
    });
    
    // 开始监听
    startListeners();
}

// ==================== 监听数据 ====================
function startListeners() {
    // 监听消息
    supabase.channel('messages')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadMessages())
        .subscribe();
    
    // 监听玩家
    supabase.channel('players')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => loadPlayers())
        .subscribe();
    
    loadMessages();
    loadPlayers();
}

// ==================== 加载消息 ====================
async function loadMessages() {
    const { data: messages } = await supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(100);
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
        
        if (msg.type === 'private' && msg.to_id !== myId && msg.from_id !== myId) return;
        
        const div = document.createElement('div');
        div.className = 'msg' + (msg.type === 'private' ? ' msg-private' : '');
        
        const header = document.createElement('div');
        header.className = 'msg-header';
        header.textContent = msg.type === 'private' ? '🔒 ' + msg.from_id + ' → ' + msg.to_id + ' (私聊)' : msg.from_id;
        
        const content = document.createElement('div');
        content.className = 'msg-content';
        content.textContent = msg.content;
        
        div.appendChild(header);
        div.appendChild(content);
        container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
}

// ==================== 加载玩家 ====================
async function loadPlayers() {
    const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
    const { data: players } = await supabase.from('players').select('*').gt('last_seen', thirtySecondsAgo).order('player_id');
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

// ==================== 发送消息 ====================
async function sendMessage() {
    const input = document.getElementById('msgInput');
    const content = input.value.trim();
    if (!content) return;
    
    await supabase.from('messages').insert({
        type: 'public',
        from_id: myId,
        to_id: 'all',
        content: content
    });
    
    input.value = '';
}

// ==================== 私聊 ====================
function openPrivate(targetId) {
    if (targetId === myId) {
        alert('不能给自己发私聊');
        return;
    }
    currentPrivateTarget = targetId;
    document.getElementById('privateTitle').textContent = '与 ' + targetId + ' 私聊';
    document.getElementById('privateModal').style.display = 'flex';
    loadPrivateMessages();
}

function closePrivate() {
    document.getElementById('privateModal').style.display = 'none';
    currentPrivateTarget = null;
}

async function loadPrivateMessages() {
    if (!currentPrivateTarget) return;
    
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
        div.style.cssText = 'margin-bottom:10px; padding:8px; background:' + (msg.from_id === myId ? '#e94560' : '#533483') + '; border-radius:6px;';
        div.innerHTML = `<small>${msg.from_id}</small><br>${msg.content}`;
        container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
}

async function sendPrivate() {
    const input = document.getElementById('privateInput');
    const content = input.value.trim();
    if (!content || !currentPrivateTarget) return;
    
    await supabase.from('messages').insert({
        type: 'private',
        from_id: myId,
        to_id: currentPrivateTarget,
        content: content
    });
    
    const container = document.getElementById('privateMessages');
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:10px; padding:8px; background:#e94560; border-radius:6px;';
    div.innerHTML = `<small>${myId}</small><br>${content}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    
    input.value = '';
}

// ==================== 房主控制 ====================
function showAdmin() {
    const pwd = prompt('请输入房主密码：');
    if (pwd === ADMIN_PASSWORD) {
        document.getElementById('adminModal').style.display = 'flex';
    } else if (pwd !== null) {
        alert('密码错误');
    }
}

function closeAdmin() {
    document.getElementById('adminModal').style.display = 'none';
}

async function resetRoom() {
    if (!confirm('确定要重置房间吗？所有聊天记录将被清空！')) return;
    
    await supabase.from('messages').delete().neq('id', 0);
    await supabase.from('players').delete().neq('id', 0);
    
    alert('房间已重置，请所有人重新进入');
    location.reload();
}

// ==================== 启动清理 ====================
window.onload = () => {
    setInterval(async () => {
        const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
        await supabase.from('players').delete().lt('last_seen', thirtySecondsAgo);
    }, 30000);
};
