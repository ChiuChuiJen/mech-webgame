/* V0.1.0 - No frameworks, GitHub Pages friendly */
'use strict';

const VERSION = '0.1.0';
const SAVE_KEY = 'mech_webgame_save_v' + VERSION;

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a,b)=> Math.floor(Math.random()*(b-a+1))+a;
const pick = (arr)=> arr[Math.floor(Math.random()*arr.length)];
const pct = (p)=> Math.random() < p;
const fmt = (n)=> (Math.round(n*100)/100).toString();

function rarityRank(r){
  return ({'普通':1,'菁英':2,'傳說':3}[r] ?? 0);
}

function safeId(prefix='it'){
  return prefix + '_' + Math.random().toString(36).slice(2,10);
}

// ---------- Data ----------
let DB = { weapons:[], armors:[], cores:[], consumables:[], set_bonus:{}, monsters:[], drop_shop:{} };

async function loadDB(){
  const files = [
    ['weapons','data/weapon.json'],
    ['armors','data/armor.json'],
    ['cores','data/core.json'],
    ['consumables','data/consumable.json'],
    ['set_bonus','data/set_bonus.json'],
    ['monsters','data/monsters.json'],
    ['drop_shop','data/drop_and_shop.json'],
  ];
  for(const [k, path] of files){
    const res = await fetch(path + '?v=' + VERSION);
    if(!res.ok) throw new Error('Failed to load ' + path);
    DB[k] = await res.json();
  }
}

// ---------- Game State ----------
const defaultState = ()=>({
  gold: 60,
  lv: 1,
  xp: 0,
  hp: 60,
  en: 30,
  base: { hpMax:60, enMax:30, atk:6, def:2, crit:3, ls:0 }, // crit, ls in %
  buffs: [], // {type,value,turns}
  inventory: [], // items: {uid, cat, id}
  equipped: { weaponR:null, weaponL:null, armor:null, core:null }, // store item uid
  area: { name:'新手區', depth: 1 },
  battle: { active:false, enemy:null, enemyHp:0, enemyHpMax:0, firstHit:true, firstHitTaken:true },
  shop: { items: [] }, // {uid, cat, id, price}
  log: []
});

let S = null;

// ---------- Item lookup ----------
function getItemById(cat, id){
  if(cat==='weapon') return DB.weapons.find(x=>x.id===id);
  if(cat==='armor') return DB.armors.find(x=>x.id===id);
  if(cat==='core') return DB.cores.find(x=>x.id===id);
  if(cat==='consumable') return DB.consumables.find(x=>x.id===id);
  return null;
}
function getInvItem(uid){
  return S.inventory.find(it=>it.uid===uid) || null;
}
function getEquippedItem(catSlot){
  const uid = S.equipped[catSlot];
  if(!uid) return null;
  const it = getInvItem(uid);
  return it ? { inv:it, data:getItemById(it.cat,it.id) } : null;
}

// ---------- Derived stats ----------
function computeSetCounts(){
  const slots = ['weaponR','weaponL','armor','core'];
  const setCount = {};
  for(const slot of slots){
    const eq = getEquippedItem(slot);
    if(!eq) continue;
    const setId = eq.data.set;
    if(!setId) continue;
    setCount[setId] = (setCount[setId]||0)+1;
  }
  return setCount;
}

function computeBonuses(){
  const b = {
    hp:0,en:0,atk:0,def:0,crit:0,ls:0,
    regenHp:0, regenEn:0, dmgReduce:0,
    flee:0, skillCostReduce:0, skillDmgPct:0, critDmgPct:0
  };

  const slots = ['weaponR','weaponL','armor','core'];
  for(const slot of slots){
    const eq = getEquippedItem(slot);
    if(!eq) continue;
    const d = eq.data;
    if(slot.startsWith('weapon')){
      b.atk += d.atk||0;
      b.crit += d.crit||0;
      b.ls += d.ls||0;
    } else if(slot==='armor'){
      b.def += d.def||0;
      b.hp += d.hp||0;
      b.en += d.en||0;
    } else if(slot==='core'){
      b.atk += d.atk||0;
      b.def += d.def||0;
      b.hp += d.hp||0;
      b.en += d.en||0;
    }
  }

  // set bonuses
  const counts = computeSetCounts();
  for(const [setId, cnt] of Object.entries(counts)){
    const sb = DB.set_bonus[setId];
    if(!sb) continue;
    if(cnt>=2){
      const bb = sb.bonuses['2'];
      for(const k of Object.keys(bb)) b[k] += bb[k];
    }
    if(cnt>=4){
      const bb = sb.bonuses['4'];
      for(const k of Object.keys(bb)) b[k] += bb[k];
    }
  }

  // buffs
  for(const bf of S.buffs){
    if(bf.type==='atk') b.atk += bf.value;
    if(bf.type==='def') b.def += bf.value;
    if(bf.type==='crit') b.crit += bf.value;
  }

  return b;
}

