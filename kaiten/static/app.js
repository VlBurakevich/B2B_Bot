'use strict';

const paths = {
  plus:'M12 5v14M5 12h14', chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6', close:'m6 6 12 12M6 18 18 6',
  search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  today:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M9 15l2 2 4-4',
  calendar:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 14h2M15 14h2M7 17h2',
  tasks:'M9 6h12M9 12h12M9 18h12m-18-12 1 1 2-3m-3 8 1 1 2-3m-3 8 1 1 2-3',
  board:'M3 4h5v16H3zM10 4h5v11h-5zM17 4h4v14h-4z', list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  check:'m5 12 4 4L19 6', checkCircle:'M22 11v1a10 10 0 1 1-6-9m-7 8 3 3L22 4',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  chart:'M3 3v18h18M7 15l4-5 4 3 5-8', settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  sun:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 1v2M12 21v2M1 12h2M21 12h2M4 4l1 1M19 19l1 1M4 20l1-1M19 5l1-1',
  moon:'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8', logout:'M9 21H3V3h6M8 12h13m-5-5 5 5-5 5',
  file:'M14 2H4v20h16V8zM14 2v6h6M8 13h8M8 17h5', paperclip:'m21 11-8 8a6 6 0 0 1-8-8L15 2a4 4 0 0 1 6 6L10 19a2 2 0 0 1-3-3l9-9',
  comment:'M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5', clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  flag:'M4 22V3c5-4 10 4 16 0v12c-6 4-11-4-16 0', folder:'M2 6h8l2 2h10v12H2zM2 8V4h7l2 2', dots:'M5 12h.01M12 12h.01M19 12h.01',
  arrow:'M5 12h14m-6-6 6 6-6 6', info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 11v6M12 7h.01',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', edit:'m16 3 5 5-13 13H3v-5zM14 5l5 5',
  send:'m22 2-7 20-4-9-9-4zM22 2 11 13', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  layers:'m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5', link:'m10 13 4-4M8 16l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0M13 15a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2',
  menu:'M4 6h16M4 12h16M4 18h16', sliders:'M4 7h7M15 7h5M4 17h3M11 17h9M11 4v6M7 14v6', hash:'M5 9h14M4 15h14M11 3 7 21M17 3l-4 18', panel:'M3 4h18v16H3zM9 4v16', left:'m15 5-7 7 7 7', upload:'M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5', copy:'M8 8h13v13H8zM16 8V3H3v13h5'
};
const icon = (name, cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.tasks}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const S = {user:null,sessionEpoch:0,csrf:'',projects:[],tasks:[],users:[],activity:[],today:'',view:'today',projectId:null,mode:localStorage.getItem('focus:mode') || 'list',todayMode:localStorage.getItem('focus:today-mode') || 'list',status:'all',assignee:'all',date:'all',search:'',drawer:null,modal:null,calendar:new Date(),telegram:null,authInfo:null,authPhone:null,codeRetryAt:0,accessUsers:[],accessCatalog:{},accessTab:'users',sidebarOpen:false,sidebarCollapsed:false};
const $ = (selector, parent=document) => parent.querySelector(selector);
const $$ = (selector, parent=document) => [...parent.querySelectorAll(selector)];
const priorityNames = {'4':'4% задачи','20':'20% задачи','80':'80% задачи',backlog:'Беклог'};
const statusNames = {todo:'Нужно сделать',doing:'Выполняется',done:'Выполнена'};
const colors = ['#dc4c3e','#f9a825','#4073d6','#299b74','#9b59b6','#808080'];
let toastTimer, pollTimer;

