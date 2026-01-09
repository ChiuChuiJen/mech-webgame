/* V0.1.1 - No frameworks, GitHub Pages friendly */
'use strict';

const VERSION = '0.1.8';
const SAVE_KEY = 'mech_webgame_save_v' + VERSION;

// Helpers
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const pick=(arr)=>arr[Math.floor(Math.random()*arr.length)];
const pct=(p)=>Math.random()<p;

const rarityRank = (r)=>({'普通':1,'菁英':2,'傳說':3}[r]||0);
const slotName = (s)=>({
  weaponR:'右手', weaponL:'左手',
  head:'頭部', body:'軀幹', arms:'手臂', legs:'腿部', booster:'推進', core:'核心'
}[s]||s);

const partLabel = (slot)=>({
  head:'頭部', body:'軀幹', arms:'手臂', legs:'腿部', booster:'推進', core:'核心'
}[slot]||slot);

function safeId(prefix='it'){
  return prefix + '_' + Math.random().toString(36).slice(2,10);
}


function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 300);
}

function readJsonFile(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = ()=>reject(new Error('讀取檔案失敗'));
    fr.onload = ()=>{
      try{ resolve(JSON.parse(fr.result)); }
      catch(e){ reject(new Error('JSON 格式錯誤')); }
    };
    fr.readAsText(file, 'utf-8');
  });
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

// DB
let DB = { weapons:[], equipment:[], consumables:[], set_bonus:{}, monsters:[], drop_shop:{} };
async function loadDB(){
  const files = [
    ['weapons','data/weapon.json'],
    ['equipment','data/equipment.json'],
    ['consumables','data/consumable.json'],
    ['set_bonus','data/set_bonus.json'],
    ['monsters','data/monsters.json'],
    ['drop_and_shop','data/drop_and_shop.json'],
  ];
  for (const [k,p] of files){
    const res = await fetch(p + '?v=' + VERSION);
    if(!res.ok) throw new Error('Failed to load ' + p);
    DB[k] = await res.json();
  }
}

// State
const defaultState = ()=>({
  gold: 60,
  lv: 1,
  xp: 0,
  hp: 60,
  en: 30,
  base: { hpMax:60, enMax:30, atk:6, def:2, crit:3, ls:0 },
  buffs: [],
  inventory: [], // {uid, cat, id}
  equipped: { weaponR:null, weaponL:null, head:null, body:null, arms:null, legs:null, booster:null, core:null },
  area: { floor:1, unlocked:1, depth:1, name:'1F 廢土區·深度1' },
  battle: { active:false, enemy:null, enemyHp:0, enemyHpMax:0, firstHitTaken:true },
  battleLog: [],
  shop: { items: [] },
  log: []
});

let S = null;

// Lookups
function getItemById(cat,id){
  if(cat==='weapon') return DB.weapons.find(x=>x.id===id);
  if(cat==='equipment') return DB.equipment.find(x=>x.id===id);
  if(cat==='consumable') return DB.consumables.find(x=>x.id===id);
  return null;
}
function getInvItem(uid){ return S.inventory.find(x=>x.uid===uid)||null; }
function getEquipped(slot){
  const uid = S.equipped[slot];
  if(!uid) return null;
  const inv = getInvItem(uid);
  if(!inv) return null;
  const data = getItemById(inv.cat, inv.id);
  return data ? {inv, data} : null;
}
function isEquipped(uid){ return Object.values(S.equipped).includes(uid); }

// Progression
function xpToNext(lv){ return Math.floor(40 + lv*lv*12); }

// Sets
function computeSetCounts(){
  const slots=['weaponR','weaponL','head','body','arms','legs','booster','core'];
  const c={};
  for(const s of slots){
    const eq=getEquipped(s);
    if(!eq) continue;
    const setId=eq.data.set;
    if(!setId) continue;
    c[setId]=(c[setId]||0)+1;
  }
  return c;
}

function computeBonuses(){
  const b={ hp:0,en:0,atk:0,def:0,crit:0,ls:0,
    regenHp:0,regenEn:0,dmgReduce:0,flee:0,skillCostReduce:0,skillDmgPct:0,critDmgPct:0
  };
  const slots=['weaponR','weaponL','head','body','arms','legs','booster','core'];
  for(const s of slots){
    const eq=getEquipped(s);
    if(!eq) continue;
    const d=eq.data;
    b.atk += d.atk||0;
    b.def += d.def||0;
    b.hp  += d.hp||0;
    b.en  += d.en||0;
    b.crit += d.crit||0;
    b.ls += d.ls||0;
  }
  const counts=computeSetCounts();
  for(const [setId,cnt] of Object.entries(counts)){
    const sb=DB.set_bonus[setId];
    if(!sb) continue;
    if(cnt>=2) for(const [k,v] of Object.entries(sb.bonuses['2'])) b[k]+=v;
    if(cnt>=4) for(const [k,v] of Object.entries(sb.bonuses['4'])) b[k]+=v;
  }
  for(const bf of S.buffs){
    if(bf.type==='atk') b.atk+=bf.value;
    if(bf.type==='def') b.def+=bf.value;
    if(bf.type==='crit') b.crit+=bf.value;
  }
  return b;
}

function stats(){
  const b=computeBonuses();
  const hpMax = S.base.hpMax + (S.lv-1)*10 + b.hp;
  const enMax = S.base.enMax + (S.lv-1)*5  + b.en;
  const atk   = S.base.atk   + (S.lv-1)*2  + b.atk;
  const def   = S.base.def   + Math.floor((S.lv-1)*1.1) + b.def;
  const crit  = clamp(S.base.crit + b.crit, 0, 75);
  const ls    = clamp(S.base.ls + b.ls, 0, 40);
  return { hpMax, enMax, atk, def, crit, ls, bonus:b };
}

function applyTurnRegen(){
  const st=stats();
  S.hp = clamp(S.hp + (st.bonus.regenHp||0), 0, st.hpMax);
  S.en = clamp(S.en + (st.bonus.regenEn||0), 0, st.enMax);
}

function tickBuffs(t=1){
  for(const bf of S.buffs) bf.turns -= t;
  S.buffs = S.buffs.filter(bf=>bf.turns>0);
}

function gainXP(x){
  S.xp += x;
  while(S.xp >= xpToNext(S.lv)){
    S.xp -= xpToNext(S.lv);
    S.lv += 1;
    const st=stats();
    S.hp = clamp(S.hp + 12, 0, st.hpMax);
    S.en = clamp(S.en + 6, 0, st.enMax);
    log(`升等！現在等級 ${S.lv}。`);
  }
}

// Log
function blog(msg){
  S.battleLog.unshift(msg);
  if(S.battleLog.length>120) S.battleLog.length=120;
}