function stats(){
  const b = computeBonuses();
  const hpMax = S.base.hpMax + (S.lv-1)*10 + b.hp;
  const enMax = S.base.enMax + (S.lv-1)*5 + b.en;
  const atk = S.base.atk + (S.lv-1)*2 + b.atk;
  const def = S.base.def + Math.floor((S.lv-1)*1.1) + b.def;
  const crit = clamp(S.base.crit + b.crit, 0, 75);
  const ls = clamp(S.base.ls + b.ls, 0, 40);

  return { hpMax, enMax, atk, def, crit, ls, bonus:b };
}

function xpToNext(lv){
  // smooth-ish curve
  return Math.floor(40 + lv*lv*12);
}

function applyTurnRegen(){
  const st = stats();
  S.hp = clamp(S.hp + st.bonus.regenHp, 0, st.hpMax);
  S.en = clamp(S.en + st.bonus.regenEn, 0, st.enMax);
}

// ---------- Log ----------
function log(msg){
  const t = new Date().toLocaleTimeString('zh-Hant', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  S.log.unshift(`[${t}] ${msg}`);
  if(S.log.length>60) S.log.length = 60; // keep memory small; UI shows 10 but scrollable.
  renderLog();
}

// ---------- UI render ----------
function setBar(id, cur, max){
  const el = $(id);
  const pct = max<=0 ? 0 : clamp((cur/max)*100, 0, 100);
  el.style.width = pct + '%';
}

function rarityBadge(r){
  const map = {'普通':'普通','菁英':'菁英','傳說':'傳說'};
  return `<span class="badge">${map[r]||r}</span>`;
}

function itemTitle(cat, data){
  const catName = {weapon:'武器',armor:'裝甲',core:'核心',consumable:'補給'}[cat] || cat;
  return `${data.name} <span class="muted">(${catName})</span>`;
}

function itemDesc(cat, data){
  if(cat==='weapon'){
    return `攻擊 +${data.atk} · 暴擊 +${data.crit||0}% · 吸血 +${data.ls||0}%<br>被動：${data.passive}`;
  }
  if(cat==='armor'){
    return `防禦 +${data.def} · HP +${data.hp||0} · EN +${data.en||0}<br>被動：${data.passive}`;
  }
  if(cat==='core'){
    return `攻擊 +${data.atk||0} · 防禦 +${data.def||0} · HP +${data.hp||0} · EN +${data.en||0}<br>被動：${data.passive}`;
  }
  if(cat==='consumable'){
    return data.desc;
  }
  return '';
}

function render(){
  const st = stats();

  $('#lv').textContent = S.lv;
  $('#xp').textContent = `${S.xp} / ${xpToNext(S.lv)}`;
  setBar('#xpBar', S.xp, xpToNext(S.lv));

  $('#hp').textContent = `${S.hp} / ${st.hpMax}`;
  setBar('#hpBar', S.hp, st.hpMax);

  $('#en').textContent = `${S.en} / ${st.enMax}`;
  setBar('#enBar', S.en, st.enMax);

  $('#gold').textContent = S.gold;
  $('#pillArea').textContent = `區域：${S.area.name}`;

  $('#atk').textContent = st.atk;
  $('#def').textContent = st.def;
  $('#crit').textContent = st.crit;
  $('#ls').textContent = st.ls;

  // equipment labels
  const eqR = getEquippedItem('weaponR');
  const eqL = getEquippedItem('weaponL');
  const eqA = getEquippedItem('armor');
  const eqC = getEquippedItem('core');

  $('#eqWeaponR').textContent = eqR ? eqR.data.name : '—';
  $('#eqWeaponL').textContent = eqL ? eqL.data.name : '—';
  $('#eqArmor').textContent = eqA ? eqA.data.name : '—';
  $('#eqCore').textContent = eqC ? eqC.data.name : '—';

  // set progress
  const counts = computeSetCounts();
  const setId = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  if(setId){
    const sb = DB.set_bonus[setId];
    const cnt = counts[setId];
    const p = `套裝：${sb.name}（${Math.min(cnt,4)}/4） · 2件：${sb['2']} · 4件：${sb['4']}`;
    $('#setProgress').textContent = p;
  }else{
    $('#setProgress').textContent = '套裝：—';
  }

  // passives summary (including dual weapons)
  const pass = [];
  if(eqR) pass.push(`右手：${eqR.data.passive}`);
  if(eqL) pass.push(`左手：${eqL.data.passive}`);
  if(eqA) pass.push(`裝甲：${eqA.data.passive}`);
  if(eqC) pass.push(`核心：${eqC.data.passive}`);
  $('#passives').textContent = pass.length ? `被動：${pass.join(' / ')}` : '被動：—';

  renderBattle();
  renderInventory();
  renderShop();
  renderLog();
}

function renderLog(){
  const box = $('#logBox');
  if(!box) return;
  const show = S.log.slice(0, 10);
  box.innerHTML = show.map(s=>`<div class="entry">${escapeHtml(s)}</div>`).join('') || `<div class="entry muted">（尚無紀錄）</div>`;
}

function renderBattle(){
  const b = S.battle;
  const active = b.active;
  $('#btnAttack').disabled = !active;
  $('#btnSkill').disabled = !active;
  $('#btnFlee').disabled = !active;

  if(!active){
    $('#enemyName').textContent = '—';
    $('#enemyHp').textContent = '—';
    $('#enemyInfo').textContent = '—';
    $('#battleHint').textContent = '先探索以遇敵。';
    setBar('#enemyHpBar', 0, 1);
    return;
  }

  $('#enemyName').textContent = b.enemy.name + ` · ${b.enemy.tier}`;
  $('#enemyHp').textContent = `${b.enemyHp} / ${b.enemyHpMax}`;
  setBar('#enemyHpBar', b.enemyHp, b.enemyHpMax);
  $('#enemyInfo').textContent = `等級 ${b.enemy.lv} · 攻 ${b.enemy.atk} · 防 ${b.enemy.def}`;
  $('#battleHint').textContent = '選擇攻擊或技能。';
}

function renderInventory(){
  const list = $('#invList');
  if(!list) return;

  const items = S.inventory.slice().sort((a,b)=>{
    const da = getItemById(a.cat,a.id); const db = getItemById(b.cat,b.id);
    const ra = rarityRank(da?.rarity||'普通'); const rb = rarityRank(db?.rarity||'普通');
    if(rb!==ra) return rb-ra;
    return (db?.price||0)-(da?.price||0);
  });

  if(!items.length){
    list.innerHTML = `<div class="item"><div class="meta"><div class="title">背包是空的</div><div class="desc">去探索或雜貨店看看。</div></div></div>`;
    return;
  }

  list.innerHTML = items.map(it=>{
    const d = getItemById(it.cat,it.id);
    const eq = isEquipped(it.uid);
    const setBadge = d.set ? `<span class="badge">套裝：${DB.set_bonus[d.set]?.name || d.set}</span>` : '';
    const extra = eq ? `<span class="badge">已裝備</span>` : '';
    const act = inventoryActions(it, d, eq);
    return `
      <div class="item">
        <div class="meta">
          <div class="title">${itemTitle(it.cat,d)} ${rarityBadge(d.rarity)} ${setBadge} ${extra}</div>
          <div class="desc">${itemDesc(it.cat,d)}</div>
        </div>
        <div class="actions">${act}</div>
      </div>
    `;
  }).join('');
}

function renderShop(){
  const list = $('#shopList');
  if(!list) return;
  const items = S.shop.items;

  if(!items.length){
    list.innerHTML = `<div class="item"><div class="meta"><div class="title">雜貨店尚未上架</div><div class="desc">點「刷新」來生成販售清單。</div></div></div>`;
    return;
  }

  list.innerHTML = items.map(it=>{
    const d = getItemById(it.cat,it.id);
    const setBadge = d.set ? `<span class="badge">套裝：${DB.set_bonus[d.set]?.name || d.set}</span>` : '';
    const disabled = S.gold < it.price ? 'disabled' : '';
    return `
      <div class="item">
        <div class="meta">
          <div class="title">${itemTitle(it.cat,d)} ${rarityBadge(d.rarity)} ${setBadge}</div>
          <div class="desc">${itemDesc(it.cat,d)}<br><span class="badge">價格：${it.price} 金</span></div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" ${disabled} data-buy="${it.uid}">購買</button>
        </div>
      </div>
    `;
  }).join('');

  // bind buy
  $$('[data-buy]').forEach(btn=>{
    btn.onclick = ()=>{
      const uid = btn.getAttribute('data-buy');
      buyFromShop(uid);
    };
  });
}

// ---------- Inventory actions ----------
function isEquipped(uid){
  return Object.values(S.equipped).includes(uid);
}

function inventoryActions(invIt, data, equipped){
  const parts = [];
  if(invIt.cat==='weapon'){
    parts.push(`<button class="btn btn-primary" data-eq="weaponR:${invIt.uid}">裝右手</button>`);
    parts.push(`<button class="btn btn-primary" data-eq="weaponL:${invIt.uid}">裝左手</button>`);
  }else if(invIt.cat==='armor'){
    parts.push(`<button class="btn btn-primary" data-eq="armor:${invIt.uid}">裝備</button>`);
  }else if(invIt.cat==='core'){
    parts.push(`<button class="btn btn-primary" data-eq="core:${invIt.uid}">裝備</button>`);
  }else if(invIt.cat==='consumable'){
    parts.push(`<button class="btn btn-primary" data-use="${invIt.uid}">使用</button>`);
  }
  if(equipped){
    parts.push(`<button class="btn" data-uneq="${invIt.uid}">解除</button>`);
  }
  const sellPrice = Math.max(1, Math.floor((data.price||10)*0.55));
  parts.push(`<button class="btn btn-danger" data-sell="${invIt.uid}">販售 +${sellPrice}</button>`);
  parts.push(`<button class="btn btn-danger" data-salv="${invIt.uid}">分解</button>`);
  return parts.join('');
}

function bindInventoryButtons(){
  $$('[data-eq]').forEach(btn=>{
    btn.onclick = ()=>{
      const [slot, uid] = btn.getAttribute('data-eq').split(':');
      equip(slot, uid);
    };
  });
  $$('[data-uneq]').forEach(btn=>{
    btn.onclick = ()=> unequip(btn.getAttribute('data-uneq'));
  });
  $$('[data-sell]').forEach(btn=>{
    btn.onclick = ()=> sell(btn.getAttribute('data-sell'));
  });
  $$('[data-salv]').forEach(btn=>{
    btn.onclick = ()=> salvage(btn.getAttribute('data-salv'));
  });
  $$('[data-use]').forEach(btn=>{
    btn.onclick = ()=> useConsumable(btn.getAttribute('data-use'));
  });
}

function equip(slot, uid){
  // slot is weaponR, weaponL, armor, core
  // ensure uid exists
  const inv = getInvItem(uid);
  if(!inv) return;

  // prevent equipping a consumable
  if(slot.startsWith('weapon') && inv.cat!=='weapon') return;
  if(slot==='armor' && inv.cat!=='armor') return;
  if(slot==='core' && inv.cat!=='core') return;

  S.equipped[slot] = uid;
  log(`裝備：${slotName(slot)} ← ${getItemById(inv.cat,inv.id).name}`);
  render();
  bindInventoryButtons();
}

function unequip(uid){
  for(const k of Object.keys(S.equipped)){
    if(S.equipped[k]===uid) S.equipped[k]=null;
  }
  log(`解除裝備：${uid}`);
  render();
  bindInventoryButtons();
}

function slotName(s){
  return ({weaponR:'右手', weaponL:'左手', armor:'裝甲', core:'核心'}[s]||s);
}

// ---------- Shop ----------
function rerollShop(){
  const base = DB.drop_shop.shop_base;
  const items = [];

  // 2 weapons, 1 armor, 1 core, 2 consumables
  const pool = [
    ...base.weapons.map(id=>({cat:'weapon',id})),
    ...base.armors.map(id=>({cat:'armor',id})),
    ...base.cores.map(id=>({cat:'core',id})),
    ...base.consumables.map(id=>({cat:'consumable',id})),
  ];

  function makeOffer(cat, id){
    const d = getItemById(cat,id);
    const price = (d.price||20) + rnd(0, Math.max(3, Math.floor((d.price||20)*0.15)));
    return {uid: safeId('shop'), cat, id, price};
  }

  items.push(makeOffer('weapon', pick(base.weapons)));
  items.push(makeOffer('weapon', pick(base.weapons)));
  items.push(makeOffer('armor', pick(base.armors)));
  items.push(makeOffer('core', pick(base.cores)));
  items.push(makeOffer('consumable', pick(base.consumables)));
  items.push(makeOffer('consumable', pick(base.consumables)));

  S.shop.items = items;
  log('雜貨店已刷新。');
  render();
}

function buyFromShop(uid){
  const it = S.shop.items.find(x=>x.uid===uid);
  if(!it) return;
  if(S.gold < it.price) return;

  S.gold -= it.price;
  S.inventory.push({uid: safeId('inv'), cat: it.cat, id: it.id});
  S.shop.items = S.shop.items.filter(x=>x.uid!==uid);
  log(`購買：${getItemById(it.cat,it.id).name} (-${it.price} 金)`);
  render();
  bindInventoryButtons();
}

// ---------- Economy ----------
function sell(uid){
  const inv = getInvItem(uid);
  if(!inv) return;
  const d = getItemById(inv.cat,inv.id);
  const gain = Math.max(1, Math.floor((d.price||10)*0.55));
  unequip(uid);
  S.inventory = S.inventory.filter(x=>x.uid!==uid);
  S.gold += gain;
  log(`販售：${d.name} (+${gain} 金)`);
  render();
  bindInventoryButtons();
}

function salvage(uid){
  const inv = getInvItem(uid);
  if(!inv) return;
  const d = getItemById(inv.cat,inv.id);
  const gain = Math.max(1, Math.floor((d.price||10)*0.25)) + rarityRank(d.rarity)*2;
  unequip(uid);
  S.inventory = S.inventory.filter(x=>x.uid!==uid);
  S.gold += gain;
  log(`分解：${d.name} (+${gain} 金)`);
  render();
  bindInventoryButtons();
}

function salvageJunk(){
  // salvage rarity=普通 only (not equipped)
  const before = S.inventory.length;
  const keep = [];
  let gain = 0;
  for(const it of S.inventory){
    const d = getItemById(it.cat,it.id);
    const eq = isEquipped(it.uid);
    if(eq || (d && d.rarity!=='普通')){
      keep.push(it);
    } else {
      gain += Math.max(1, Math.floor((d.price||10)*0.25));
    }
  }
  const removed = before - keep.length;
  if(removed<=0){ log('沒有可分解的普通物品。'); return; }
  S.inventory = keep;
  S.gold += gain;
  log(`分解普通物品 ${removed} 件 (+${gain} 金)`);
  render();
  bindInventoryButtons();
}

// ---------- Consumables / Buffs ----------
function useConsumable(uid){
  const inv = getInvItem(uid);
  if(!inv || inv.cat!=='consumable') return;
  const d = getItemById(inv.cat,inv.id);
  const st = stats();
  if(d.kind==='heal'){
    const before = S.hp;
    S.hp = clamp(S.hp + d.hp, 0, st.hpMax);
    log(`使用：${d.name} (HP ${before}→${S.hp})`);
  } else if(d.kind==='energy'){
    const before = S.en;
    S.en = clamp(S.en + d.en, 0, st.enMax);
    log(`使用：${d.name} (EN ${before}→${S.en})`);
  } else if(d.kind==='buff'){
    S.buffs.push({type:d.buff, value:d.value, turns:d.turns});
    log(`使用：${d.name}（${d.turns} 回合 ${d.buff.toUpperCase()}+${d.value}）`);
  }
  S.inventory = S.inventory.filter(x=>x.uid!==uid);
  render();
  bindInventoryButtons();
}

// ---------- Battle ----------
function pickEnemy(){
  // based on area depth and player level
  const lv = S.lv;
  const pool = DB.monsters.filter(m => m.lv <= lv+1);
  return pick(pool.length?pool:DB.monsters);
}

function startBattle(){
  const enemy = structuredClone(pickEnemy());
  const scale = 1 + (S.area.depth-1)*0.12;
  enemy.hp = Math.floor(enemy.hp * scale);
  enemy.atk = Math.floor(enemy.atk * scale);
  enemy.def = Math.floor(enemy.def * scale);
  enemy.xp = Math.floor(enemy.xp * scale);
  enemy.gold = Math.floor(enemy.gold * scale);

  S.battle = { active:true, enemy, enemyHp: enemy.hp, enemyHpMax: enemy.hp, firstHit:true, firstHitTaken:true };
  log(`遇敵：${enemy.name}（${enemy.tier}）`);
  render();
}

function endBattle(victory){
  const b = S.battle;
  if(!b.active) return;
  if(victory){
    const enemy = b.enemy;
    const goldGain = enemy.gold + rnd(0, Math.max(3, Math.floor(enemy.gold*0.25)));
    const xpGain = enemy.xp;
    S.gold += goldGain;
    gainXP(xpGain);
    log(`勝利！獲得：+${xpGain} EXP、+${goldGain} 金`);

    // drops
    const drops = rollDrops(enemy);
    if(drops.length){
      for(const it of drops) S.inventory.push(it);
      log(`掉落：${drops.map(it=>getItemById(it.cat,it.id).name).join('、')}`);
    } else {
      log('沒有掉落。');
    }
  } else {
    log('戰鬥結束。');
  }

  S.battle.active = false;
  // reduce buff turns on battle end
  tickBuffs(1);
  render();
  bindInventoryButtons();
}

function tickBuffs(turns=1){
  if(!S.buffs.length) return;
  for(const bf of S.buffs) bf.turns -= turns;
  S.buffs = S.buffs.filter(bf=>bf.turns>0);
}

function playerAttack(isSkill=false){
  const b = S.battle;
  if(!b.active) return;
  const st = stats();

  // costs
  const baseSkillCost = 6;
  const costReduce = st.bonus.skillCostReduce||0;
  if(isSkill){
    const cost = Math.max(1, baseSkillCost - costReduce);
    if(S.en < cost){
      log('能量不足，無法施放技能。');
      return;
    }
    S.en -= cost;
  }

  // damage
  let dmgBase = st.atk + rnd(0,3);
  if(isSkill){
    dmgBase = Math.floor(dmgBase * 1.35);
    dmgBase += rnd(1,4);
    dmgBase = Math.floor(dmgBase * (1 + (st.bonus.skillDmgPct||0)/100));
  }

  // dual wield nuance: right-hand gives small flat bonus to normal, left-hand boosts skill a bit
  const eqR = getEquippedItem('weaponR');
  const eqL = getEquippedItem('weaponL');
  if(eqR && !isSkill) dmgBase += 1;
  if(eqL && isSkill) dmgBase += 2;

  const enemyDef = b.enemy.def;
  let dmg = Math.max(1, dmgBase - Math.floor(enemyDef*0.6));

  // crit
  const critChance = st.crit/100;
  let isCrit = pct(critChance);
  if(isCrit){
    const critMul = 1.6 + (st.bonus.critDmgPct||0)/100;
    dmg = Math.floor(dmg * critMul);
  }

  // apply to enemy
  b.enemyHp = Math.max(0, b.enemyHp - dmg);

  // lifesteal
  const ls = st.ls/100;
  if(ls>0){
    const heal = Math.max(0, Math.floor(dmg * ls));
    const before = S.hp;
    S.hp = clamp(S.hp + heal, 0, st.hpMax);
    if(heal>0) log(`吸血：+${heal} HP（${before}→${S.hp}）`);
  }

  log(`${isSkill?'技能':'攻擊'}命中 ${b.enemy.name}：-${dmg} HP${isCrit?'（暴擊）':''}`);

  // regen per action (set bonuses)
  applyTurnRegen();

  if(b.enemyHp<=0){
    endBattle(true);
    return;
  }

  enemyTurn();
}

function enemyTurn(){
  const b = S.battle;
  const st = stats();
  if(!b.active) return;

  let dmgBase = b.enemy.atk + rnd(0,2);
  // armor passive: first hit reduction in battle
  const armor = getEquippedItem('armor');
  if(armor && armor.data.passive.includes('首次') && b.firstHitTaken){
    dmgBase = Math.floor(dmgBase * 0.5);
    b.firstHitTaken = false;
    log('裝甲被動觸發：首次受擊減半。');
  }

  let dmg = Math.max(1, dmgBase - Math.floor(st.def*0.65));

  // set dmgReduce
  dmg = Math.max(1, dmg - (st.bonus.dmgReduce||0));

  // enemy crit chance small
  const eCrit = 0.08 + b.enemy.lv*0.01;
  const isCrit = pct(Math.min(0.20, eCrit));
  if(isCrit) dmg = Math.floor(dmg*1.45);

  const before = S.hp;
  S.hp = Math.max(0, S.hp - dmg);

  log(`${b.enemy.name} 反擊：-${dmg} HP${isCrit?'（暴擊）':''}`);

  applyTurnRegen();

  if(S.hp<=0){
    log('你的機甲被擊破！損失少量金幣並回到安全區。');
    const lost = Math.min(S.gold, Math.floor(15 + S.lv*5));
    S.gold -= lost;
    const st2 = stats();
    S.hp = Math.floor(st2.hpMax * 0.65);
    S.en = Math.floor(st2.enMax * 0.65);
    S.battle.active = false;
    S.area.depth = 1;
    S.area.name = '新手區';
    log(`損失：-${lost} 金`);
    render();
    return;
  }

  // buffs tick per round
  tickBuffs(1);
  render();
}

// ---------- Drops ----------
function weightedPickRarity(){
  const w = DB.drop_shop.rarity_weight;
  const entries = Object.entries(w);
  const total = entries.reduce((s,[,v])=>s+v,0);
  let r = Math.random()*total;
  for(const [k,v] of entries){
    r -= v;
    if(r<=0) return k;
  }
  return entries[0][0];
}

function rollDrops(enemy){
  const res = [];
  const table = enemy.drops || {};

  function roll(cat, chance, pool){
    if(!pct(chance)) return;
    const rarity = weightedPickRarity();
    const candidates = pool.filter(it=>it.rarity===rarity);
    const chosen = pick((candidates.length?candidates:pool));
    res.push({uid: safeId('inv'), cat, id: chosen.id});
  }

  roll('weapon', table.weapon||0, DB.weapons);
  roll('armor', table.armor||0, DB.armors);
  roll('core', table.core||0, DB.cores);
  if(pct(table.consumable||0)){
    const chosen = pick(DB.consumables);
    res.push({uid: safeId('inv'), cat:'consumable', id: chosen.id});
  }

  return res;
}

// ---------- Progression ----------
function gainXP(x){
  S.xp += x;
  while(S.xp >= xpToNext(S.lv)){
    S.xp -= xpToNext(S.lv);
    S.lv += 1;
    const st = stats();
    S.hp = clamp(S.hp + 12, 0, st.hpMax);
    S.en = clamp(S.en + 6, 0, st.enMax);
    log(`升等！現在等級 ${S.lv}。`);
  }
}

// ---------- Explore / Rest ----------
function explore(){
  // chance to find loot without battle
  if(pct(0.12)){
    const enemy = pickEnemy();
    const drop = rollDrops(enemy);
    if(drop.length){
      for(const it of drop) S.inventory.push(it);
      log(`探索發現戰利品：${drop.map(it=>getItemById(it.cat,it.id).name).join('、')}`);
    } else {
      log('探索沒有發現任何戰利品。');
    }
  }

  // always start battle
  startBattle();

  // area progression
  if(pct(0.25)){
    S.area.depth = clamp(S.area.depth + 1, 1, 20);
    S.area.name = `廢土區·深度${S.area.depth}`;
    log(`深入區域：${S.area.name}`);
  }
  render();
}

function rest(){
  const st = stats();
  const hpBefore = S.hp, enBefore = S.en;
  S.hp = clamp(S.hp + 18, 0, st.hpMax);
  S.en = clamp(S.en + 10, 0, st.enMax);
  log(`休整：HP ${hpBefore}→${S.hp}，EN ${enBefore}→${S.en}`);
  // passive regen ticks a bit
  applyTurnRegen();
  render();
}

// ---------- Modal ----------
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
    btn.onclick = ()=>{
      if(a.onClick) a.onClick();
      dlg.close();
    };
    ft.appendChild(btn);
  }
  dlg.showModal();
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