const has = permission => Boolean(S.user?.permissions?.includes(permission));
const canAssign = () => S.user?.role==='admin'&&has('tasks.assign');
const canReadTasks = () => has('projects.read')&&has('tasks.read');
const canCreateTasks = () => canReadTasks()&&has('tasks.create');
const companyView = () => S.user?.role==='admin'&&has('company.tasks.read')&&canReadTasks();
function theme(value) { document.documentElement.dataset.theme=value; localStorage.setItem('focus:theme',value);document.querySelectorAll('[data-action=theme]').forEach(button=>button.innerHTML=icon(value==='dark'?'sun':'moon')+(button.closest('.account-popover')?'Изменить тему':'')); }
theme(localStorage.getItem('focus:theme') || 'light');
function toast(message) { const el=$('#toast'); el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500); }
function clearSession(){S.sessionEpoch++;Object.assign(S,{user:null,csrf:'',projects:[],tasks:[],users:[],activity:[],accessUsers:[],accessCatalog:{},accessTab:'users',drawer:null,modal:null,authPhone:null,assignee:'all',status:'all',date:'all',search:'',projectId:null,telegram:null});clearInterval(pollTimer);$('#overlay-root').innerHTML='';}
async function api(path, options={}) {
  const epoch=S.sessionEpoch;const headers={...options.headers};
  if(options.body && !(options.body instanceof FormData)) {headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  if(options.method && options.method!=='GET') headers['X-CSRF-Token']=S.csrf;
  let response;
  try { response=await fetch('/api'+path,{...options,headers,credentials:'same-origin'}); }
  catch { throw new Error('Нет связи с сервером. Проверьте подключение и повторите.'); }
  const result=await response.json().catch(()=>({error:'Ошибка сервера. Повторите действие.'}));
  if(!response.ok) {const err=new Error(result.error || 'Не удалось выполнить действие');err.status=response.status;if(response.status===401 && S.user&&epoch===S.sessionEpoch){clearSession();renderAuth();}throw err;}
  return result;
}
const userById = id => S.users.find(u=>u.id===id) || S.accessUsers.find(u=>u.id===id) || {id,name:'Сотрудник'};
const projectById = id => S.projects.find(p=>p.id===id);
const taskById = id => S.tasks.find(t=>t.id===id);
function avatar(id,large=false) {const user=userById(id);const initials=user.name.split(/\s+/).slice(0,2).map(x=>x[0]).join('');const n=[...id].reduce((a,c)=>a+c.charCodeAt(0),0)%5;const bg=['#e9e6fc','#f4e7df','#e1efe7','#e4eaf8','#f1e4ef'][n];const fg=['#8b7bb7','#bd9584','#7e9f8d','#7d96be','#b087a5'][n];return `<span class="avatar ${large?'large':''}" style="background:${bg};color:${fg}" title="${esc(user.name)}">${esc(initials)}</span>`;}
function datePlus(days,base=S.today) {const d=new Date(base+'T12:00:00');d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function shortDate(date) {return new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.','');}
function dateLabel(date) {return !date?'Без срока':date===S.today?'Сегодня':date===datePlus(1)?'Завтра':shortDate(date);}
function dateBadge(t) {if(!t.due_date)return `<span class="due">${icon('calendar')} Без срока</span>`;const cls=t.status!=='done'?(t.due_date<S.today?'overdue':t.due_date===S.today?'today':''):'';return `<span class="due ${cls}" title="${esc(t.due_date)}${t.due_time?' '+esc(t.due_time):''}">${icon(t.due_date<S.today?'clock':'calendar')}${dateLabel(t.due_date)}${t.due_time?' · '+esc(t.due_time):''}</span>`;}
function dateTime(value){return new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});}
function statusBadge(t){return `<span class="status ${t.status}">${t.status==='doing'?'◔':t.status==='done'?'✓':'○'} ${statusNames[t.status]}</span>`;}
function mine(t){return t.assignee_id===S.user.id || t.participants.includes(S.user.id);}
function canEdit(t){const p=projectById(t.project_id);return has('tasks.edit')&&(S.user.role==='admin'||[t.created_by,t.assignee_id,p?.owner_id].includes(S.user.id)||t.participants.includes(S.user.id));}
function canManage(p){return has('projects.manage')&&has('projects.read')&&(S.user.role==='admin'||p.owner_id===S.user.id);}
function descendants(id){const result=[];function walk(pid){for(const t of S.tasks.filter(x=>x.parent_id===pid)){result.push(t);walk(t.id);}}walk(id);return result;}
function checkButton(t){const label=t.status==='done'?'Вернуть в работу':'Завершить задачу';return `<button type="button" class="check p${t.priority} ${t.status==='done'?'done':''}" data-action="toggle-task" data-id="${t.id}" aria-label="${label}" title="${label}" aria-pressed="${t.status==='done'}" ${canEdit(t)?'':'disabled'}>${t.status==='done'?icon('check'):''}</button>`;}
function priorityBadge(t){return `<span class="priority-badge"><span class="priority-dot p${t.priority}"></span>${t.priority==='backlog'?'Беклог':t.priority+'%'}</span>`;}
function empty(title,message,button=true){return `<div class="empty"><div class="empty-symbol">${icon('checkCircle')}</div><h3>${esc(title)}</h3><p>${esc(message)}</p>${button&&canCreateTasks()?`<button class="btn primary" data-action="new-task">${icon('plus')}Создать задачу</button>`:''}</div>`;}

async function boot(){
  try{
    S.authInfo=await api('/auth/state');
    let me;
    try{me=await api('/auth/me');}catch(err){if(err.status===401){renderAuth();return;}throw err;}
    S.user=me.user;S.csrf=me.csrf;await enterWorkspace();
  }catch(err){$('#app').innerHTML=`<div class="boot"><span class="brand-mark">k</span><p>${esc(err.message)}</p><button class="btn" data-action="retry">Повторить</button></div>`;}
}
function renderAuth(){
  const code=Boolean(S.authPhone),info=S.authInfo||{};
  $('#app').innerHTML=`<div class="auth-layout"><header class="auth-brand"><span class="brand-mark">k</span><span>Kaiten</span></header><section class="auth-form-side"><button class="icon-btn auth-theme" data-action="theme" aria-label="Переключить тему">${icon(document.documentElement.dataset.theme==='dark'?'sun':'moon')}</button><form id="auth-form" class="auth-form"><h2>${code?'Проверьте Telegram':'Войти'}</h2><p>${code?`Введите код для номера <b>${esc(S.authPhone)}</b>`:'Введите номер телефона, подтверждённый в нашем боте.'}</p><div id="auth-error"></div>${code?`<div class="field"><label for="auth-code">Код из Telegram</label><input id="auth-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required autofocus></div>`:`<div class="field"><label for="auth-phone">Номер телефона</label><input id="auth-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 999 123-45-67" required maxlength="40" value="${esc(S.authPhone||'')}"></div>`}<button class="btn primary" type="submit" ${info.configured?'':'disabled'}>${code?'Войти':'Получить код в Telegram'}</button>${code?`<button type="button" class="auth-resend" data-action="resend-code">Отправить код ещё раз</button><button type="button" class="auth-change" data-action="change-phone">Другой номер</button>`:''}<div class="auth-register">${info.configured&&info.bot_url?`<p>Впервые в Kaiten?</p><a class="btn" href="${esc(info.bot_url)}" target="_blank" rel="noopener">Зарегистрироваться через Telegram</a>`:'<p>Подключение общего Telegram-бота готовится.</p>'}<small>Руководитель рассмотрит заявку и откроет доступ.</small></div></form></section></div>`;
  $('#overlay-root').innerHTML='';S.drawer=null;S.modal=null;
  updateCodeCountdown();
}
function updateCodeCountdown(){const button=$('[data-action="resend-code"]');if(!button)return;const seconds=Math.max(0,Math.ceil((S.codeRetryAt-Date.now())/1000));button.disabled=seconds>0;button.textContent=seconds?`Повторить через ${seconds} сек.`:'Отправить код ещё раз';}
setInterval(updateCodeCountdown,1000);
async function loadWorkspace(){const epoch=S.sessionEpoch,user=S.user?.id;const data=await api('/workspace');if(epoch!==S.sessionEpoch||S.user?.id!==user||!S.user)return false;Object.assign(S,data);if(S.projectId&&!projectById(S.projectId)){S.projectId=null;S.view='today';}return true;}
async function enterWorkspace(){
  if(!await loadWorkspace())return;S.view=companyView()?'overview':canReadTasks()?'today':has('admin.access.manage')?'team':'settings';
  const params=new URLSearchParams(location.search);const pid=params.get('project');const view=params.get('view');
  if(pid&&projectById(pid)){S.projectId=pid;S.view='project';}
  else if(['today','mine','calendar','settings',...(companyView()?['overview']:[]),...(has('admin.access.manage')?['team']:[])].includes(view))S.view=view;
  if(S.view==='calendar'&&(!has('calendar.read')||!canReadTasks())||S.view==='team'&&!has('admin.access.manage')||S.view==='overview'&&!companyView()||['today','mine'].includes(S.view)&&!canReadTasks()||S.view==='project'&&!has('projects.read'))S.view='settings';
  renderShell();
  const task=new URLSearchParams(location.search).get('task');if(task&&taskById(task))await openTask(task);
  clearInterval(pollTimer);pollTimer=setInterval(async()=>{if(document.hidden||S.modal||S.drawer||document.querySelector('details[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;try{if(!await loadWorkspace())return;renderSidebar();renderMain();}catch{}},20000);
}
function navItem(view,label,ic,count=''){return `<button class="nav-item ${S.view===view?'active':''}" data-action="navigate" data-view="${view}">${icon(ic)}<span>${label}</span>${count!==''?`<span class="count">${count}</span>`:''}</button>`;}
function renderSidebar(){
  const todays=S.tasks.filter(t=>mine(t)&&t.status!=='done'&&t.due_date&&t.due_date<=S.today&&t.priority!=='backlog').length;
  const admin=companyView();
  $('.sidebar').innerHTML=`<div class="sidebar-account"><details class="account-menu"><summary>${avatar(S.user.id)}<span class="ellipsis">${esc(S.user.name.split(' ')[0])}</span>${icon('down')}</summary><div class="account-popover"><div class="account-info"><b>${esc(S.user.name)}</b><small>${esc(S.user.phone||'')}</small></div><button data-action="navigate" data-view="settings">${icon('settings')}Настройки</button><button data-action="theme">${icon('moon')}Изменить тему</button><div class="menu-divider"></div><button data-action="logout">${icon('logout')}Выйти</button></div></details>${canReadTasks()?`<button class="icon-btn" data-action="activity" title="Активность" aria-label="Активность проектов">${icon('bell')}</button>`:''}<button class="icon-btn" data-action="sidebar-toggle" title="Свернуть меню" aria-label="Свернуть меню">${icon('panel')}</button></div>${canCreateTasks()?`<button class="nav-item add-task-nav" data-action="new-task">${icon('plus')}<span>Добавить задачу</span></button>`:''}${canReadTasks()?`<div class="search-box">${icon('search')}<input id="global-search" placeholder="Поиск" aria-label="Поиск задач" autocomplete="off" value="${esc(S.search)}"><span class="key">⌘ K</span></div>`:''}<nav class="nav" aria-label="Главное меню">${admin?navItem('overview','Задачи компании','layers',S.tasks.filter(t=>t.status!=='done').length):''}${canReadTasks()?navItem('today','Сегодня','today',todays)+navItem('mine','Мои задачи','tasks'):''}${has('calendar.read')&&canReadTasks()?navItem('calendar','Календарь','calendar'):''}${has('admin.access.manage')?navItem('team','Доступы','users'):''}</nav>${has('projects.read')?`<div class="nav-heading"><span>${admin?'Проекты компании':'Мои проекты'}</span>${has('projects.create')?`<button class="icon-btn" data-action="new-project" aria-label="Создать проект" title="Создать проект">${icon('plus')}</button>`:''}</div><nav class="nav project-nav" aria-label="Проекты">${S.projects.map(p=>`<button class="nav-item ${S.view==='project'&&S.projectId===p.id?'active':''}" data-action="project" data-id="${p.id}" title="${esc(p.title)}"><span class="project-hash" style="color:${esc(p.color)}">${icon('hash')}</span><span class="ellipsis">${esc(p.title)}</span><span class="count">${S.tasks.filter(t=>t.project_id===p.id&&!t.parent_id&&t.status!=='done').length}</span></button>`).join('')}${!S.projects.length&&has('projects.create')?'<button class="nav-item" data-action="new-project">'+icon('plus')+'<span>Добавить проект</span></button>':''}</nav>`:''}<div class="sidebar-bottom"><div class="sidebar-footer"><span class="brand"><span class="brand-mark">k</span>Kaiten</span><span class="environment-label">Тестовая версия</span><button class="icon-btn" data-action="navigate" data-view="settings" title="Настройки" aria-label="Настройки">${icon('settings')}</button></div></div>`;
}
function viewTitle(){return S.search?'Результаты поиска':({today:'Сегодня',mine:'Мои задачи',overview:'Задачи компании',team:'Доступы',settings:'Настройки',calendar:'Календарь',project:projectById(S.projectId)?.title})[S.view]||'Kaiten';}
function renderShell(){
  $('#app').innerHTML=`<div class="shell ${S.user.role==='admin'?'admin-shell':'employee-shell'}"><div class="sidebar-shade" data-action="sidebar-close"></div><aside class="sidebar"></aside><main class="main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn menu-toggle" data-action="sidebar-toggle" aria-label="Открыть меню" title="Меню">${icon('panel')}</button><b id="breadcrumb-title"></b></div><div class="top-actions"></div></header><div id="main-content" class="content"></div></main></div>`;
  renderSidebar();renderMain();syncSidebar();
}
function syncSidebar(){const shell=$('.shell');if(!shell)return;const mobile=innerWidth<=800;const hidden=mobile?!S.sidebarOpen:S.sidebarCollapsed;$('.sidebar').inert=hidden;shell.classList.toggle('sidebar-open',mobile&&S.sidebarOpen);shell.classList.toggle('sidebar-collapsed',!mobile&&S.sidebarCollapsed);$('.menu-toggle')?.setAttribute('aria-expanded',String(!hidden));}
window.addEventListener('resize',syncSidebar);
function heading(title,subtitle,actions='',eyebrow=''){return `<div class="page-heading"><div><h1>${title}</h1>${subtitle?`<p class="heading-subtitle">${subtitle}</p>`:''}</div><div class="heading-buttons">${actions}</div></div>`;}
function newTaskButton(){return '';}
function stats(tasks){const open=tasks.filter(t=>t.status!=='done');const done=tasks.filter(t=>t.status==='done').length;const overdue=open.filter(t=>t.due_date&&t.due_date<S.today).length;const doing=open.filter(t=>t.status==='doing').length;return `<div class="stats">${[
  ['Всего задач',tasks.length,'Во всех приоритетах','tasks','purple'],['В работе',doing,'Двигаемся к результату','clock',''],['Завершено',done,tasks.length?Math.round(done/tasks.length*100)+'% от всех задач':'Пока нет завершённых задач','checkCircle','green'],['Просрочено',overdue,overdue?'Требуют вашего внимания':'Всё идёт по плану','flag','red']
].map(([title,n,caption,ic,cls])=>`<div class="stat ${cls}" title="${title}"><div class="stat-top">${title}<span class="stat-icon">${icon(ic)}</span></div><div class="stat-num">${n}</div></div>`).join('')}</div>`;}
function filteredTasks(base){return base.filter(t=>{
  if(S.status==='open'&&t.status==='done'||STATUSES_CLIENT.includes(S.status)&&t.status!==S.status)return false;
  if(S.assignee==='me'&&!mine(t)||S.assignee!=='all'&&S.assignee!=='me'&&t.assignee_id!==S.assignee)return false;
  if(S.date==='today'&&t.due_date!==S.today||S.date==='tomorrow'&&t.due_date!==datePlus(1)||S.date==='overdue'&&(!t.due_date||t.due_date>=S.today||t.status==='done'))return false;
  return true;
});}
const STATUSES_CLIENT=['todo','doing','done'];
function displayMenu(scope='workspace'){
  const mode=scope==='today'?S.todayMode:S.mode;
  return `<details class="display-menu"><summary aria-label="Отображение">${icon('sliders')}<span>Отображение</span></summary><div class="display-popover"><span class="popover-label">Вид</span><div class="layout-options" role="group" aria-label="Вид задач">${[['list','list','Список'],['board','board','Канбан']].map(([value,ic,label])=>`<button class="layout-option ${mode===value?'active':''}" data-action="mode" data-scope="${scope}" data-mode="${value}" aria-label="${label}" aria-pressed="${mode===value}">${icon(ic)}<span>${label}</span>${mode===value?icon('check'):''}</button>`).join('')}</div><div class="display-group">Группировка <strong>Важность</strong></div></div></details>`;
}
function toolbar({filters=true}={}){return filters?`<div class="toolbar"><div class="filters"><label class="select-wrap">${icon('users')}<select id="filter-assignee" aria-label="Исполнитель"><option value="all" ${S.assignee==='all'?'selected':''}>Все сотрудники</option><option value="me" ${S.assignee==='me'?'selected':''}>Мои задачи</option>${S.users.filter(u=>u.active).map(u=>`<option value="${u.id}" ${S.assignee===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label><label class="select-wrap"><select id="filter-status" aria-label="Статус"><option value="open" ${S.status==='open'?'selected':''}>Незавершённые</option><option value="all" ${S.status==='all'?'selected':''}>Все статусы</option>${Object.entries(statusNames).map(([v,n])=>`<option value="${v}" ${S.status===v?'selected':''}>${n}</option>`).join('')}</select></label><label class="select-wrap"><select id="filter-date" aria-label="Срок"><option value="all" ${S.date==='all'?'selected':''}>Любой срок</option><option value="today" ${S.date==='today'?'selected':''}>Сегодня</option><option value="tomorrow" ${S.date==='tomorrow'?'selected':''}>Завтра</option><option value="overdue" ${S.date==='overdue'?'selected':''}>Просроченные</option></select></label></div></div>`:'';}
function taskCard(t){
  const p=projectById(t.project_id),children=descendants(t.id),completed=children.filter(x=>x.status==='done').length;
  return `<article class="task-card" draggable="${canEdit(t)}" data-task="${t.id}" tabindex="0" role="button" aria-label="Открыть задачу: ${esc(t.title)}"><div class="card-title">${checkButton(t)}<span class="${t.status==='done'?'done-title':''}">${esc(t.title)}</span></div>${t.description?`<div class="card-description">${esc(t.description.slice(0,100))}</div>`:''}<div class="card-details">${t.due_date?dateBadge(t):''}${t.status==='doing'?statusBadge(t):''}${children.length?`<span class="task-meta" title="Подзадачи">${icon('tasks')}${completed}/${children.length}</span>`:''}${t.comments_count?`<span class="task-meta" title="Комментарии">${icon('comment')}${t.comments_count}</span>`:''}${t.files_count?`<span class="task-meta" title="Файлы">${icon('paperclip')}${t.files_count}</span>`:''}</div><div class="card-bottom">${S.view!=='project'?`<span class="project-chip">${icon('hash')}<span class="ellipsis">${esc(p?.title)}</span></span>`:'<span></span>'}<span class="avatar-stack">${[...new Set([t.assignee_id,...t.participants])].slice(0,3).map(id=>avatar(id)).join('')}</span></div></article>`;
}
function addTaskLink(priority){if(!canCreateTasks())return '';return `<button class="add-task-inline" data-action="new-task" data-priority="${priority}">${icon('plus')}Добавить задачу</button>`;}
function board(tasks,priorities=Object.keys(priorityNames)){return `<div class="board ${priorities.length===3?'board-three':''}">${priorities.map(key=>{const grouped=tasks.filter(t=>t.priority===key);return `<section class="column" data-column="${key}"><div class="column-header"><h2>${key==='backlog'?'Беклог':key+'%'}<span class="column-number">${grouped.length}</span></h2>${canCreateTasks()?`<button class="icon-btn" data-action="new-task" data-priority="${key}" title="Добавить задачу" aria-label="Добавить задачу в ${priorityNames[key]}">${icon('plus')}</button>`:''}</div>${grouped.map(taskCard).join('')}${addTaskLink(key)}</section>`;}).join('')}</div>`;}
function taskRow(t,depth=0){
  const p=projectById(t.project_id),children=S.tasks.filter(x=>x.parent_id===t.id);
  return `<div class="task-row" data-task="${t.id}" role="button" tabindex="0" aria-label="Открыть задачу: ${esc(t.title)}" style="--depth:${Math.min(depth,5)}"><div class="row-check">${checkButton(t)}</div><div class="row-content"><div class="row-title"><span class="${t.status==='done'?'done-title':''}">${esc(t.title)}</span><span class="row-actions">${icon('edit')}${icon('dots')}</span></div>${t.description?`<p class="row-description">${esc(t.description.slice(0,150))}</p>`:''}<div class="row-meta">${t.due_date?dateBadge(t):''}${t.status==='doing'?statusBadge(t):t.status==='done'?'<span class="completed-label">Выполнена</span>':''}${children.length?`<span class="task-meta" title="Подзадачи">${icon('tasks')}${children.filter(x=>x.status==='done').length}/${children.length}</span>`:''}${t.comments_count?`<span class="task-meta" title="Комментарии">${icon('comment')}${t.comments_count}</span>`:''}${t.files_count?`<span class="task-meta" title="Вложения">${icon('paperclip')}${t.files_count}</span>`:''}${t.parent_id?`<span class="parent-name">${icon('layers')}${esc(taskById(t.parent_id)?.title)}</span>`:''}<span class="row-project">${S.view!=='project'?`${esc(p?.title)}<span style="color:${esc(p?.color)}">${icon('hash')}</span>`:''}</span>${S.view==='overview'||t.assignee_id!==S.user.id?avatar(t.assignee_id):''}</div></div></div>`;
}
function list(tasks,nest=false){const set=new Set(tasks.map(t=>t.id)),ordered=[];function walk(items,depth){for(const t of items){ordered.push(taskRow(t,depth));if(nest)walk(tasks.filter(x=>x.parent_id===t.id),depth+1);}}walk(nest?tasks.filter(t=>!t.parent_id||!set.has(t.parent_id)):tasks,0);return `<div class="list">${ordered.join('')}${!tasks.length?'<div class="list-empty">Задач с такими фильтрами нет</div>':''}</div>`;}
function renderMain(){
  const main=$('#main-content');if(!main)return;
  $('#breadcrumb-title').textContent=S.view==='project'?viewTitle():'';document.title=viewTitle()+' — Kaiten';$('.top-actions').innerHTML=['today','mine','overview','project'].includes(S.view)?displayMenu(S.view==='today'?'today':'workspace'):'';main.className='content '+((S.view==='today'?S.todayMode:S.mode)==='board'&&!['team','settings','calendar'].includes(S.view)?'board-content':'list-content')+' '+S.view+'-content';
  if(S.search){const term=S.search.toLocaleLowerCase('ru');const tasks=S.tasks.filter(t=>(t.title+' '+t.description).toLocaleLowerCase('ru').includes(term));main.innerHTML=heading('Результаты поиска',`По запросу «${esc(S.search)}» найдено: ${tasks.length}`,`<button class="btn" data-action="clear-search">${icon('close')}Сбросить</button>`)+list(tasks);return;}
  if(S.view==='project'){renderProject(main);return;}
  if(S.view==='today'){renderToday(main);return;}
  if(S.view==='mine'){const base=S.tasks.filter(mine);main.innerHTML=heading('Мои задачи',`${base.filter(t=>t.status!=='done').length} ${plural(base.filter(t=>t.status!=='done').length,'задача','задачи','задач')}`,newTaskButton(),'ЛИЧНОЕ ПРОСТРАНСТВО')+toolbar()+(base.length?(S.mode==='board'?board(filteredTasks(base).filter(t=>!t.parent_id||!mine(taskById(t.parent_id)||{participants:[]}))):priorityList(filteredTasks(base),Object.keys(priorityNames),true)):empty('Начните с одной задачи','Создайте задачу для себя в одном из проектов.'));return;}
  if(S.view==='overview'){renderOverview(main);return;}
  if(S.view==='team'){renderTeam(main);return;}
  if(S.view==='settings'){renderSettings(main);return;}
  if(S.view==='calendar'){renderCalendar(main);return;}
}
function renderProject(main){
  const p=projectById(S.projectId);if(!p){navigate('today');return;}
  const tasks=S.tasks.filter(t=>t.project_id===p.id);
  const buttons=`<div class="avatar-stack">${p.members.slice(0,4).map(id=>avatar(id,true)).join('')}</div>${canManage(p)?`<button class="btn action-square" data-action="edit-project" data-id="${p.id}" title="Участники проекта" aria-label="Участники">${icon('users')}</button>`:''}${newTaskButton()}`;
  main.innerHTML=heading(`<span class="project-heading-hash" style="color:${esc(p.color)}">${icon('hash')}</span>${esc(p.title)}`,'',buttons)+toolbar()+(S.mode==='board'?board(filteredTasks(tasks).filter(t=>!t.parent_id)):priorityList(filteredTasks(tasks),Object.keys(priorityNames),true));
}
function renderToday(main){
  const priorities=['4','20','80'];
  const relevant=S.tasks.filter(t=>mine(t)&&t.due_date&&t.due_date<=S.today&&priorities.includes(t.priority));
  const count=relevant.filter(t=>t.status!=='done').length;
  
  main.innerHTML=heading('Сегодня',`${icon('checkCircle')} ${count} ${plural(count,'задача','задачи','задач')}`, '')+toolbar({scope:'today',filters:false})+(S.todayMode==='board'?board(relevant,priorities):priorityList(relevant,priorities));
}
function priorityList(tasks,priorities,nest=false){return `<div class="priority-list">${priorities.map(priority=>{
  const grouped=tasks.filter(t=>t.priority===priority),label=priority==='backlog'?'Беклог':priority+'%';
  return `<section class="priority-list-group" data-priority="${priority}" aria-label="${priorityNames[priority]}"><div class="priority-list-heading"><h2>${label}<span class="column-number">${grouped.length}</span></h2>${canCreateTasks()?`<button class="icon-btn" data-action="new-task" data-priority="${priority}" title="Добавить задачу" aria-label="Добавить задачу в ${priorityNames[priority]}">${icon('plus')}</button>`:''}</div>${grouped.length?list(grouped,nest):''}${addTaskLink(priority)}</section>`;
}).join('')}</div>`;}
function plural(n,a,b,c){return n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?b:c;}
function sortTasks(tasks){const keys=['4','20','80','backlog'];return [...tasks].sort((a,b)=>keys.indexOf(a.priority)-keys.indexOf(b.priority)||(a.due_date||'').localeCompare(b.due_date||''));}
function renderOverview(main){
  const active=S.users.filter(u=>u.active),tasks=filteredTasks(S.tasks);
  const open=S.tasks.filter(t=>t.status!=='done'),overdue=open.filter(t=>t.due_date&&t.due_date<S.today);
  main.innerHTML=heading('Задачи компании',`${open.length} ${plural(open.length,'активная задача','активные задачи','активных задач')} <span class="heading-dot">·</span> <span class="${overdue.length?'overdue-text':''}">${overdue.length} просрочено</span>`,newTaskButton())+`<div class="people-filter" role="group" aria-label="Фильтр по сотруднику"><button class="person-chip ${S.assignee==='all'?'active':''}" data-action="filter-person" data-id="all">${icon('users')}Все сотрудники<span>${open.length}</span></button>${active.map(u=>`<button class="person-chip ${S.assignee===u.id?'active':''}" data-action="filter-person" data-id="${u.id}">${avatar(u.id)}${esc(u.name.split(' ')[0])}<span>${open.filter(t=>t.assignee_id===u.id).length}</span></button>`).join('')}</div>`+toolbar()+(S.mode==='board'?board(tasks.filter(t=>!t.parent_id||!tasks.some(p=>p.id===t.parent_id))):priorityList(tasks,Object.keys(priorityNames),true));
}
function eventsMarkup(events){return events.map(e=>`<div class="event">${avatar(e.user_id||'unknown')}<div><p><b>${esc(e.user_name||'Сотрудник')}</b> · ${esc(e.text)}</p><small>${dateTime(e.created_at)} · ${esc(projectById(e.project_id)?.title||'')}</small></div></div>`).join('');}
function renderTeam(main){
  if(!has('admin.access.manage')){navigate('settings');return;}
  main.innerHTML=heading('Доступы','Заявки и права участников')+`<div class="access-tabs"><button class="${S.accessTab==='users'?'active':''}" data-action="access-tab" data-tab="users">Участники</button><button class="${S.accessTab==='audit'?'active':''}" data-action="access-tab" data-tab="audit">Журнал</button></div><div id="access-content" class="muted">Загрузка…</div>`;
  if(S.accessTab==='audit')showAccessAudit().catch(err=>toast(err.message));else loadAccess();
}
async function loadAccess(){
  try{const epoch=S.sessionEpoch;const data=await api('/access');if(epoch!==S.sessionEpoch||!S.user)return;S.accessUsers=data.users;S.accessCatalog=data.catalog;const root=$('#access-content');if(!root)return;
    root.innerHTML=`<div class="access-list">${data.users.map(u=>`<button class="access-person ${u.linked_to?'archived':''}" data-action="edit-access" data-id="${u.id}">${avatar(u.id,true)}<span><strong>${esc(u.name)}</strong><small>${esc(u.phone||'Контакт Telegram ещё не подтверждён')}</small></span><span class="access-state ${u.status}">${u.linked_to?'Связана с аккаунтом':{pending:'Ожидает',active:'Активен',blocked:'Заблокирован'}[u.status]}</span>${icon('chevron')}</button>`).join('')}</div>`;
  }catch(err){toast(err.message);}
}
function accessModal(id){
  const u=S.accessUsers.find(x=>x.id===id);if(!u)return;
  modal(u.name,`<form id="access-form" data-id="${u.id}" data-version="${u.access_version}"><div class="identity-summary"><span>${esc(u.phone||'Телефон не привязан')}</span><small>Telegram ID: ${esc(u.telegram_id||'—')} · ${u.telegram_username?'@'+esc(u.telegram_username):'без username'}</small><small>ID аккаунта: ${esc(u.id)}</small>${u.registered_at?`<small>Регистрация: ${dateTime(u.registered_at)}</small>`:''}${u.reviewed_at?`<small>Рассмотрено: ${dateTime(u.reviewed_at)}</small>`:''}${u.updated_at?`<small>Изменено: ${dateTime(u.updated_at)}</small>`:''}</div>${u.linked_to?`<p class="attention-line">Историческая карточка сохранена. Основной аккаунт: ${esc(u.linked_to)}</p><button type="button" class="btn" data-action="close-modal">Закрыть</button>`:`<div class="form-grid"><div class="field"><label for="access-status">Статус</label><select name="status" id="access-status">${[['pending','Ожидает'],['active','Активен'],['blocked','Заблокирован']].map(([v,n])=>`<option value="${v}" ${u.status===v?'selected':''}>${n}</option>`).join('')}</select></div><div class="field"><label for="access-role">Роль</label><select name="role" id="access-role"><option value="employee" ${u.role==='employee'?'selected':''}>Сотрудник</option><option value="admin" ${u.role==='admin'?'selected':''}>Руководитель</option></select></div></div><div class="field"><label>Права</label><div class="permission-presets"><button type="button" class="btn small" data-action="permission-preset" data-preset="employee">Сотрудник</button><button type="button" class="btn small" data-action="permission-preset" data-preset="admin">Руководитель</button><button type="button" class="btn small" data-action="permission-preset" data-preset="none">Снять все</button></div><div class="permissions-list">${Object.entries(S.accessCatalog).map(([key,label])=>`<label><input type="checkbox" name="permissions" value="${esc(key)}" ${u.permissions.includes(key)?'checked':''}>${esc(label)}</label>`).join('')}</div></div><button type="button" class="btn danger small" data-action="revoke-sessions" data-id="${u.id}" data-version="${u.access_version}">Завершить все сессии</button>${modalFooter(u.status==='pending'?'Применить решение':'Сохранить доступ')}`}</form>`);
}
async function showAccessAudit(){
  const root=$('#access-content');if(!root)return;root.textContent='Загрузка…';
  const {events}=await api('/access/audit');
  const names={'auth.login':'Вход','auth.logout':'Выход','auth.failed':'Неудачная попытка входа','auth.code_requested':'Запрошен код','auth.delivery_failed':'Доставка кода недоступна','access.changed':'Изменён доступ','sessions.revoked':'Завершены сессии','registration.pending':'Новая заявка','telegram.contact_verified':'Контакт подтверждён','identity.existing_bound':'Привязан существующий аккаунт','migration.phone_only':'Переход на вход через Telegram'};
  root.innerHTML=events.map(e=>`<div class="audit-event"><div><b>${esc(names[e.action]||e.action)}</b><span>${esc(e.subject_name||'')} ${e.actor_name?'· '+esc(e.actor_name):''}</span>${e.action==='access.changed'?`<small>${esc(e.detail.before.permissions.map(p=>S.accessCatalog[p]||p).join(', '))} → ${esc(e.detail.after.permissions.map(p=>S.accessCatalog[p]||p).join(', '))}</small>`:''}</div><time>${dateTime(e.created_at)}</time></div>`).join('')||'<p class="muted">Событий пока нет.</p>';
}
function renderSettings(main){
  main.innerHTML=heading('Настройки','')+`<div class="settings-grid"><section class="panel"><h2>Аккаунт</h2><form id="profile-form"><div class="field"><label for="profile-name">Имя</label><input id="profile-name" name="name" value="${esc(S.user.name)}" required maxlength="80"></div><div class="field"><label>Телефон</label><input value="${esc(S.user.phone||'')}" disabled></div><div class="field"><label>Telegram</label><input value="${esc(S.user.telegram_username?'@'+S.user.telegram_username:S.user.telegram_id||'Подтверждён')}" disabled></div><button class="btn primary" type="submit">Сохранить</button></form></section><div><section class="panel"><h2>Оформление</h2><div class="theme-options">${['light','dark'].map(t=>`<button class="theme-option ${document.documentElement.dataset.theme===t?'active':''}" data-action="set-theme" data-theme="${t}">${icon(t==='light'?'sun':'moon')}${t==='light'?'Светлая':'Тёмная'}</button>`).join('')}</div></section><section class="panel section-gap"><h2>Telegram</h2><p class="settings-note">Коды входа приходят в подтверждённый личный чат. Смена номера и привязки — через руководителя.</p><div id="telegram-settings"></div></section><section class="panel section-gap"><h2>Часовой пояс</h2><p class="settings-note">Москва · UTC+3</p></section></div></div>`;
  api('/telegram').then(t=>{const el=$('#telegram-settings');if(el)el.innerHTML=`<button class="btn" data-action="notification-toggle" data-enabled="${t.enabled?'1':'0'}">${t.enabled?'Приостановить':'Включить'} уведомления о задачах</button>`;}).catch(err=>toast(err.message));
}
function renderCalendar(main){
  const year=S.calendar.getFullYear(), month=S.calendar.getMonth();const first=new Date(year,month,1);const offset=(first.getDay()+6)%7;const start=new Date(year,month,1-offset);const title=first.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const tasks=S.tasks.filter(t=>t.due_date&&(S.user.role==='admin'||mine(t)));
  const cells=Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const items=sortTasks(tasks.filter(t=>t.due_date===date));return `<div class="calendar-cell ${d.getMonth()!==month?'out':''}"><span class="calendar-day ${date===S.today?'is-today':''}">${d.getDate()}</span>${items.map(t=>`<button class="calendar-task ${t.status==='done'?'is-done':''}" data-action="open-task" data-id="${t.id}" title="${esc(t.title)}">${esc(t.title)}</button>`).join('')}</div>`;});
  main.innerHTML=heading('Календарь',S.user.role==='admin'?'Сроки задач всей команды, включая подзадачи.':'Все ваши сроки, включая подзадачи.',newTaskButton(),'ПЛАНИРУЙТЕ ВАЖНОЕ')+`<div class="calendar-shell"><div class="calendar-head"><h2>${title.charAt(0).toUpperCase()+title.slice(1)}</h2><div><button class="icon-btn" data-action="calendar-prev" aria-label="Предыдущий месяц">${icon('left')}</button><button class="btn small" data-action="calendar-now">Сегодня</button><button class="icon-btn" data-action="calendar-next" aria-label="Следующий месяц">${icon('chevron')}</button></div></div><div class="calendar-days">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>`<div>${x}</div>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div></div>`;
}
function navigate(view,pid=null){if(view==='overview'&&!companyView()||view==='team'&&!has('admin.access.manage')||view==='calendar'&&(!has('calendar.read')||!canReadTasks())||['today','mine'].includes(view)&&!canReadTasks()||view==='project'&&!has('projects.read')){toast('Нет доступа к разделу');return;}S.view=view;S.projectId=pid;S.search='';S.sidebarOpen=false;syncSidebar();S.status='all';S.assignee='all';S.date='all';const search=$('#global-search');if(search)search.value='';renderSidebar();renderMain();const params=new URLSearchParams(view==='project'?{project:pid}:{view});history.replaceState({},'',location.pathname+'?'+params);window.scrollTo(0,0);}

function modal(title,content){S.modal=true;const root=$('#overlay-root');root.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-btn" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></header><div class="modal-body">${content}</div></section></div>`);setTimeout(()=>$('input:not([type=hidden]), textarea, select',$('#modal-backdrop'))?.focus(),30);}
function closeModal(){S.modal=null;$('#modal-backdrop')?.remove();}
function modalFooter(label='Создать'){return `<div class="form-error" id="modal-error" role="alert"></div><div class="modal-footer"><button class="btn" type="button" data-action="close-modal">Отмена</button><button class="btn primary" type="submit">${label}</button></div>`;}
function projectModal(id=null){
  const p=id?projectById(id):null;if(p&&!canManage(p))return;
  modal(p?'Настройки проекта':'Новый проект',`<form id="project-form" data-id="${p?.id||''}"><div class="field"><label for="project-title">Название</label><input id="project-title" name="title" placeholder="Например, запуск нового продукта" value="${esc(p?.title||'')}" required maxlength="100"></div><div class="field"><label for="project-description">Описание</label><textarea id="project-description" name="description" placeholder="Для чего этот проект?" maxlength="5000">${esc(p?.description||'')}</textarea></div>${!p?`<div class="field"><label>Цвет проекта</label><input type="hidden" name="color" value="${colors[0]}"><div class="project-color-list">${colors.map((c,i)=>`<button class="color-swatch ${!i?'active':''}" style="background:${c}" type="button" data-action="color" data-color="${c}" aria-label="Цвет ${c}"></button>`).join('')}</div></div>`:`<div class="field"><label>Участники проекта</label><small>Участники видят все задачи, комментарии и файлы проекта. Автор проекта остаётся участником.</small><div class="checkbox-list">${S.users.filter(u=>u.active).map(u=>`<label class="checkbox-choice"><input type="checkbox" name="members" value="${u.id}" ${p.members.includes(u.id)?'checked':''} ${u.id===p.owner_id?'disabled':''}>${esc(u.name)}</label>`).join('')}</div></div><button type="button" class="btn danger small" data-action="delete-project" data-id="${p.id}">${icon('trash')}Удалить проект</button>`}${modalFooter(p?'Сохранить':'Создать проект')}</form>`);
}
function dateFields(task={},prefix='task') {return `<div class="field"><label for="${prefix}-due">Срок</label><input id="${prefix}-due" type="date" name="due_date" value="${esc(task.due_date||'')}" max="9999-12-31"><div class="inline-options"><button type="button" class="date-chip ${task.due_date===S.today?'active':''}" data-action="quick-date" data-date="${S.today}">Сегодня</button><button type="button" class="date-chip ${task.due_date===datePlus(1)?'active':''}" data-action="quick-date" data-date="${datePlus(1)}">Завтра</button><button type="button" class="date-chip" data-action="quick-date" data-date="">Без срока</button></div></div><div class="field"><label for="${prefix}-time">Время <span class="muted">· необязательно</span></label><input id="${prefix}-time" type="time" name="due_time" value="${esc(task.due_time||'')}"><small>По московскому времени</small></div>`;}
function assigneeOptions(pid,current=S.user.id){return (projectById(pid)?.members||[]).map(id=>userById(id)).filter(u=>u.active).map(u=>`<option value="${u.id}" ${u.id===current?'selected':''}>${esc(u.name)}${u.id===S.user.id?' (я)':''}</option>`).join('');}
function participantsField(pid,selected=[]){return `<div class="field"><label>Совместное решение</label><div class="checkbox-list" id="task-participants">${(projectById(pid)?.members||[]).filter(id=>userById(id).active).map(id=>`<label class="checkbox-choice"><input type="checkbox" name="participants" value="${id}" ${selected.includes(id)?'checked':''}>${esc(userById(id).name)}${id===S.user.id?' (я)':''}</label>`).join('')||'<span class="muted small">Других участников пока нет. Добавьте их в настройках проекта.</span>'}</div></div>`;}
function taskModal(priority='backlog',parentId=null){
  if(!canCreateTasks())return;
  if(!S.projects.length){toast('Сначала создайте проект');projectModal();return;}
  const parent=taskById(parentId),pid=parent?.project_id||S.projectId||S.projects.find(p=>p.members.includes(S.user.id))?.id||S.projects[0].id;
  const selected=parent?.priority||priority,initial=S.view==='today'?{due_date:S.today}:{};
  modal(parent?'Добавить подзадачу':'Добавить задачу',`<form id="task-form" class="quick-task-form" data-parent="${parentId||''}">${parent?`<div class="quick-parent">${icon('layers')}${esc(parent.title)}</div>`:''}<input id="task-title" class="quick-title" name="title" placeholder="Название задачи" aria-label="Название" required maxlength="300"><textarea id="task-description" name="description" class="quick-description" placeholder="Описание" aria-label="Описание" maxlength="20000"></textarea><div class="quick-options"><details class="quick-date-menu"><summary>${icon('calendar')}<span>${initial.due_date?'Сегодня':'Дата'}</span></summary><div class="date-popover">${dateFields(initial,'new-task')}</div></details><label class="quick-select">${icon('flag')}<select id="task-priority" name="priority" aria-label="Важность">${Object.entries(priorityNames).filter(([v])=>S.view!=='today'||v!=='backlog').map(([v,n])=>`<option value="${v}" ${v===selected?'selected':''}>${n}</option>`).join('')}</select></label>${canAssign()?`<label class="quick-select">${icon('users')}<select id="task-assignee" name="assignee_id" aria-label="Ответственный">${assigneeOptions(pid,parent?.assignee_id||S.user.id)}</select></label>`:`<select id="task-assignee" name="assignee_id" class="visually-hidden" disabled>${assigneeOptions(pid,S.user.id)}</select>`}</div><details class="quick-extra"><summary>Ещё ${icon('down')}</summary><div class="field"><label for="task-status">Статус</label><select id="task-status" name="status">${Object.entries(statusNames).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></div>${participantsField(pid)}</details><div class="form-error" id="modal-error" role="alert"></div><div class="modal-footer quick-footer"><label class="quick-project">${icon('hash')}<select id="task-project" name="project_id" aria-label="Проект" ${parent?'disabled':''}>${S.projects.map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label><button class="btn" type="button" data-action="close-modal">Отмена</button><button class="btn primary" type="submit">${parent?'Добавить подзадачу':'Добавить задачу'}</button></div></form>`);
  $('#modal-backdrop .modal').classList.add('quick-modal');
}
async function openTask(id){
  try{const epoch=S.sessionEpoch;const t=await api('/tasks/'+id);if(epoch!==S.sessionEpoch||!S.user)return;S.drawer=t;renderDrawer();}catch(err){toast(err.message);}
}
function renderDrawer(){
  $('#drawer-root')?.remove();const t=S.drawer;if(!t)return;const p=projectById(t.project_id),editable=canEdit(t),children=S.tasks.filter(x=>x.parent_id===t.id),done=descendants(t.id).filter(x=>x.status==='done').length,total=descendants(t.id).length;
  const properties=`<fieldset class="no-border" ${editable?'':'disabled'}><div class="field"><label for="detail-status">Статус</label><select id="detail-status" name="status">${Object.entries(statusNames).map(([v,n])=>`<option value="${v}" ${t.status===v?'selected':''}>${n}</option>`).join('')}</select></div><div class="field"><label for="detail-assignee">Ответственный</label><select id="detail-assignee" name="assignee_id" ${canAssign()?'':'disabled'}>${assigneeOptions(t.project_id,t.assignee_id)}</select></div><div class="field"><label for="detail-priority">Важность</label><select id="detail-priority" name="priority">${Object.entries(priorityNames).map(([v,n])=>`<option value="${v}" ${t.priority===v?'selected':''}>${n}</option>`).join('')}</select></div>${dateFields(t,'detail')}${participantsField(t.project_id,t.participants)}<div class="property-author"><span>Создал(а)</span><div>${avatar(t.created_by)}${esc(userById(t.created_by).name)}</div></div></fieldset>`;
  const side=properties.replace(/<(input|select|textarea)\b/g,'<$1 form="detail-form"');
  $('#overlay-root').insertAdjacentHTML('afterbegin',`<div id="drawer-root"><div class="drawer-backdrop" data-action="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Задача ${esc(t.title)}"><header class="drawer-head"><div class="drawer-breadcrumb"><span style="color:${esc(p?.color)}">${icon('hash')}</span><span class="ellipsis">${esc(p?.title)}</span>${t.parent_id?`${icon('chevron')}<button class="icon-btn small" data-action="open-task" data-id="${t.parent_id}">Родительская задача</button>`:''}</div><div><button class="icon-btn" data-action="reload-task" data-id="${t.id}" aria-label="Обновить задачу" title="Обновить задачу">${icon('clock')}</button><button class="icon-btn" data-action="close-drawer" aria-label="Закрыть задачу">${icon('close')}</button></div></header><div class="task-detail-layout"><div class="drawer-body"><form id="detail-form" data-id="${t.id}" data-version="${t.version}"><fieldset class="no-border" ${editable?'':'disabled'}><div class="detail-title-row">${checkButton(t)}<label class="visually-hidden" for="detail-title">Задача</label><textarea id="detail-title" name="title" rows="1" required maxlength="300">${esc(t.title)}</textarea></div><div class="field detail-description"><label class="visually-hidden" for="detail-description">Описание</label><textarea id="detail-description" name="description" placeholder="Описание" maxlength="20000">${esc(t.description)}</textarea></div><div class="form-error" id="detail-error" role="alert"></div>${!editable?'<p class="attention-line">Редактировать задачу могут её участники. Вы можете оставить комментарий.</p>':''}</fieldset></form><section class="drawer-section"><div class="drawer-section-head"><h3>Подзадачи <span class="muted">${total?`${done}/${total}`:''}</span></h3>${editable&&has('tasks.create')?`<button class="icon-btn" data-action="new-subtask" data-id="${t.id}">${icon('plus')}Добавить</button>`:''}</div>${children.map(c=>`<div class="subtask-item">${checkButton(c)}<div class="subtask-title" data-task="${c.id}" role="button" tabindex="0"><span class="${c.status==='done'?'done-title':''}">${esc(c.title)}</span><small>${esc(userById(c.assignee_id).name)} · ${dateLabel(c.due_date)}</small></div>${statusBadge(c)}</div>`).join('')||''}</section><section class="drawer-section"><div class="drawer-section-head"><h3>Файлы <span class="muted">${t.files.length||''}</span></h3></div>${t.files.map(f=>`<div class="file-item">${icon('file')}<a href="/api/files/${f.id}" download>${esc(f.name)}<small>${fileSize(f.size)} · ${esc(f.user_name)}</small></a>${editable&&has('files.upload')?`<button class="icon-btn" data-action="delete-file" data-id="${f.id}" title="Удалить файл" aria-label="Удалить файл">${icon('trash')}</button>`:''}</div>`).join('')}${editable&&has('files.upload')?`<label class="upload-zone" for="file-upload">${icon('upload')}Прикрепить файл до 25 МБ<input type="file" id="file-upload" class="visually-hidden" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.odt,.ods"></label><p class="muted small" id="upload-status" style="margin-top:8px"></p>`:!t.files.length?'<p class="muted small">Вложений пока нет.</p>':''}</section><section class="drawer-section"><div class="drawer-section-head"><h3>Комментарии <span class="muted">${t.comments.length||''}</span></h3></div>${t.comments.map(c=>`<div class="comment">${avatar(c.user_id)}<div class="comment-main"><div class="comment-meta"><b>${esc(c.user_name)}</b><time>${dateTime(c.created_at)}</time></div><p class="comment-body">${esc(c.body)}</p></div></div>`).join('')}${has('comments.create')?`<form id="comment-form" class="comment-form" data-id="${t.id}"><textarea name="body" aria-label="Комментарий" placeholder="Обсудите задачу с коллегами…" maxlength="10000" required></textarea><button class="btn" type="submit" title="Отправить комментарий" aria-label="Отправить комментарий">${icon('send')}</button></form>`:''}</section></div><aside class="task-properties" aria-label="Параметры задачи">${side}</aside></div><footer class="drawer-footer"><div class="detail-footer-actions">${editable?'<button class="btn primary small" type="submit" form="detail-form">Сохранить изменения</button>':''}<small>Создано ${dateTime(t.created_at)}</small></div>${editable?`<button class="icon-btn" data-action="delete-task" data-id="${t.id}" title="Удалить задачу" aria-label="Удалить задачу">${icon('trash')}</button>`:''}</footer></aside></div>`);
}
function fileSize(bytes){return bytes<1024?bytes+' Б':bytes<1048576?(bytes/1024).toFixed(1)+' КБ':(bytes/1048576).toFixed(1)+' МБ';}
function closeDrawer(){S.drawer=null;$('#drawer-root')?.remove();}

async function refresh(detail=false){if(!await loadWorkspace())return;renderSidebar();renderMain();if(detail&&S.drawer){const t=await api('/tasks/'+S.drawer.id);S.drawer=t;renderDrawer();}}
async function quickUpdate(id,changes){const t=taskById(id);if(!t)return;try{await api('/tasks/'+id,{method:'PATCH',body:{...changes,version:t.version}});if(changes.status){S.status='all';if(S.date==='overdue')S.date='all';}await refresh(Boolean(S.drawer));}catch(err){toast(err.message);if(err.status===409)await loadWorkspace();}}

document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('form'))return;event.preventDefault();const submit=event.submitter||$('[type=submit]',form);if(submit)submit.disabled=true;
  const fd=new FormData(form);const b=Object.fromEntries(fd);let errorTarget=$('#modal-error')||$('#detail-error');
  try{
    if(form.id==='auth-form'){
      errorTarget=$('#auth-error');
      if(!S.authPhone){
        await api('/auth/request-code',{method:'POST',body:{phone:b.phone}});S.authPhone=b.phone;S.codeRetryAt=Date.now()+60000;renderAuth();$('#auth-code')?.focus();
      }else{
        const result=await api('/auth/verify',{method:'POST',body:{phone:S.authPhone,code:b.code}});S.user=result.user;S.csrf=result.csrf;S.authPhone=null;const from=new URLSearchParams(location.search),params=new URLSearchParams();for(const key of ['task','project','view']){const value=from.get(key);if(value&&value.length<=100)params.set(key,value);}history.replaceState({},'',location.pathname+(params.size?'?'+params:''));await enterWorkspace();
      }
      return;
    }
    if(form.id==='access-form'){
      await api('/access/update',{method:'POST',body:{userId:form.dataset.id,version:Number(form.dataset.version),status:b.status,role:b.role,permissions:fd.getAll('permissions')}});closeModal();await loadAccess();toast('Доступ обновлён');return;
    }
    if(form.id==='project-form'){
      const id=form.dataset.id;if(id)b.members=fd.getAll('members');const result=await api('/projects'+(id?'/'+id:''),{method:id?'PATCH':'POST',body:b});closeModal();await refresh();if(!id)navigate('project',result.id);toast(id?'Проект сохранён':'Проект создан');return;
    }
    if(form.id==='task-form'){
      b.project_id=$('#task-project',form).value;b.assignee_id=canAssign()?$('#task-assignee',form).value:S.user.id;b.participants=fd.getAll('participants');if(form.dataset.parent)b.parent_id=form.dataset.parent;const t=await api('/tasks',{method:'POST',body:b});closeModal();await refresh();await openTask(t.id);toast('Задача создана');return;
    }
    if(form.id==='detail-form'){
      errorTarget=$('#detail-error');b.version=Number(form.dataset.version);b.participants=fd.getAll('participants');await api('/tasks/'+form.dataset.id,{method:'PATCH',body:b});await refresh(true);toast('Изменения сохранены');return;
    }
    if(form.id==='comment-form'){
      await api('/tasks/'+form.dataset.id+'/comments',{method:'POST',body:b});await refresh(true);toast('Комментарий добавлен');return;
    }
    if(form.id==='profile-form'){
      errorTarget=null;await api('/profile',{method:'PATCH',body:b});S.user.name=b.name;await refresh();toast('Изменения сохранены');return;
    }
  }catch(err){if(errorTarget){errorTarget.innerHTML=form.id==='auth-form'?`<div class="error-box">${esc(err.message)}</div>`:esc(err.message);}else toast(err.message);}
  finally{if(submit&&submit.isConnected)submit.disabled=false;}
});

document.addEventListener('click',async event=>{
  $$('details[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('[data-action]')&&menu.classList.contains('account-menu'))menu.open=false;});
  const button=event.target.closest('[data-action]');
  if(!button){const task=event.target.closest('[data-task]');if(task)await openTask(task.dataset.task);return;}
  const action=button.dataset.action,id=button.dataset.id;
  try{
    if(action==='sidebar-toggle'){if(innerWidth<=800)S.sidebarOpen=!S.sidebarOpen;else S.sidebarCollapsed=!S.sidebarCollapsed;syncSidebar();return;}
    if(action==='sidebar-close'){S.sidebarOpen=false;syncSidebar();return;}
    if(action==='filter-person'){S.assignee=id;renderMain();return;}
    if(action==='navigate'){navigate(button.dataset.view);return;}
    if(action==='project'){navigate('project',id);return;}
    if(action==='theme'){theme(document.documentElement.dataset.theme==='light'?'dark':'light');if(S.user)renderMain();return;}
    if(action==='set-theme'){theme(button.dataset.theme);renderMain();return;}
    if(action==='new-project'){if(!has('projects.create'))return;projectModal();return;}
    if(action==='edit-project'){projectModal(id);return;}
    if(action==='new-task'){if(!canCreateTasks())return;taskModal(button.dataset.priority||(S.view==='today'?'80':'backlog'));return;}
    if(action==='new-subtask'){taskModal('backlog',id);return;}
    if(action==='close-modal'){closeModal();return;}
    if(action==='close-drawer'){closeDrawer();return;}
    if(action==='open-task'||action==='reload-task'){await openTask(id);return;}
    if(action==='mode'){if(button.dataset.scope==='today'){S.todayMode=button.dataset.mode;localStorage.setItem('focus:today-mode',S.todayMode);}else{S.mode=button.dataset.mode;localStorage.setItem('focus:mode',S.mode);}renderMain();return;}
    if(action==='clear-search'){S.search='';$('#global-search').value='';renderMain();return;}
    if(action==='toggle-task'){const t=taskById(id);button.disabled=true;try{await quickUpdate(id,{status:t.status==='done'?'todo':'done'});}finally{if(button.isConnected)button.disabled=false;}return;}
    if(action==='quick-date'){const form=button.closest('form')||button.closest('.task-properties');$('[name=due_date]',form).value=button.dataset.date;$$('.date-chip',form).forEach(x=>x.classList.toggle('active',x.dataset.date===button.dataset.date));const menu=button.closest('.quick-date-menu');if(menu){$('summary span',menu).textContent=dateLabel(button.dataset.date);menu.open=false;}return;}
    if(action==='color'){const form=button.closest('form');$('[name=color]',form).value=button.dataset.color;$$('.color-swatch',form).forEach(x=>x.classList.toggle('active',x===button));return;}
    if(action==='change-phone'){S.authPhone=null;renderAuth();return;}
    if(action==='resend-code'){if(Date.now()<S.codeRetryAt)return;await api('/auth/request-code',{method:'POST',body:{phone:S.authPhone}});S.codeRetryAt=Date.now()+60000;updateCodeCountdown();toast('Если доступ разрешён, код придёт в Telegram');return;}
    if(action==='edit-access'){accessModal(id);return;}
    if(action==='access-tab'){S.accessTab=button.dataset.tab;$$('.access-tabs button').forEach(b=>b.classList.toggle('active',b===button));if(button.dataset.tab==='audit')await showAccessAudit();else await loadAccess();return;}
    if(action==='permission-preset'){const special=['tasks.assign','company.tasks.read','admin.access.manage'];$$('[name=permissions]',$('#access-form')).forEach(input=>input.checked=button.dataset.preset==='admin'||button.dataset.preset==='employee'&&!special.includes(input.value));$('#access-role').value=button.dataset.preset==='admin'?'admin':'employee';return;}
    if(action==='revoke-sessions'){await api('/access/update',{method:'POST',body:{userId:id,version:Number(button.dataset.version),action:'revoke-sessions'}});closeModal();await loadAccess();toast('Сессии завершены');return;}
    if(action==='notification-toggle'){await api('/telegram',{method:'PATCH',body:{enabled:button.dataset.enabled!=='1'}});renderMain();return;}
    if(action==='delete-task'){if(!confirm('Удалить задачу вместе со всеми подзадачами, файлами и комментариями?'))return;await api('/tasks/'+id,{method:'DELETE'});closeDrawer();await refresh();toast('Задача удалена');return;}
    if(action==='delete-project'){if(!confirm('Удалить проект и все его задачи, подзадачи и файлы? Это действие нельзя отменить.'))return;await api('/projects/'+id,{method:'DELETE'});closeModal();closeDrawer();await refresh();navigate('today');toast('Проект удалён');return;}
    if(action==='delete-file'){if(!confirm('Удалить этот файл?'))return;await api('/files/'+id,{method:'DELETE'});await refresh(true);toast('Файл удалён');return;}
    if(action==='logout'){await api('/auth/logout',{method:'POST'});clearSession();renderAuth();return;}
    if(action==='retry'){await boot();return;}
    if(action==='calendar-prev'||action==='calendar-next'){S.calendar=new Date(S.calendar.getFullYear(),S.calendar.getMonth()+(action==='calendar-prev'?-1:1),1);renderMain();return;}
    if(action==='calendar-now'){S.calendar=new Date(S.today+'T12:00:00');renderMain();return;}
    if(action==='activity'){modal('Активность проектов',eventsMarkup(S.activity)||'<p class="muted small">Пока нет событий.</p>');return;}
  }catch(err){toast(err.message);}
});
document.addEventListener('input',event=>{if(event.target.id==='global-search'){S.search=event.target.value.trim();renderMain();}});
document.addEventListener('change',async event=>{
  const el=event.target;
  if(el.id==='filter-status'||el.id==='filter-assignee'||el.id==='filter-date'){S[{ 'filter-status':'status','filter-assignee':'assignee','filter-date':'date'}[el.id]]=el.value;renderMain();return;}
  if(el.name==='due_date'){const menu=el.closest('.quick-date-menu');if(menu)$('summary span',menu).textContent=dateLabel(el.value);}
  if(el.id==='task-project'){const form=el.closest('form');const pid=el.value;$('#task-assignee',form).innerHTML=assigneeOptions(pid);const old=$('#task-participants',form).closest('.field');old.outerHTML=participantsField(pid);return;}
  if(el.id==='file-upload'){
    const files=[...el.files];if(!files.length)return;const tid=S.drawer.id;el.disabled=true;
    try{for(const file of files){if(file.size>25*1024*1024)throw new Error(file.name+': больше 25 МБ');const status=$('#upload-status');if(status)status.textContent='Загружаем '+file.name+'…';const form=new FormData();form.append('file',file);await api('/tasks/'+tid+'/files',{method:'POST',body:form});}await refresh(true);toast('Файлы прикреплены');}catch(err){toast(err.message);await refresh(true);}
  }
});
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(innerWidth<=800)S.sidebarOpen=true;else S.sidebarCollapsed=false;syncSidebar();$('#global-search')?.focus();return;}
  if(event.key==='Escape'){if(S.modal)closeModal();else if(S.drawer)closeDrawer();else{S.sidebarOpen=false;syncSidebar();}return;}
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-task]')){event.preventDefault();openTask(event.target.dataset.task);}
  if(event.key==='Tab'){
    const container=$('#modal-backdrop .modal')||$('.drawer');if(!container)return;
    const focusables=$$('a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',container).filter(el=>el.getClientRects().length);
    const first=focusables[0],last=focusables[focusables.length-1];
    if(event.shiftKey&&(document.activeElement===first||!container.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!container.contains(document.activeElement))){event.preventDefault();first?.focus();}
  }
});
let dragging=null;
document.addEventListener('dragstart',event=>{const card=event.target.closest('.task-card');if(!card||card.draggable===false)return;dragging=card.dataset.task;event.dataTransfer.setData('text/plain',dragging);event.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
document.addEventListener('dragend',()=>{dragging=null;$$('.dragover,.dragging').forEach(el=>el.classList.remove('dragover','dragging'));});
document.addEventListener('dragover',event=>{const column=event.target.closest('[data-column]');if(column&&dragging){event.preventDefault();event.dataTransfer.dropEffect='move';column.classList.add('dragover');}});
document.addEventListener('dragleave',event=>{const column=event.target.closest('[data-column]');if(column&&!column.contains(event.relatedTarget))column.classList.remove('dragover');});
document.addEventListener('drop',async event=>{const column=event.target.closest('[data-column]');if(!column||!dragging)return;event.preventDefault();column.classList.remove('dragover');const id=dragging;dragging=null;if(taskById(id)?.priority!==column.dataset.column)await quickUpdate(id,{priority:column.dataset.column});});
boot();