function log(msg){
  const t = new Date().toLocaleTimeString('zh-Hant', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  S.log.unshift(`[${t}] ${msg}`);
  if(S.log.length>80) S.log.length=80;
  renderLog();
}

// UI helpers
function setBar(sel, cur, max){
  const el=$(sel);
  if(!el) return;
  const p = (max<=0)?0:clamp((cur/max)*100,0,100);
  el.style.width = p + '%';
}
function rarityBadge(r){ return `<span class="badge">${escapeHtml(r)}</span>`; }

function itemTitle(cat,d){
  const cn={weapon:'武器',equipment:'裝備',consumable:'補給'}[cat]||cat;
  return `${escapeHtml(d.name)} <span class="muted">(${cn})</span>`;
}
function itemDesc(cat,d){
  if(cat==='weapon') return `攻擊 +${d.atk} · 暴擊 +${d.crit||0}% · 吸血 +${d.ls||0}%<br>被動：${escapeHtml(d.passive)}`;
  if(cat==='equipment') return `${partLabel(d.slot)} · 攻 +${d.atk||0} · 防 +${d.def||0} · HP +${d.hp||0} · EN +${d.en||0} · 暴擊 +${d.crit||0}% · 吸血 +${d.ls||0}%<br>被動：${escapeHtml(d.passive)}`;
  if(cat==='consumable') return escapeHtml(d.desc||'');
  return '';
}

function render(){
  const st=stats();
  $('#lv').textContent = S.lv;
  $('#xp').textContent = `${S.xp} / ${xpToNext(S.lv)}`;
  setBar('#xpBar', S.xp, xpToNext(S.lv));

  $('#hp').textContent = `${S.hp} / ${st.hpMax}`;
  setBar('#hpBar', S.hp, st.hpMax);

  $('#en').textContent = `${S.en} / ${st.enMax}`;
  setBar('#enBar', S.en, st.enMax);

  $('#gold').textContent = S.gold;
  $('#pillArea').textContent = `區域：${S.area.name}`;
  const pf=$('#pillFloor'); if(pf) pf.textContent = `探索：${S.area.floor}F（已解鎖到 ${S.area.unlocked}F）`;

  $('#atk').textContent = st.atk;
  $('#def').textContent = st.def;
  $('#crit').textContent = st.crit;
  $('#ls').textContent = st.ls;

  const eqR=getEquipped('weaponR');
  const eqL=getEquipped('weaponL');
  const eqH=getEquipped('head');
  const eqB=getEquipped('body');
  const eqA=getEquipped('arms');
  const eqLg=getEquipped('legs');
  const eqBo=getEquipped('booster');
  const eqC=getEquipped('core');

  $('#eqWeaponR').textContent = eqR?eqR.data.name:'—';
  $('#eqWeaponL').textContent = eqL?eqL.data.name:'—';
  $('#eqHead').textContent = eqH?eqH.data.name:'—';
  $('#eqBody').textContent = eqB?eqB.data.name:'—';
  $('#eqArms').textContent = eqA?eqA.data.name:'—';
  $('#eqLegs').textContent = eqLg?eqLg.data.name:'—';
  $('#eqBooster').textContent = eqBo?eqBo.data.name:'—';
  $('#eqCore').textContent = eqC?eqC.data.name:'—';

  const counts=computeSetCounts();
  const best=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  if(best){
    const sb=DB.set_bonus[best];
    const cnt=counts[best];
    $('#setProgress').textContent = `套裝：${sb.name}（${Math.min(cnt,4)}/4） · 2件：${sb['2']} · 4件：${sb['4']}`;
  } else {
    $('#setProgress').textContent = '套裝：—';
  }

  const pass=[];
  if(eqR) pass.push(`右手：${eqR.data.passive}`);
  if(eqL) pass.push(`左手：${eqL.data.passive}`);
  if(eqH) pass.push(`頭部：${eqH.data.passive}`);
  if(eqB) pass.push(`軀幹：${eqB.data.passive}`);
  if(eqA) pass.push(`手臂：${eqA.data.passive}`);
  if(eqLg) pass.push(`腿部：${eqLg.data.passive}`);
  if(eqBo) pass.push(`推進：${eqBo.data.passive}`);
  if(eqC) pass.push(`核心：${eqC.data.passive}`);
  $('#passives').textContent = pass.length?`被動：${pass.join(' / ')}`:'被動：—';

  renderBattle();
  renderBattleModal();
  renderInventory();
  renderShop();
  renderLog();
  bindInventoryButtons();
}

function renderLog(){
  const box=$('#logBox');
  const show=S.log.slice(0,10);
  box.innerHTML = show.length
    ? show.map(s=>`<div class="entry">${escapeHtml(s)}</div>`).join('')
    : `<div class="entry muted">（尚無紀錄）</div>`;
}

function renderBattle(){
  const b=S.battle;
  $('#btnAttack').disabled = !b.active;
  $('#btnSkill').disabled = !b.active;
  $('#btnFlee').disabled = !b.active;

  if(!b.active){
    $('#enemyName').textContent='—';
    $('#enemyHp').textContent='—';
    $('#enemyInfo').textContent='—';
    setBar('#enemyHpBar',0,1);
    $('#battleHint').textContent='先探索以遇敵。';
    return;
  }
  $('#enemyName').textContent = `${b.enemy.name} · ${b.enemy.role}`;
  $('#enemyHp').textContent = `${b.enemyHp} / ${b.enemyHpMax}`;
  setBar('#enemyHpBar', b.enemyHp, b.enemyHpMax);
  $('#enemyInfo').textContent = `等級 ${b.enemy.lv} · 攻 ${b.enemy.atk} · 防 ${b.enemy.def}`;
  $('#battleHint').textContent = '選擇攻擊或技能。';
}


function renderBattleModal(){
  const dlg = $('#battleModal');
  if(!dlg) return;

  const b=S.battle;
  const st=stats();

  // player
  $('#bmPlayerHp').textContent = `${S.hp} / ${st.hpMax}`;
  $('#bmPlayerMp').textContent = `${S.en} / ${st.enMax}`;
  $('#bmPlayerAtk').textContent = st.atk;
  $('#bmPlayerDef').textContent = st.def;
  setBar('#bmPlayerHpBar', S.hp, st.hpMax);
  setBar('#bmPlayerMpBar', S.en, st.enMax);

  if(!b.active){
    $('#bmEnemyName').textContent = '—';
    $('#bmEnemyHp').textContent = '—';
    $('#bmEnemyAtk').textContent = '—';
    $('#bmEnemyDef').textContent = '—';
    setBar('#bmEnemyHpBar', 0, 1);
    $('#bmHint').textContent = '未在戰鬥中。';
    $('#bmAttack')?.setAttribute('disabled','disabled');
    $('#bmSkill')?.setAttribute('disabled','disabled');
    $('#bmFlee')?.setAttribute('disabled','disabled');
  } else {
    $('#bmEnemyName').textContent = `${b.enemy.name} · ${b.enemy.role}`;
    $('#bmEnemyHp').textContent = `${b.enemyHp} / ${b.enemyHpMax}`;
    $('#bmEnemyAtk').textContent = b.enemy.atk;
    $('#bmEnemyDef').textContent = b.enemy.def;
    setBar('#bmEnemyHpBar', b.enemyHp, b.enemyHpMax);
    $('#bmHint').textContent = '選擇攻擊或技能。';
    $('#bmAttack')?.removeAttribute('disabled');
    $('#bmSkill')?.removeAttribute('disabled');
    $('#bmFlee')?.removeAttribute('disabled');
  }

  const box=$('#bmLogBox');
  if(box){
    const lines = S.battleLog.slice(0,60).reverse();
    box.innerHTML = lines.length ? lines.map(s=>`<div class="line">${escapeHtml(s)}</div>`).join('') : `<div class="line muted">（尚無戰鬥紀錄）</div>`;
    box.scrollTop = box.scrollHeight;
  }
}


function renderInventory(){
  const list=$('#invList');
  const items=S.inventory.slice().sort((a,b)=>{
    const da=getItemById(a.cat,a.id), db=getItemById(b.cat,b.id);
    const ra=rarityRank(da?.rarity||'普通'), rb=rarityRank(db?.rarity||'普通');
    if(rb!==ra) return rb-ra;
    return (db?.price||0)-(da?.price||0);
  });

  if(!items.length){
    list.innerHTML=`<div class="item"><div class="meta"><div class="title">背包是空的</div><div class="desc">去探索或雜貨店看看。</div></div></div>`;
    return;
  }

  list.innerHTML = items.map(it=>{
    const d=getItemById(it.cat,it.id);
    const eq=isEquipped(it.uid);
    const setBadge = d.set ? `<span class="badge">套裝：${escapeHtml(DB.set_bonus[d.set]?.name||d.set)}</span>` : '';
    const eqBadge = eq ? `<span class="badge">已裝備</span>` : '';
    const sellPrice = Math.max(1, Math.floor((d.price||10)*0.55));
    let act='';
    if(it.cat==='weapon'){
      act += `<button class="btn btn-primary" data-eq="weaponR:${it.uid}">裝右手</button>`;
      act += `<button class="btn btn-primary" data-eq="weaponL:${it.uid}">裝左手</button>`;
    } else if(it.cat==='equipment'){
      act += `<button class="btn btn-primary" data-eq="${d.slot}:${it.uid}">裝${partLabel(d.slot)}</button>`;
    } else if(it.cat==='consumable'){
      act += `<button class="btn btn-primary" data-use="${it.uid}">使用</button>`;
    }
    if(eq) act += `<button class="btn" data-uneq="${it.uid}">解除</button>`;
    act += `<button class="btn btn-danger" data-sell="${it.uid}">販售 +${sellPrice}</button>`;
    act += `<button class="btn btn-danger" data-salv="${it.uid}">分解</button>`;

    return `
      <div class="item">
        <div class="meta">
          <div class="title">${itemTitle(it.cat,d)} ${rarityBadge(d.rarity)} ${setBadge} ${eqBadge}</div>
          <div class="desc">${itemDesc(it.cat,d)}</div>
        </div>
        <div class="actions">${act}</div>
      </div>`;
  }).join('');
}

function renderShop(){
  const list=$('#shopList');
  const items=S.shop.items;
  if(!items.length){
    list.innerHTML=`<div class="item"><div class="meta"><div class="title">雜貨店尚未上架</div><div class="desc">點「刷新」生成販售清單。</div></div></div>`;
    return;
  }
  list.innerHTML = items.map(it=>{
    const d=getItemById(it.cat,it.id);
    const setBadge = d.set ? `<span class="badge">套裝：${escapeHtml(DB.set_bonus[d.set]?.name||d.set)}</span>` : '';
    const disabled = (S.gold < it.price) ? 'disabled' : '';
    return `
      <div class="item">
        <div class="meta">
          <div class="title">${itemTitle(it.cat,d)} ${rarityBadge(d.rarity)} ${setBadge}</div>
          <div class="desc">${itemDesc(it.cat,d)}<br><span class="badge">價格：${it.price} 金</span></div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" ${disabled} data-buy="${it.uid}">購買</button>
        </div>
      </div>`;
  }).join('');

  $$('[data-buy]').forEach(b=>b.onclick=()=>buyFromShop(b.getAttribute('data-buy')));
}

// Equip / unequip
function equip(slot, uid){
  const inv=getInvItem(uid);
  if(!inv) return;
  if(slot.startsWith('weapon')){
    if(inv.cat!=='weapon') return;
  } else {
    if(inv.cat!=='equipment') return;
    const d=getItemById('equipment', inv.id);
    if(!d || d.slot!==slot) return;
  }
  S.equipped[slot]=uid;
  log(`裝備：${slotName(slot)} ← ${getItemById(inv.cat,inv.id).name}`);
  render();
}
function unequip(uid){
  for(const k of Object.keys(S.equipped)) if(S.equipped[k]===uid) S.equipped[k]=null;
  log('解除裝備。');
  render();
}

// Economy
function sell(uid){
  const inv=getInvItem(uid); if(!inv) return;
  const d=getItemById(inv.cat,inv.id);
  const gain=Math.max(1, Math.floor((d.price||10)*0.55));
  unequip(uid);
  S.inventory=S.inventory.filter(x=>x.uid!==uid);
  S.gold += gain;
  log(`販售：${d.name} (+${gain} 金)`);
  render();
}
function salvage(uid){
  const inv=getInvItem(uid); if(!inv) return;
  const d=getItemById(inv.cat,inv.id);
  const gain=Math.max(1, Math.floor((d.price||10)*0.25)) + rarityRank(d.rarity)*2;
  unequip(uid);
  S.inventory=S.inventory.filter(x=>x.uid!==uid);
  S.gold += gain;
  log(`分解：${d.name} (+${gain} 金)`);
  render();
}
function salvageJunk(){
  let gain=0, removed=0;
  const keep=[];
  for(const it of S.inventory){
    const d=getItemById(it.cat,it.id);
    if(isEquipped(it.uid) || !d || d.rarity!=='普通') keep.push(it);
    else { gain += Math.max(1, Math.floor((d.price||10)*0.25)); removed++; }
  }
  if(!removed){ log('沒有可分解的普通物品。'); return; }
  S.inventory=keep;
  S.gold+=gain;
  log(`分解普通物品 ${removed} 件 (+${gain} 金)`);
  render();
}

// Consumables
function useConsumable(uid){
  const inv=getInvItem(uid);
  if(!inv || inv.cat!=='consumable') return;
  const d=getItemById('consumable', inv.id);
  const st=stats();
  if(d.kind==='heal') S.hp = clamp(S.hp + (d.hp||0), 0, st.hpMax);
  else if(d.kind==='energy') S.en = clamp(S.en + (d.en||0), 0, st.enMax);
  else if(d.kind==='buff') S.buffs.push({type:d.buff, value:d.value, turns:d.turns});
  log(`使用：${d.name}`);
  S.inventory=S.inventory.filter(x=>x.uid!==uid);
  render();
}

// Shop
function rerollShop(){
  const floor = String(S.area.floor||1);
  const base = DB.drop_shop.shop_base_by_floor?.[floor] || DB.drop_shop.shop_base_by_floor?.['1'];
  if(!base){ S.shop.items=[]; render(); return; }
  function makeOffer(cat,id){
    const d=getItemById(cat,id);
    const price=(d.price||20)+rnd(0, Math.max(3, Math.floor((d.price||20)*0.15)));
    return {uid:safeId('shop'), cat, id, price};
  }
  const items=[];
  items.push(makeOffer('weapon', pick(base.weapons)));
  items.push(makeOffer('weapon', pick(base.weapons)));
  for(let i=0;i<3;i++) items.push(makeOffer('equipment', pick(base.equipment)));
  items.push(makeOffer('consumable', pick(base.consumables)));
  items.push(makeOffer('consumable', pick(base.consumables)));
  S.shop.items=items;
  log(`雜貨店已刷新（${S.area.floor}F）。`);
  render();
}
function buyFromShop(uid){
  const it=S.shop.items.find(x=>x.uid===uid);
  if(!it) return;
  if(S.gold < it.price) return;
  S.gold -= it.price;
  S.inventory.push({uid:safeId('inv'), cat:it.cat, id:it.id});
  S.shop.items=S.shop.items.filter(x=>x.uid!==uid);
  log(`購買：${getItemById(it.cat,it.id).name} (-${it.price} 金)`);
  render();
}

// Drops
function weightedPickRarity(){
  const w=DB.drop_shop.rarity_weight;
  const entries=Object.entries(w);
  const total=entries.reduce((s,kv)=>s+kv[1],0);
  let r=Math.random()*total;
  for(const [k,v] of entries){ r-=v; if(r<=0) return k; }
  return entries[0][0];
}
function rollDrops(enemy){
  const res=[];
  const t=enemy.drops||{};
  function roll(cat, chance, pool){
    if(!pct(chance)) return;
    const rarity=weightedPickRarity();
    const candidates=pool.filter(x=>x.rarity===rarity);
    const chosen=pick(candidates.length?candidates:pool);
    res.push({uid:safeId('inv'), cat, id:chosen.id});
  }
  roll('weapon', t.weapon||0, DB.weapons);
  roll('equipment', t.equipment||0, DB.equipment);
  if(pct(t.consumable||0)) res.push({uid:safeId('inv'), cat:'consumable', id:pick(DB.consumables).id});
  return res;
}

// Battle selection (floor based)
function pickEnemy(){
  const floor=S.area.floor||1;
  const pool=DB.monsters.filter(m=>m.floor===floor);
  const depth=S.area.depth||1;
  const allowBoss = depth>=3;
  const bag=[];
  for(const m of pool){
    let w=1;
    if(m.role==='普通') w=70;
    else if(m.role==='菁英') w=20;
    else if(m.role==='MiniBoss') w=7;
    else if(m.role==='Boss') w=allowBoss?3:0;
    for(let i=0;i<w;i++) bag.push(m);
  }
  return pick(bag.length?bag:pool);
}

function startBattle(){
  const enemy=structuredClone(pickEnemy());
  S.battle = { active:true, enemy, enemyHp:enemy.hp, enemyHpMax:enemy.hp, firstHitTaken:true };
  S.battleLog = [];
  const rew = $('#bmRewards'); if(rew){ rew.style.display='none'; rew.innerHTML=''; }
  blog(`遇敵：${enemy.name}（${enemy.role}）`);
  log(`遇敵：${enemy.name}（${enemy.role}）`);
  const dlg = $('#battleModal');
  if(dlg && !dlg.open) dlg.showModal();
  render();
}

function endBattle(victory){
  const b=S.battle;
  if(!b.active) return;

  const dlg = $('#battleModal');
  const rewBox = $('#bmRewards');

  if(victory){
    const e=b.enemy;
    const g = e.gold + rnd(0, Math.max(3, Math.floor(e.gold*0.25)));
    S.gold += g;
    gainXP(e.xp);

    blog(`勝利！+${e.xp} EXP、+${g} 金`);
    log(`勝利！+${e.xp} EXP、+${g} 金`);

    let extra = '';
    if(e.role==='Boss'){
      if((S.area.unlocked||1) < 10 && S.area.floor===S.area.unlocked){
        S.area.unlocked += 1;
        blog(`Boss 擊破！已解鎖 ${S.area.unlocked}F。`);
        log(`Boss 擊破！已解鎖 ${S.area.unlocked}F。`);
        extra = `解鎖：${S.area.unlocked}F`;
      }
    }

    const drops=rollDrops(e);
    let dropText = '無';
    if(drops.length){
      drops.forEach(it=>S.inventory.push(it));
      dropText = drops.map(it=>getItemById(it.cat,it.id).name).join('、');
      blog(`掉落：${dropText}`);
      log(`掉落：${dropText}`);
    } else {
      blog('沒有掉落。');
      log('沒有掉落。');
    }

    if(rewBox){
      rewBox.style.display='block';
      rewBox.innerHTML = `
        <div style="font-weight:900; margin-bottom:6px;">戰鬥結算</div>
        <div>EXP：+${e.xp}</div>
        <div>金幣：+${g}</div>
        <div>掉落：${escapeHtml(dropText)}</div>
        ${extra?`<div>${escapeHtml(extra)}</div>`:''}
      `;
    }
  } else {
    blog('戰鬥結束。');
    if(rewBox){
      rewBox.style.display='block';
      rewBox.innerHTML = `<div style="font-weight:900; margin-bottom:6px;">戰鬥結束</div><div>你已撤退或戰鬥中止。</div>`;
    }
  }

  S.battle.active=false;
  tickBuffs(1);
  render();

  if(dlg && !dlg.open) dlg.showModal();
}

function enemyTurn(){
  const b=S.battle; if(!b.active) return;
  const st=stats();
  let dmgBase = b.enemy.atk + rnd(0,2);

  // body piece "first hit reduction" via keyword in passive (optional)
  const body=getEquipped('body');
  if(body && body.data.passive.includes('首次') && b.firstHitTaken){
    dmgBase = Math.floor(dmgBase*0.5);
    b.firstHitTaken=false;
    log('軀幹被動：首次受擊減半。');
  }

  let dmg = Math.max(1, dmgBase - Math.floor(st.def*0.65));
  dmg = Math.max(1, dmg - (st.bonus.dmgReduce||0));

  S.hp = Math.max(0, S.hp - dmg);
  blog(`${b.enemy.name} 反擊：-${dmg} HP`);
  log(`${b.enemy.name} 反擊：-${dmg} HP`);

  applyTurnRegen();
  tickBuffs(1);

  if(S.hp<=0){
    log('你的機甲被擊破！損失少量金幣並回到 1F。');
    const lost = Math.min(S.gold, Math.floor(15 + S.lv*5));
    S.gold -= lost;
    const st2=stats();
    S.hp = Math.floor(st2.hpMax*0.65);
    S.en = Math.floor(st2.enMax*0.65);
    S.area.floor = 1;
    S.area.depth = 1;
    S.area.name = '1F 廢土區·深度1';
    S.battle.active=false;
    log(`損失：-${lost} 金`);
  }
  render();
}

function playerAttack(isSkill){
  const b=S.battle; if(!b.active) return;
  const st=stats();

  if(isSkill){
    const baseCost=6;
    const cost=Math.max(1, baseCost - (st.bonus.skillCostReduce||0));
    if(S.en < cost){ log('能量不足，無法施放技能。'); return; }
    S.en -= cost;
  }

  let dmgBase = st.atk + rnd(0,3);
  if(isSkill){
    dmgBase = Math.floor(dmgBase*1.35) + rnd(1,4);
    dmgBase = Math.floor(dmgBase * (1 + (st.bonus.skillDmgPct||0)/100));
  }

  // Dual wield nuance
  if(getEquipped('weaponR') && !isSkill) dmgBase += 1;
  if(getEquipped('weaponL') && isSkill) dmgBase += 2;

  let dmg = Math.max(1, dmgBase - Math.floor(b.enemy.def*0.6));

  // Crit
  let isCrit = pct(st.crit/100);
  if(isCrit){
    const mul = 1.6 + (st.bonus.critDmgPct||0)/100;
    dmg = Math.floor(dmg*mul);
  }

  b.enemyHp = Math.max(0, b.enemyHp - dmg);

  // Lifesteal
  const ls = st.ls/100;
  if(ls>0){
    const heal=Math.floor(dmg*ls);
    if(heal>0){ S.hp = clamp(S.hp + heal, 0, st.hpMax); blog(`吸血：+${heal} HP`);
      log(`吸血：+${heal} HP`); }
  }

  blog(`${isSkill?'技能':'攻擊'}命中：-${dmg} HP${isCrit?'（暴擊）':''}`);
  log(`${isSkill?'技能':'攻擊'}命中：-${dmg} HP${isCrit?'（暴擊）':''}`);
  applyTurnRegen();

  if(b.enemyHp<=0) endBattle(true);
  else enemyTurn();
}

// Explore / Rest / Floors
function explore(){
  // chance for free loot
  if(pct(0.12)){
    const e=pickEnemy();
    const drops=rollDrops(e);
    if(drops.length){
      drops.forEach(it=>S.inventory.push(it));
      log(`探索發現：${drops.map(it=>getItemById(it.cat,it.id).name).join('、')}`);
    }
  }

  // depth grows
  if(pct(0.30)){
    S.area.depth = clamp(S.area.depth+1,1,5);
  }
  S.area.name = `${S.area.floor}F 廢土區·深度${S.area.depth}`;

  startBattle();
}

function rest(){
  const st=stats();
  const hb=S.hp, eb=S.en;
  S.hp = clamp(S.hp+18, 0, st.hpMax);
  S.en = clamp(S.en+10, 0, st.enMax);
  applyTurnRegen();
  log(`休整：HP ${hb}→${S.hp}，EN ${eb}→${S.en}`);
  render();
}

function prevFloor(){
  S.area.floor = Math.max(1, (S.area.floor||1)-1);
  S.area.depth = 1;
  S.area.name = `${S.area.floor}F 廢土區·深度1`;
  rerollShop();
  log(`切換到 ${S.area.floor}F`);
  render();
}
function nextFloor(){
  const unlocked=S.area.unlocked||1;
  S.area.floor = Math.min(unlocked, (S.area.floor||1)+1);
  S.area.depth = 1;
  S.area.name = `${S.area.floor}F 廢土區·深度1`;
  rerollShop();
  log(`切換到 ${S.area.floor}F`);
  render();
}

// Save/Load
function save(){
  localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  log('存檔完成。');
}
function load(){
  const raw=localStorage.getItem(SAVE_KEY);
  if(!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

function reset(){
  localStorage.removeItem(SAVE_KEY);
  S = defaultState();

  // starter: 2 weapons + 6 equipment + 1 consumable
  S.inventory.push({uid:safeId('inv'), cat:'weapon', id:'w_001'});
  S.inventory.push({uid:safeId('inv'), cat:'weapon', id:'w_002'});
  const starter = DB.equipment.filter(e=>e.rarity==='普通' && e.set==='S_SCRAP');
  const pickSlot=(slot)=>starter.find(e=>e.slot===slot)?.id;
  const eqIds={ head:pickSlot('head'), body:pickSlot('body'), arms:pickSlot('arms'), legs:pickSlot('legs'), booster:pickSlot('booster'), core:pickSlot('core') };
  for(const [slot,id] of Object.entries(eqIds)) S.inventory.push({uid:safeId('inv'), cat:'equipment', id});
  S.inventory.push({uid:safeId('inv'), cat:'consumable', id:'p_001'});

  // equip them
  S.equipped.weaponR = S.inventory[0].uid;
  S.equipped.weaponL = S.inventory[1].uid;
  const eqInv = S.inventory.filter(x=>x.cat==='equipment');
  for(const it of eqInv){
    const d=getItemById('equipment', it.id);
    S.equipped[d.slot]=it.uid;
  }

  rerollShop();
  log('已重置到初始狀態。');
  render();
}

// Buttons bind
function bindInventoryButtons(){
  $$('[data-eq]').forEach(b=>b.onclick=()=>{
    const [slot,uid]=b.getAttribute('data-eq').split(':');
    equip(slot,uid);
  });
  $$('[data-uneq]').forEach(b=>b.onclick=()=>unequip(b.getAttribute('data-uneq')));
  $$('[data-sell]').forEach(b=>b.onclick=()=>sell(b.getAttribute('data-sell')));
  $$('[data-salv]').forEach(b=>b.onclick=()=>salvage(b.getAttribute('data-salv')));
  $$('[data-use]').forEach(b=>b.onclick=()=>useConsumable(b.getAttribute('data-use')));
}

function setupTabs(){
  $$('.tab').forEach(t=>t.onclick=()=>{
    $$('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const tab=t.getAttribute('data-tab');
    $$('.pane').forEach(p=>p.classList.remove('active'));
    $('#pane-' + tab).classList.add('active');
  });
}

function setupEquipSlotModal(){
  const slots = [
    ['#eqWeaponR','weaponR','武器（右手）','weapon', null],
    ['#eqWeaponL','weaponL','武器（左手）','weapon', null],
    ['#eqHead','head','頭部模組','equipment','head'],
    ['#eqBody','body','軀幹裝甲','equipment','body'],
    ['#eqArms','arms','手臂模組','equipment','arms'],
    ['#eqLegs','legs','腿部模組','equipment','legs'],
    ['#eqBooster','booster','推進器','equipment','booster'],
    ['#eqCore','core','核心模組','equipment','core'],
  ];
  for(const [sel, slot, title, cat, needSlot] of slots){
    const el=$(sel);
    if(!el) continue;
    el.onclick=()=>{
      let items=S.inventory.filter(it=>it.cat===cat);
      if(needSlot) items=items.filter(it=>getItemById('equipment', it.id)?.slot===needSlot);

      const body = items.length ? items.map(it=>{
        const d=getItemById(it.cat,it.id);
        const eq=(S.equipped[slot]===it.uid);
        return `<div class="item" style="margin-bottom:10px;">
          <div class="meta">
            <div class="title">${escapeHtml(d.name)} ${rarityBadge(d.rarity)} ${eq?'<span class="badge">已裝備</span>':''}</div>
            <div class="desc">${itemDesc(it.cat,d)}</div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" data-modal-eq="${slot}:${it.uid}">${eq?'已裝':'裝備'}</button>
          </div>
        </div>`;
      }).join('') : `<div class="muted">背包沒有此類物品。</div>`;

      openModal(title, body, [{text:'關閉', kind:'', onClick: ()=>{}}]);
      $$('[data-modal-eq]').forEach(b=>b.onclick=()=>{
        const [sl,uid]=b.getAttribute('data-modal-eq').split(':');
        equip(sl,uid);
        $('#modal').close();
      });
    };
  }
}

// Modal (reuse existing HTML)

function openSettingsModal(){
  const now = new Date();
  const stamp = now.toISOString().slice(0,19).replaceAll(':','-');
  const body = `
    <div class="muted" style="margin-bottom:10px;">
      設定 / 存檔工具（本機瀏覽器 localStorage）。你也可以匯入/匯出 JSON。
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
      <button class="btn btn-primary" id="setSave">存檔（local）</button>
      <button class="btn btn-primary" id="setLoad">讀檔（local）</button>

      <button class="btn" id="setExportSave">匯出：存檔 JSON</button>
      <label class="btn" style="text-align:center; cursor:pointer;">
        匯入：存檔 JSON
        <input id="setImportSave" type="file" accept="application/json" style="display:none;">
      </label>

      <button class="btn" id="setExportBase">匯出：Base JSON</button>
      <label class="btn" style="text-align:center; cursor:pointer;">
        匯入：Base JSON
        <input id="setImportBase" type="file" accept="application/json" style="display:none;">
      </label>
    </div>
    <div class="muted" style="margin-top:12px;">
      Base JSON 只包含機甲基礎屬性（base），不會改你的背包/金幣/進度。
    </div>
  `;
  openModal('設定', body, [{text:'關閉', kind:'', onClick: ()=>{}}]);

  $('#setSave').onclick = save;
  $('#setLoad').onclick = ()=>{
    const loaded = load();
    if(!loaded){ log('沒有找到 local 存檔。'); return; }
    S = loaded;
    log('讀取 local 存檔完成。');
    rerollShop();
    render();
  };

  $('#setExportSave').onclick = ()=>{
    const payload = {version: VERSION, type:'save', savedAt: now.toISOString(), state: S};
    downloadJson(`mech_save_${VERSION}_${stamp}.json`, payload);
    log('已匯出存檔 JSON。');
  };

  $('#setImportSave').onchange = async (ev)=>{
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if(!file) return;
    try{
      const obj = await readJsonFile(file);
      const state = obj?.state || obj; // accept raw state too
      if(!state || typeof state !== 'object') throw new Error('存檔內容不正確');
      // light validation
      if(typeof state.lv !== 'number' || !state.inventory || !state.equipped) throw new Error('存檔缺少必要欄位');
      S = state;
      log('匯入存檔完成。');
      rerollShop();
      render();
    }catch(e){
      log('匯入失敗：' + e.message);
    }
  };

  $('#setExportBase').onclick = ()=>{
    const payload = {version: VERSION, type:'base', exportedAt: now.toISOString(), base: S.base};
    downloadJson(`mech_base_${VERSION}_${stamp}.json`, payload);
    log('已匯出 Base JSON。');
  };

  $('#setImportBase').onchange = async (ev)=>{
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if(!file) return;
    try{
      const obj = await readJsonFile(file);
      const base = obj?.base || obj;
      if(!base || typeof base !== 'object') throw new Error('Base 內容不正確');
      // validate keys
      const keys = ['hpMax','enMax','atk','def','crit','ls'];
      for(const k of keys){
        if(typeof base[k] !== 'number' || !isFinite(base[k])) throw new Error('Base 欄位缺失或不是數字：' + k);
      }
      // apply with clamps
      S.base = {
        hpMax: clamp(Math.floor(base.hpMax), 20, 9999),
        enMax: clamp(Math.floor(base.enMax), 10, 9999),
        atk:   clamp(Math.floor(base.atk),   1, 9999),
        def:   clamp(Math.floor(base.def),   0, 9999),
        crit:  clamp(Math.floor(base.crit),  0, 75),
        ls:    clamp(Math.floor(base.ls),    0, 40),
      };
      const st = stats();
      S.hp = clamp(S.hp, 0, st.hpMax);
      S.en = clamp(S.en, 0, st.enMax);
      log('匯入 Base 完成（已套用基礎屬性）。');
      render();
    }catch(e){
      log('匯入失敗：' + e.message);
    }
  };
}


function openModal(title, bodyHtml, actions){
  const dlg = $('#modal');
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  const ft = $('#modalActions');
  ft.innerHTML = '';
  for(const a of actions){
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.kind||'');
    btn.textContent = a.text;
    btn.onclick = ()=>{ if(a.onClick) a.onClick(); dlg.close(); };
    ft.appendChild(btn);
  }
  dlg.showModal();
}

async function boot(){
  setupTabs();
  $('#modalClose').onclick = ()=>$('#modal').close();

  await loadDB();

  const loaded=load();
  if(loaded){ S=loaded; log('讀取存檔完成。'); }
  else {
    S=defaultState();
    rerollShop();
    log('首次啟動：請點重置以領取新手裝備（或直接開始探索也可）。');
  }

  $('#btnExplore').onclick = explore;
  $('#btnRest').onclick = rest;
  $('#btnAttack').onclick = ()=>playerAttack(false);
  $('#btnSkill').onclick = ()=>playerAttack(true);
  $('#btnFlee').onclick = ()=>{
    const st=stats();
    const chance = clamp(0.45 + (st.bonus.flee||0)/100, 0.10, 0.90);
    if(pct(chance)){ blog('撤退成功。'); log('撤退成功。'); endBattle(false); }
    else { log('撤退失敗！'); enemyTurn(); }
  };

  $('#btnRerollShop').onclick = rerollShop;
  $('#btnSave').onclick = save;
  const btnSet = $('#btnSettings');
  if(btnSet) btnSet.onclick = openSettingsModal;

  $('#btnReset').onclick = ()=>openModal('確認重置','這會清除存檔並回到初始狀態。',[
    {text:'取消', kind:'', onClick: ()=>{}},
    {text:'確定重置', kind:'btn-danger', onClick: ()=>reset()}
  ]);
  $('#btnClearLog').onclick = ()=>{ S.log=[]; render(); };
  $('#btnSort').onclick = ()=>{ S.inventory.sort((a,b)=>{
    const da=getItemById(a.cat,a.id), db=getItemById(b.cat,b.id);
    const ra=rarityRank(da?.rarity||'普通'), rb=rarityRank(db?.rarity||'普通');
    if(rb!==ra) return rb-ra;
    return (db?.price||0)-(da?.price||0);
  }); log('背包已排序。'); render(); };
  $('#btnSalvageJunk').onclick = salvageJunk;

  const pfPrev=$('#btnPrevFloor'); if(pfPrev) pfPrev.onclick=prevFloor;
  const pfNext=$('#btnNextFloor'); if(pfNext) pfNext.onclick=nextFloor;

  // Battle modal buttons
  const bmA = $('#bmAttack'); if(bmA) bmA.onclick = ()=>playerAttack(false);
  const bmS = $('#bmSkill');  if(bmS) bmS.onclick = ()=>playerAttack(true);
  const bmF = $('#bmFlee');   if(bmF) bmF.onclick = ()=>$('#btnFlee').click();

  const dlgBattle = $('#battleModal');
  const bmClose = $('#bmClose');
  if(dlgBattle){
    dlgBattle.addEventListener('cancel', (e)=>{
      if(S.battle.active){ e.preventDefault(); }
    });
  }
  if(bmClose && dlgBattle){
    bmClose.onclick = ()=>{
      if(S.battle.active){
        blog('（提示）戰鬥進行中，無法關閉視窗。');
        log('戰鬥進行中，無法關閉戰鬥視窗。');
        render();
        return;
      }
      dlgBattle.close();
    };
  }

  setupEquipSlotModal();
  rerollShop();
  render();
}

window.addEventListener('DOMContentLoaded', boot);



/* ===== V0.1.4 PATCH: RPG battle + rolled stats + ratings + compare arrows ===== */

// Skills
const SKILLS = [
  {id:'power', name:'強力斬擊', cost:6, desc:'造成 160% 傷害，30% 機率使敵方「流血」(2回合，每回合-3HP)。'},
  {id:'guard', name:'防禦姿態', cost:5, desc:'2回合內防禦 +3（增益）。'},
  {id:'over',  name:'過載爆發', cost:10, desc:'造成 220% 傷害，但自身獲得「過熱」(2回合，每回合-3MP)。'}
];

let _autoTimer=null;

function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

function calcRating(cat, roll){
  if(cat==='weapon'){
    const score = (roll.atk||0)*5 + (roll.crit||0)*2 + (roll.ls||0)*3;
    return clamp(Math.round(score), 1, 99);
  }
  const score = (roll.def||0)*4 + (roll.hp||0)*0.6 + (roll.en||0)*0.7 + (roll.atk||0)*4 + (roll.crit||0)*2 + (roll.ls||0)*3;
  return clamp(Math.round(score), 1, 99);
}

function makeRangesFromTemplate(cat, t){
  const r = {};
  const keys = (cat==='weapon') ? ['atk','crit','ls'] : ['atk','def','hp','en','crit','ls'];
  for(const k of keys){
    const v = Number(t[k]||0);
    const rarity = t.rarity || '普通';
    const spreadLo = (rarity==='傳說')?3:(rarity==='菁英')?2:1;
    const spreadHi = (rarity==='傳說')?4:(rarity==='菁英')?3:2;
    const mn = (t[k+'_min']!=null) ? Number(t[k+'_min']) : v - spreadLo;
    const mx = (t[k+'_max']!=null) ? Number(t[k+'_max']) : v + spreadHi;
    r[k+'_min'] = Math.max(0, Math.floor(mn));
    r[k+'_max'] = Math.max(r[k+'_min'], Math.floor(mx));
  }
  return r;
}

function rollInstance(cat, template){
  const ranges = makeRangesFromTemplate(cat, template);
  const roll = {};
  if(cat==='weapon'){
    roll.atk  = randInt(ranges.atk_min, ranges.atk_max);
    roll.crit = randInt(ranges.crit_min, ranges.crit_max);
    roll.ls   = randInt(ranges.ls_min, ranges.ls_max);
  } else {
    roll.atk  = randInt(ranges.atk_min, ranges.atk_max);
    roll.def  = randInt(ranges.def_min, ranges.def_max);
    roll.hp   = randInt(ranges.hp_min, ranges.hp_max);
    roll.en   = randInt(ranges.en_min, ranges.en_max);
    roll.crit = randInt(ranges.crit_min, ranges.crit_max);
    roll.ls   = randInt(ranges.ls_min, ranges.ls_max);
  }
  const rating = calcRating(cat, roll);
  return {roll, rating};
}

function instStatsText(cat, inst, tpl){
  const r = (inst && inst.roll) ? inst.roll : {};
  if(cat==='weapon'){
    return `攻擊 +${(r.atk ?? tpl.atk)} · 暴擊 +${(r.crit ?? (tpl.crit||0))}% · 吸血 +${(r.ls ?? (tpl.ls||0))}%`;
  }
  if(cat==='equipment'){
    return `${partLabel(tpl.slot)} · 攻 +${(r.atk ?? (tpl.atk||0))} · 防 +${(r.def ?? (tpl.def||0))} · HP +${(r.hp ?? (tpl.hp||0))} · EN +${(r.en ?? (tpl.en||0))} · 暴擊 +${(r.crit ?? (tpl.crit||0))}% · 吸血 +${(r.ls ?? (tpl.ls||0))}%`;
  }
  return '';
}

function compareArrow(a,b){
  if(a==null || b==null) return '—';
  if(a>b) return '⬆️';
  if(a<b) return '⬇️';
  return '↔️';
}

function getEquippedRating(slot){
  const eq=getEquipped(slot);
  return eq?.inv?.rating ?? null;
}

function bestCompareForWeapon(inst){
  const r = inst?.rating ?? null;
  return `R:${compareArrow(r, getEquippedRating('weaponR'))} L:${compareArrow(r, getEquippedRating('weaponL'))}`;
}

function statusTagsHtml(side){
  const arr = (S.battleStatus && S.battleStatus[side]) ? S.battleStatus[side] : [];
  if(!arr.length) return '<span class="muted">（無）</span>';
  return arr.map(s=>{
    const cls = (side==='enemy') ? 'stTag stBad' : 'stTag stGood';
    return `<span class="${cls}">${escapeHtml(s.label)} · ${s.turns}</span>`;
  }).join('');
}

function addStatus(side, st){
  if(!S.battleStatus) S.battleStatus={player:[],enemy:[]};
  S.battleStatus[side].push(st);
}

function tickStatus(side){
  if(!S.battleStatus) S.battleStatus={player:[],enemy:[]};
  const arr=S.battleStatus[side];
  let dmg=0, mpLoss=0, guard=0;
  for(const s of arr){
    if(s.type==='bleed') dmg += s.value;
    if(s.type==='overheat') mpLoss += s.value;
    if(s.type==='guard') guard = Math.max(guard, s.value);
    s.turns -= 1;
  }
  S.battleStatus[side] = arr.filter(s=>s.turns>0);
  return {dmg, mpLoss, guard};
}

function stopAuto(){
  S.battleAuto=false;
  if(_autoTimer){ clearTimeout(_autoTimer); _autoTimer=null; }
}

function autoStep(){
  if(!S.battle.active) return;
  if(!S.battleAuto) return;
  if(S.en >= 6) castSkill('power');
  else playerAttack(false);
  if(S.battle.active && S.battleAuto){
    _autoTimer=setTimeout(autoStep, 450);
  }
}

function castSkill(id){
  const b=S.battle; if(!b.active) return;
  const sk = SKILLS.find(x=>x.id===id); if(!sk) return;
  if(S.en < sk.cost){ blog('MP 不足。'); log('MP 不足。'); render(); return; }
  S.en -= sk.cost;

  const st=stats();

  if(id==='guard'){
    addStatus('player', {type:'guard', label:'防禦+3', turns:2, value:3});
    blog('施放：防禦姿態（防禦+3，2回合）');
    log('施放：防禦姿態（防禦+3，2回合）');
    enemyTurn();
    return;
  }

  const mul = (id==='over') ? 2.2 : 1.6;
  let dmgBase = Math.floor(st.atk * mul) + rnd(0,3);
  dmgBase = Math.floor(dmgBase * (1 + (st.bonus.skillDmgPct||0)/100));
  let dmg = Math.max(1, dmgBase - Math.floor(b.enemy.def*0.6));

  const isCrit = pct(st.crit/100);
  if(isCrit){
    const cm = 1.6 + (st.bonus.critDmgPct||0)/100;
    dmg = Math.floor(dmg*cm);
  }

  b.enemyHp = Math.max(0, b.enemyHp - dmg);
  blog(`技能「${sk.name}」：-${dmg} HP${isCrit?'（暴擊）':''}`);
  log(`技能「${sk.name}」：-${dmg} HP${isCrit?'（暴擊）':''}`);

  if(id==='power' && pct(0.30)){
    addStatus('enemy', {type:'bleed', label:'流血', turns:2, value:3});
    blog('敵方受到「流血」(2回合)');
    log('敵方受到「流血」(2回合)');
  }
  if(id==='over'){
    addStatus('player', {type:'overheat', label:'過熱', turns:2, value:3});
    blog('自身進入「過熱」(2回合，每回合-3MP)');
    log('自身進入「過熱」(2回合，每回合-3MP)');
  }

  applyTurnRegen();
  if(b.enemyHp<=0) endBattle(true);
  else enemyTurn();
}

// Override computeBonuses to use rolled stats if present
function computeBonuses(){
  const b={ hp:0,en:0,atk:0,def:0,crit:0,ls:0,
    regenHp:0,regenEn:0,dmgReduce:0,flee:0,skillCostReduce:0,skillDmgPct:0,critDmgPct:0
  };
  const slots=['weaponR','weaponL','head','body','arms','legs','booster','core'];
  for(const s of slots){
    const eq=getEquipped(s);
    if(!eq) continue;
    const d=eq.data;
    const r=eq.inv.roll || {};
    b.atk += (r.atk ?? d.atk ?? 0);
    b.def += (r.def ?? d.def ?? 0);
    b.hp  += (r.hp  ?? d.hp  ?? 0);
    b.en  += (r.en  ?? d.en  ?? 0);
    b.crit += (r.crit ?? d.crit ?? 0);
    b.ls += (r.ls ?? d.ls ?? 0);
  }
  const counts=computeSetCounts();
  for(const [setId,cnt] of Object.entries(counts)){
    const sb=DB.set_bonus[setId];
    if(!sb) continue;
    if(cnt>=2) for(const [k,v] of Object.entries(sb.bonuses['2'])) b[k]+=v;
    if(cnt>=4) for(const [k,v] of Object.entries(sb.bonuses['4'])) b[k]+=v;
  }
  for(const bf of S.buffs){
    if(bf.type==='atk') b.atk+=bf.value;
    if(bf.type==='def') b.def+=bf.value;
    if(bf.type==='crit') b.crit+=bf.value;
  }
  return b;
}

// Override rollDrops: return rolled instances (not pushed yet)
function rollDrops(enemy){
  const res=[];
  const t=enemy.drops||{};
  function addInst(cat, chosen){
    if(cat==='weapon' || cat==='equipment'){
      const inst = rollInstance(cat, chosen);
      res.push({uid:safeId('inv'), cat, id:chosen.id, roll: inst.roll, rating: inst.rating});
    } else {
      res.push({uid:safeId('inv'), cat, id:chosen.id});
    }
  }
  function roll(cat, chance, pool){
    if(!pct(chance)) return;
    const rarity=weightedPickRarity();
    const candidates=pool.filter(x=>x.rarity===rarity);
    const chosen=pick(candidates.length?candidates:pool);
    addInst(cat, chosen);
  }
  roll('weapon', t.weapon||0, DB.weapons);
  roll('equipment', t.equipment||0, DB.equipment);
  if(pct(t.consumable||0)) res.push({uid:safeId('inv'), cat:'consumable', id:pick(DB.consumables).id});
  return res;
}

// Override shop reroll to include unknown stats
function rerollShop(){
  const floor=S.area.floor;
  const base=DB.drop_and_shop.shop_base_by_floor[String(floor)] || DB.drop_and_shop.shop_base_by_floor['1'];
  const n=base.count||6;
  const items=[];
  for(let i=0;i<n;i++){
    const cat=weightedPick(base.categories);
    const pool = (cat==='weapon') ? DB.weapons : (cat==='equipment') ? DB.equipment : DB.consumables;
    const rarity = weightedPick(base.rarity_weights);
    const candidates = pool.filter(x=>x.rarity===rarity);
    const chosen = pick(candidates.length?candidates:pool);
    const price = Math.max(5, Math.floor((chosen.price||10) * (1 + (floor-1)*0.08)));
    items.push({uid:safeId('shop'), cat, id:chosen.id, price, revealed:false});
  }
  S.shop={items};
  render();
}

// Override buyFromShop: roll on buy for weapon/equipment
function buyFromShop(uid){
  const it=S.shop.items.find(x=>x.uid===uid);
  if(!it) return;
  if(S.gold < it.price) return;
  const tpl=getItemById(it.cat,it.id);
  S.gold -= it.price;

  if(it.cat==='weapon' || it.cat==='equipment'){
    const inst = rollInstance(it.cat, tpl);
    S.inventory.push({uid:safeId('inv'), cat:it.cat, id:it.id, roll: inst.roll, rating: inst.rating});
  } else {
    S.inventory.push({uid:safeId('inv'), cat:it.cat, id:it.id});
  }

  S.shop.items=S.shop.items.filter(x=>x.uid!==uid);
  log(`購買：${tpl.name} (-${it.price} 金)`);
  render();
}

// Override renderShop: hide stats until bought (revealed flag not used because we roll on buy)
function renderShop(){
  const box=$('#shopList');
  if(!box) return;
  if(!S.shop?.items?.length){
    box.innerHTML = `<div class="muted">（商店暫無商品）</div>`;
    return;
  }
  box.innerHTML = S.shop.items.map(it=>{
    const d=getItemById(it.cat,it.id);
    const setBadge = d.set ? `<span class="badge">套裝：${escapeHtml(DB.set_bonus[d.set]?.name||d.set)}</span>` : '';
    const disabled = (S.gold < it.price) ? 'disabled' : '';
    const info = `<span class="muted">（購買後才會揭示隨機數值）</span>`;
    return `
      <div class="card">
        <div class="row">
          <div class="title">${escapeHtml(d.name)} ${rarityBadge(d.rarity)} ${setBadge}</div>
          <button class="btn btn-primary" ${disabled} onclick="buyFromShop('${it.uid}')">購買</button>
        </div>
        <div class="desc">${info}<br><span class="badge">評分：??</span> <span class="badge">價格：${it.price} 金</span></div>
      </div>
    `;
  }).join('');
}

// Override renderInventory to show rating + compare arrows + rolled stats
function renderInventory(){
  const box=$('#invList');
  if(!box) return;

  const items=S.inventory.slice().sort((a,b)=>{
    const A=getItemById(a.cat,a.id), B=getItemById(b.cat,b.id);
    const ra=rankRarity(A.rarity), rb=rankRarity(B.rarity);
    if(ra!==rb) return rb-ra;
    return (A.name||'').localeCompare(B.name||'');
  });

  box.innerHTML = items.map(it=>{
    const d=getItemById(it.cat,it.id);
    const eq=isEquipped(it.uid);
    const eqBadge = eq ? `<span class="badge">已裝備</span>` : '';
    const setBadge = d.set ? `<span class="badge">套裝：${escapeHtml(DB.set_bonus[d.set]?.name||d.set)}</span>` : '';
    const rating = it.rating || (it.cat==='consumable' ? '' : '1');

    let cmp='';
    if(it.cat==='weapon'){
      cmp = bestCompareForWeapon(it);
    } else if(it.cat==='equipment'){
      const slot=d.slot;
      cmp = `${slotName(slot)}:${compareArrow(it.rating, getEquippedRating(slot))}`;
    }

    const desc = (it.cat==='consumable')
      ? itemDesc(it.cat,d)
      : `${instStatsText(it.cat,it,d)}<br>被動：${escapeHtml(d.passive||'—')}<br><span class="badge">比對：${cmp}</span>`;

    return `
      <div class="card">
        <div class="row">
          <div class="title">${escapeHtml(d.name)} ${rarityBadge(d.rarity)} ${it.cat!=='consumable' ? `<span class="badge">評分：${rating}</span>`:''} ${setBadge} ${eqBadge}</div>
          <div class="row" style="gap:8px;">
            ${it.cat!=='consumable' ? `<button class="btn" onclick="equip('${it.uid}')">裝備</button>` : ''}
            <button class="btn" onclick="sell('${it.uid}')">出售</button>
          </div>
        </div>
        <div class="desc">${desc}</div>
      </div>
    `;
  }).join('');
}

// Ensure reset() gives rolled starter gear
const _resetOld = reset;
reset = function(){
  _resetOld();
  // Re-roll all existing weapon/equipment in inventory lacking roll
  S.inventory = S.inventory.map(it=>{
    if((it.cat==='weapon' || it.cat==='equipment') && !it.roll){
      const tpl=getItemById(it.cat,it.id);
      const inst=rollInstance(it.cat, tpl);
      return {...it, roll: inst.roll, rating: inst.rating};
    }
    return it;
  });
  render();
};

// Override startBattle to init turn/status/auto
function startBattle(){
  const enemy=structuredClone(pickEnemy());
  S.battle = { active:true, enemy, enemyHp:enemy.hp, enemyHpMax:enemy.hp, firstHitTaken:true };
  S.battleLog = [];
  S.battleTurn = 1;
  S.battleStatus = { player: [], enemy: [] };

  const rew = $('#bmRewards'); if(rew){ rew.style.display='none'; }
  blog(`遇敵：${enemy.name}（${enemy.role}）`);
  log(`遇敵：${enemy.name}（${enemy.role}）`);

  const dlg = $('#battleModal');
  if(dlg && !dlg.open) dlg.showModal();

  render();
  if(S.battleAuto){
    if(_autoTimer) clearTimeout(_autoTimer);
    _autoTimer=setTimeout(autoStep, 350);
  }
}

// Override enemyTurn: apply status ticks, guard buff, turn counter
function enemyTurn(){
  const b=S.battle; if(!b.active) return;

  // status ticks (start of enemy turn)
  const ed = tickStatus('enemy');
  if(ed.dmg>0){
    b.enemyHp = Math.max(0, b.enemyHp - ed.dmg);
    blog(`敵方流血：-${ed.dmg} HP`);
    log(`敵方流血：-${ed.dmg} HP`);
    if(b.enemyHp<=0){ endBattle(true); return; }
  }
  const pd = tickStatus('player');
  if(pd.mpLoss>0){
    S.en = Math.max(0, S.en - pd.mpLoss);
    blog(`我方過熱：-${pd.mpLoss} MP`);
    log(`我方過熱：-${pd.mpLoss} MP`);
  }

  S.battleTurn = (S.battleTurn||1) + 1;

  const st=stats();
  const guard = pd.guard || 0;

  let dmgBase = b.enemy.atk + rnd(0,2);
  // crit
  const isCrit = pct(0.12);
  if(isCrit) dmgBase = Math.floor(dmgBase*1.5);
  let dmg = Math.max(1, dmgBase - Math.floor((st.def+guard)*0.65));
  // damage reduce bonuses
  const dr = (st.bonus.dmgReduce||0)/100;
  dmg = Math.max(1, Math.floor(dmg*(1-dr)));

  S.hp = Math.max(0, S.hp - dmg);
  blog(`${b.enemy.name} 攻擊：-${dmg} HP${isCrit?'（暴擊）':''}`);
  log(`${b.enemy.name} 攻擊：-${dmg} HP${isCrit?'（暴擊）':''}`);

  applyTurnRegen();

  if(S.hp<=0){
    blog('你被擊敗了，回城修復。');
    log('你被擊敗了，回城修復。');
    S.hp = Math.floor(st.hpMax*0.5);
    S.en = Math.floor(st.enMax*0.5);
    stopAuto();
    endBattle(false);
    return;
  }

  render();

  // continue auto
  if(S.battle.active && S.battleAuto){
    if(_autoTimer) clearTimeout(_autoTimer);
    _autoTimer=setTimeout(autoStep, 450);
  }
}

// Override renderBattleModal: show turn, statuses, skills, log, rewards visibility
function renderBattleModal(){
  const dlg = $('#battleModal'); if(!dlg) return;
  const b=S.battle;
  const st=stats();

  const tEl=$('#bmTurn'); if(tEl) tEl.textContent = `回合 ${S.battleTurn||1}`;

  // player
  $('#bmPlayerHp').textContent = `${S.hp} / ${st.hpMax}`;
  $('#bmPlayerMp').textContent = `${S.en} / ${st.enMax}`;
  $('#bmPlayerAtk').textContent = st.atk;
  $('#bmPlayerDef').textContent = st.def;
  setBar('#bmPlayerHpBar', S.hp, st.hpMax);
  setBar('#bmPlayerMpBar', S.en, st.enMax);

  const ps=$('#bmPlayerStatus'); if(ps) ps.innerHTML = statusTagsHtml('player');
  const es=$('#bmEnemyStatus'); if(es) es.innerHTML = statusTagsHtml('enemy');

  if(!b.active){
    $('#bmEnemyName').textContent='—';
    $('#bmEnemyHp').textContent='—';
    $('#bmEnemyAtk').textContent='—';
    $('#bmEnemyDef').textContent='—';
    setBar('#bmEnemyHpBar', 0, 1);
    $('#bmHint').textContent = '未在戰鬥中。';
  } else {
    $('#bmEnemyName').textContent = `${b.enemy.name} · ${b.enemy.role}`;
    $('#bmEnemyHp').textContent = `${b.enemyHp} / ${b.enemyHpMax}`;
    $('#bmEnemyAtk').textContent = b.enemy.atk;
    $('#bmEnemyDef').textContent = b.enemy.def;
    setBar('#bmEnemyHpBar', b.enemyHp, b.enemyHpMax);
    $('#bmHint').textContent = '選擇普攻或施放技能。';
  }

  // log
  const box=$('#bmLogBox');
  if(box){
    const lines = S.battleLog.slice(0,80).reverse();
    box.innerHTML = lines.length ? lines.map(s=>`<div class="line">${escapeHtml(s)}</div>`).join('') : `<div class="line muted">（尚無戰鬥紀錄）</div>`;
    box.scrollTop = box.scrollHeight;
  }

  // skills
  const sk=$('#bmSkills');
  if(sk){
    sk.innerHTML = SKILLS.map(s=>{
      const dis = (!b.active || S.en < s.cost) ? 'disabled' : '';
      return `<div class="skillCard">
        <div class="skillTop">
          <div class="skillName">${escapeHtml(s.name)}</div>
          <div class="skillCost">MP ${s.cost}</div>
        </div>
        <div class="skillDesc">${escapeHtml(s.desc)}</div>
        <div class="skillBtnRow">
          <button class="btn btn-primary" ${dis} onclick="castSkill('${s.id}')">施放</button>
        </div>
      </div>`;
    }).join('');
  }

  // auto toggle sync
  const at=$('#bmAutoToggle'); if(at) at.checked = !!S.battleAuto;
}

// Override render() to include battle modal render
const _renderOld = render;
render = function(){
  _renderOld();
  renderBattleModal();
};

// Override endBattle to show loot cards + continue/leave
function endBattle(victory){
  const b=S.battle;
  if(!b.active) return;

  if(_autoTimer){ clearTimeout(_autoTimer); _autoTimer=null; }

  const dlg = $('#battleModal');
  const rewBox = $('#bmRewards');
  const meta = $('#bmRewardsMeta');
  const loot = $('#bmLoot');

  if(victory){
    const e=b.enemy;
    const g = e.gold + rnd(0, Math.max(3, Math.floor(e.gold*0.25)));
    S.gold += g;
    gainXP(e.xp);

    blog(`勝利！+${e.xp} EXP、+${g} 金`);
    log(`勝利！+${e.xp} EXP、+${g} 金`);

    let extra = '—';
    if(e.role==='Boss'){
      if((S.area.unlocked||1) < 10 && S.area.floor===S.area.unlocked){
        S.area.unlocked += 1;
        extra = `${S.area.unlocked}F`;
        blog(`Boss 擊破！已解鎖 ${S.area.unlocked}F。`);
        log(`Boss 擊破！已解鎖 ${S.area.unlocked}F。`);
      }
    }

    const drops=rollDrops(e);
    drops.forEach(it=>S.inventory.push(it));

    if(rewBox) rewBox.style.display='block';
    if(meta){
      meta.innerHTML = `<div>EXP：+${e.xp}</div><div>金幣：+${g}</div><div>解鎖：${escapeHtml(extra)}</div><div>掉落數：${drops.length}</div>`;
    }
    if(loot){
      loot.innerHTML = drops.length ? drops.map(it=>{
        const tpl=getItemById(it.cat,it.id);
        const rating = it.rating || 1;
        const sub = (it.cat==='consumable') ? escapeHtml(tpl.desc||'') : instStatsText(it.cat,it,tpl);
        return `<div class="lootCard">
          <div class="lootName">${escapeHtml(tpl.name)} ${rarityBadge(tpl.rarity||'')}</div>
          <div class="lootSub">評分：${rating}</div>
          <div class="lootSub">${sub}</div>
        </div>`;
      }).join('') : `<div class="muted">（無掉落）</div>`;
    }
  } else {
    if(rewBox) rewBox.style.display='block';
    if(meta) meta.innerHTML = `<div>EXP：0</div><div>金幣：0</div><div>解鎖：—</div><div>掉落數：0</div>`;
    if(loot) loot.innerHTML = `<div class="muted">（無）</div>`;
  }

  S.battle.active=false;
  tickBuffs(1);
  render();

  if(dlg && !dlg.open) dlg.showModal();
}

// Bind modal controls after boot (boot already exists; we attach here)
document.addEventListener('DOMContentLoaded', ()=>{
  const bmA = $('#bmAttack'); if(bmA) bmA.onclick = ()=>playerAttack(false);
  const bmF = $('#bmFlee');   if(bmF) bmF.onclick = ()=>$('#btnFlee')?.click();

  const dlg = $('#battleModal');
  const bmClose = $('#bmClose');
  if(dlg){
    dlg.addEventListener('cancel', (e)=>{ if(S.battle.active) e.preventDefault(); });
  }
  if(bmClose && dlg){
    bmClose.onclick = ()=>{
      if(S.battle.active){
        blog('（提示）戰鬥進行中，無法關閉視窗。');
        log('戰鬥進行中，無法關閉戰鬥視窗。');
        render();
        return;
      }
      dlg.close();
    };
  }

  const btnC = $('#bmContinue');
  if(btnC) btnC.onclick = ()=>{
    if(dlg) dlg.close();
    explore();
  };
  const btnL = $('#bmLeave');
  if(btnL) btnL.onclick = ()=>{
    if(dlg) dlg.close();
    stopAuto();
    render();
  };

  const auto = $('#bmAutoToggle');
  if(auto){
    auto.onchange = ()=>{
      S.battleAuto = !!auto.checked;
      if(S.battleAuto){
        blog('自動戰鬥：ON'); log('自動戰鬥：ON');
        if(S.battle.active){
          if(_autoTimer) clearTimeout(_autoTimer);
          _autoTimer=setTimeout(autoStep, 350);
        }
      } else {
        blog('自動戰鬥：OFF'); log('自動戰鬥：OFF');
        if(_autoTimer){ clearTimeout(_autoTimer); _autoTimer=null; }
      }
      render();
    };
  }
});






/* ===== V0.1.6 HOTFIX: safe helper aliases without redeclare ===== */
try{
  const g = globalThis;
  if(typeof g.slotName === 'undefined') g.slotName = (slot)=> (typeof partLabel==='function' ? (partLabel(slot)||slot) : slot);
  if(typeof g.rankRarity === 'undefined') g.rankRarity = (r)=> (typeof rarityRank==='function' ? rarityRank(r) : 0);
}catch(e){ /* ignore */ }


try{ if(DB && !DB.drop_and_shop && DB.drop_shop) DB.drop_and_shop=DB.drop_shop; }catch(e){}


/* ===== V0.1.8 HOTFIX: eliminate DB key conflicts + safe rankRarity binding ===== */

// rankRarity is referenced by patched inventory sort; ensure it exists without conflicting with existing consts.
if(typeof rankRarity === 'undefined'){
  // use existing rarityRank() if present, otherwise fall back to 0.
  var rankRarity = function(r){
    try{ return (typeof rarityRank==='function') ? rarityRank(r) : 0; }catch(e){ return 0; }
  };
}

// unify drop/shop db key (supports both DB.drop_and_shop and DB.drop_shop)
function getDropShop(){
  return DB.drop_and_shop || DB.drop_shop || null;
}

// Override rarity weight picker to support both keys + missing data
function weightedPickRarity(){
  const ds = getDropShop();
  const w = ds?.rarity_weight || ds?.rarityWeight || null;
  if(!w) return '普通';
  const entries=Object.entries(w);
  const total=entries.reduce((s,kv)=>s+Number(kv[1]||0),0);
  if(total<=0) return entries[0]?.[0] || '普通';
  let r=Math.random()*total;
  for(const [k,v] of entries){ r-=Number(v||0); if(r<=0) return k; }
  return entries[0][0];
}

// Override rerollShop to never crash when data key missing; accept both legacy/new formats
function rerollShop(){
  const ds = getDropShop();
  const floor = String(S.area.floor||1);
  const shopMap = ds?.shop_base_by_floor || ds?.shopBaseByFloor || null;
  const base = shopMap?.[floor] || shopMap?.['1'] || null;

  if(!base){
    S.shop={items:[]};
    render();
    return;
  }

  // legacy format uses pools
  if(base.weapons && base.equipment && base.consumables){
    function makeOffer(cat,id){
      const d=getItemById(cat,id);
      const price=(d.price||20)+rnd(0, Math.max(3, Math.floor((d.price||20)*0.15)));
      return {uid:safeId('shop'), cat, id, price, revealed:false};
    }
    const items=[];
    items.push(makeOffer('weapon', pick(base.weapons)));
    items.push(makeOffer('weapon', pick(base.weapons)));
    for(let i=0;i<3;i++) items.push(makeOffer('equipment', pick(base.equipment)));
    items.push(makeOffer('consumable', pick(base.consumables)));
    items.push(makeOffer('consumable', pick(base.consumables)));
    S.shop={items};
    render();
    return;
  }

  // newer weighted format
  const n=base.count||6;
  const items=[];
  for(let i=0;i<n;i++){
    const cat=weightedPick(base.categories);
    const pool = (cat==='weapon') ? DB.weapons : (cat==='equipment') ? DB.equipment : DB.consumables;
    const rarity = weightedPick(base.rarity_weights);
    const candidates = pool.filter(x=>x.rarity===rarity);
    const chosen = pick(candidates.length?candidates:pool);
    const price = Math.max(5, Math.floor((chosen.price||10) * (1 + (Number(floor)-1)*0.08)));
    items.push({uid:safeId('shop'), cat, id:chosen.id, price, revealed:false});
  }
  S.shop={items};
  render();
}