// ---------- Save / Load ----------
function save(){
  const payload = JSON.stringify(S);
  localStorage.setItem(SAVE_KEY, payload);
  log('存檔完成。');
}

function load(){
  const raw = localStorage.getItem(SAVE_KEY);
  if(!raw) return null;
  try{
    const data = JSON.parse(raw);
    return data;
  }catch(e){
    console.warn('load failed', e);
    return null;
  }
}

function reset(){
  localStorage.removeItem(SAVE_KEY);
  S = defaultState();
  // starter gear
  S.inventory.push({uid:safeId('inv'), cat:'weapon', id:'w_001'});
  S.inventory.push({uid:safeId('inv'), cat:'weapon', id:'w_002'});
  S.inventory.push({uid:safeId('inv'), cat:'armor', id:'a_001'});
  S.inventory.push({uid:safeId('inv'), cat:'core', id:'c_001'});
  S.inventory.push({uid:safeId('inv'), cat:'consumable', id:'p_001'});
  S.equipped.weaponR = S.inventory[0].uid;
  S.equipped.weaponL = S.inventory[1].uid;
  S.equipped.armor = S.inventory[2].uid;
  S.equipped.core = S.inventory[3].uid;
  rerollShop();
  log('已重置到初始狀態。');
  render();
  bindInventoryButtons();
}

