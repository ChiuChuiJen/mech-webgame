/* V0.1.1 - No frameworks, GitHub Pages friendly */
'use strict';

const VERSION = '0.1.1';
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
    ['drop_shop','data/drop_and_shop.json'],
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
  log(`遇敵：${enemy.name}（${enemy.role}）`);
  render();
}

function endBattle(victory){
  const b=S.battle;
  if(!b.active) return;
  if(victory){
    const e=b.enemy;
    const g = e.gold + rnd(0, Math.max(3, Math.floor(e.gold*0.25)));
    S.gold += g;
    gainXP(e.xp);
    log(`勝利！+${e.xp} EXP、+${g} 金`);
    if(e.role==='Boss'){
      if((S.area.unlocked||1) < 10 && S.area.floor===S.area.unlocked){
        S.area.unlocked += 1;
        log(`Boss 擊破！已解鎖 ${S.area.unlocked}F。`);
      }
    }
    const drops=rollDrops(e);
    if(drops.length){
      drops.forEach(it=>S.inventory.push(it));
      log(`掉落：${drops.map(it=>getItemById(it.cat,it.id).name).join('、')}`);
    } else {
      log('沒有掉落。');
    }
  }
  S.battle.active=false;
  tickBuffs(1);
  render();
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
    if(heal>0){ S.hp = clamp(S.hp + heal, 0, st.hpMax); log(`吸血：+${heal} HP`); }
  }

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
    if(pct(chance)){ log('撤退成功。'); S.battle.active=false; tickBuffs(1); render(); }
    else { log('撤退失敗！'); enemyTurn(); }
  };

  $('#btnRerollShop').onclick = rerollShop;
  $('#btnSave').onclick = save;
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

  setupEquipSlotModal();
  rerollShop();
  render();
}

window.addEventListener('DOMContentLoaded', boot);