function sortInventory(){
  S.inventory.sort((a,b)=>{
    const da = getItemById(a.cat,a.id); const db = getItemById(b.cat,b.id);
    const ra = rarityRank(da?.rarity||'普通'); const rb = rarityRank(db?.rarity||'普通');
    if(rb!==ra) return rb-ra;
    return (db?.price||0)-(da?.price||0);
  });
  log('背包已排序。');
  render();
  bindInventoryButtons();
}

// ---------- Tabs ----------
function setupTabs(){
  $$('.tab').forEach(t=>{
    t.onclick = ()=>{
      $$('.tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.getAttribute('data-tab');
      $$('.pane').forEach(p=>p.classList.remove('active'));
      $('#pane-' + tab).classList.add('active');
    };
  });
}

// ---------- Equipment slot modal ----------
function setupEquipSlotModal(){
  const slots = [
    ['#eqWeaponR','weaponR','武器（右手）','weapon'],
    ['#eqWeaponL','weaponL','武器（左手）','weapon'],
    ['#eqArmor','armor','裝甲','armor'],
    ['#eqCore','core','核心','core'],
  ];
  for(const [sel, slot, title, cat] of slots){
    $(sel).onclick = ()=>{
      const items = S.inventory.filter(it=>it.cat===cat);
      const body = items.length ? items.map(it=>{
        const d = getItemById(it.cat,it.id);
        const eq = (S.equipped[slot]===it.uid);
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

      openModal(title, body, [
        {text:'關閉', kind:'', onClick: ()=>{}}
      ]);

      // bind
      $$('[data-modal-eq]').forEach(b=>{
        b.onclick = ()=>{
          const [sl, uid] = b.getAttribute('data-modal-eq').split(':');
          equip(sl, uid);
          $('#modal').close();
        };
      });
    };
  }
}

// ---------- Boot ----------
async function boot(){
  setupTabs();
  $('#modalClose').onclick = ()=> $('#modal').close();

  await loadDB();

  const loaded = load();
  if(loaded){
    S = loaded;
    log('讀取存檔完成。');
  } else {
    S = defaultState();
    // starter gear
    S.inventory.push({uid:safeId('inv'), cat:'weapon', id:'w_001'});
    S.inventory.push({uid:safeId('inv'), cat:'weapon', id:'w_002'});
    S.inventory.push({uid:safeId('inv'), cat:'armor', id:'a_001'});
    S.inventory.push({uid:safeId('inv'), cat:'core', id:'c_001'});
    S.inventory.push({uid:safeId('inv'), cat:'consumable', id:'p_001'});
    S.equipped.weaponR = S.inventory[0].uid;
    S.equipped.weaponL = S.inventory[1].uid;
    S.equipped.armor = S.inventory[2].uid;
    S.equipped.core = S.inventory[3].uid;
    rerollShop();
    log('首次啟動：已發放新手裝備。');
  }

  // buttons
  $('#btnExplore').onclick = explore;
  $('#btnRest').onclick = rest;
  $('#btnAttack').onclick = ()=>playerAttack(false);
  $('#btnSkill').onclick = ()=>playerAttack(true);
  $('#btnFlee').onclick = ()=>{
    const st = stats();
    const base = 0.45;
    const bonus = (st.bonus.flee||0)/100;
    const chance = clamp(base + bonus, 0.1, 0.9);
    if(pct(chance)){
      log('撤退成功。');
      S.battle.active = false;
      tickBuffs(1);
      render();
    } else {
      log('撤退失敗！');
      enemyTurn();
    }
  };

  $('#btnRerollShop').onclick = rerollShop;
  $('#btnSave').onclick = save;
  $('#btnReset').onclick = ()=>{
    openModal('確認重置', '這會清除 localStorage 存檔並回到初始狀態。', [
      {text:'取消', kind:'', onClick: ()=>{}},
      {text:'確定重置', kind:'btn-danger', onClick: ()=>reset()},
    ]);
  };

  $('#btnClearLog').onclick = ()=>{ S.log = []; render(); };
  $('#btnSort').onclick = ()=>{ sortInventory(); };
  $('#btnSalvageJunk').onclick = ()=>{ salvageJunk(); };
  $('#btnRerollShop').onclick = ()=>{ rerollShop(); };

  setupEquipSlotModal();

  render();
  bindInventoryButtons();
}

window.addEventListener('DOMContentLoaded', boot);
