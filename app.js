(() => {
  const SHEETS_URL = window.SHEETS_URL || '';
  const SHEETS_KEY = window.SHEETS_KEY || '';
  const GITHUB_IMG_API = "https://api.github.com/repos/rkworks2025-coder/TJM_work/contents/img";
  // 送信(POST)の応答が遅いままトーストが出ない事象への対策：
  // 一定時間で「応答待ち」の表示に切り替える（実際の通信は中断しない）
  const SUBMIT_TIMEOUT_MS = 15000;

  let isSingleMode = false;
  let currentFocusInput = null;
  let lastRowElement = null; 
  let audioCtx = null; 

  const form = document.getElementById('form');
  const submitBtn = document.getElementById('submitBtn');
  const toast = document.getElementById('toast');
  const resultCard = document.getElementById('resultCard');
  const resHeader  = document.getElementById('res_header');
  const resLines   = document.getElementById('res_lines');
  const backBtn    = document.getElementById('backBtn');
  const resendBtn  = document.getElementById('resendBtn');
  const keypad = document.getElementById('customKeypad');
  const mainWrap = document.getElementById('mainWrap');

  const qs = (s, root=document) => root.querySelector(s);
  const gv = (sel) => { const el = typeof sel==='string'? qs(sel): sel; return (el && el.value||'').trim(); };
  const showToast = (msg) => { toast.textContent = msg; toast.hidden = false; setTimeout(()=>toast.hidden=true, 2500); };
  
  const FIELDS = [
    'tread_rf','pre_rf','dot_rf',
    'tread_lf','pre_lf','dot_lf',
    'tread_lr','pre_lr','dot_lr',
    'tread_rr','pre_rr','dot_rr'
  ];

  function playClickSound(){
    if(!audioCtx) return;
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'triangle'; 
    osc.frequency.setValueAtTime(4000, t); 
    osc.frequency.exponentialRampToValueAtTime(1000, t + 0.01); 
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
    osc.start(t);
    osc.stop(t + 0.01);
  }

  function fallbackFor(id){
    if(id.startsWith('tread')) return '--';
    if(id.startsWith('pre'))   return '---';
    return '----';
  }

  function showPrevPlaceholders(){
    document.querySelectorAll('.prev-val').forEach(span=>{
      const id = span.getAttribute('data-for');
      span.textContent = `(${fallbackFor(id)})`;
    });
  }

  function applyPrev(prev){
    FIELDS.forEach(id => {
      const span = document.querySelector(`.prev-val[data-for="${id}"]`);
      if(!span) return;
      let v = '';
      let raw = (prev && prev[id] != null && String(prev[id]).trim() !== '') ? prev[id] : null;
      if(raw === null){
        v = fallbackFor(id);
      } else {
        if(id.startsWith('tread')){
          const num = parseFloat(raw);
          v = !isNaN(num) ? num.toFixed(1) : String(raw).trim();
        }else if(id.startsWith('dot')){
          v = String(raw).trim().padStart(4, '0');
        }else{
          v = String(raw).trim();
        }
      }
      span.textContent = `(${v})`;
    });
  }

  // 「タイヤ別入力」タイトル横の前回測定日表示（GASの timestamp_iso 列由来）
  function applyPrevDate(raw){
    const el = document.getElementById('prevDate');
    if(!el) return;
    if(!raw){ el.textContent = ''; return; }
    // GAS側で "yyyy/MM/dd HH:mm:ss"（Asia/Tokyo）形式の文字列として返る想定
    const d = new Date(String(raw).trim());
    if(isNaN(d.getTime())){ el.textContent = ''; return; }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    el.textContent = `前回測定日 ${y}/${m}/${day}`;
  }

  // ===== メモリ解放（手動トリガー） =====
  // メモリークリーナーアプリが行っているのと同じ発想で、意図的に
  // 大きなメモリを確保することでiOS側に「フォアグラウンドのこの
  // ページのためにメモリが必要」と判断させ、バックグラウンドの
  // 不要プロセスをOS側に解放させる。効果はiOS側の裁量に委ねられる
  // ベストエフォートであり、確実な解放を保証するものではない。
  //
  // ページが実際にJetsamで落ちれば真っ白になって再読み込みされ、
  // その時点でこのJS自体が実行不能になるため後続コードは走らない。
  // つまり「この関数が最後まで実行できてしまった」ことそのものが
  // 「今回は自分は落ちなかった＝解放できたか不明」を意味する。
  let memToastEl = null;
  function showMemToast(msg) {
    if (!memToastEl) {
      memToastEl = document.createElement("div");
      memToastEl.className = "mem-toast";
      document.body.appendChild(memToastEl);
    }
    memToastEl.textContent = msg;
    memToastEl.classList.remove("show");
    void memToastEl.offsetWidth;
    memToastEl.classList.add("show");
    clearTimeout(memToastEl._hideTimer);
    memToastEl._hideTimer = setTimeout(() => memToastEl.classList.remove("show"), 2000);
  }

  function releaseMemory() {
    showMemToast("メモリを解放中…");
    setTimeout(() => {
      const CHUNK_BYTES = 8 * 1024 * 1024;  // 8MBずつ確保
      const HARD_CAP_MB = 3000;             // 実質無制限に近い上限
      const chunks = [];
      let allocated = 0;
      let hitOwnLimit = false;
      try {
        while (allocated < HARD_CAP_MB * 1024 * 1024) {
          const buf = new Uint8Array(CHUNK_BYTES);
          for (let i = 0; i < buf.length; i += 4096) buf[i] = 1;
          chunks.push(buf);
          allocated += CHUNK_BYTES;
          showMemToast(`メモリ確保中… ${Math.round(allocated / 1024 / 1024)}MB`);
        }
      } catch (e) {
        hitOwnLimit = true;
      }
      chunks.length = 0;
      showMemToast(hitOwnLimit
        ? `確保上限(約${Math.round(allocated / 1024 / 1024)}MB)到達・解放は未確認`
        : "確保完了・解放は未確認");
    }, 50);
  }

  // ▼▼▼ 修正箇所：タイムアウト＋自動リトライ（最大2回）＋失敗時トースト通知を追加 ▼▼▼
  // 読み取り専用(GET)なので、保存処理と違いabort/retryしても二重書き込み等の副作用はない
  async function fetchSheetData(retryCount = 0){
    const st = gv('[name="station"]');
    const md = gv('[name="model"]');
    const pf = gv('[name="plate_full"]');
    if(!(st||md||pf) || !SHEETS_URL) return;
    const u = new URL(SHEETS_URL);
    u.searchParams.set('key', SHEETS_KEY);
    u.searchParams.set('op','read');
    u.searchParams.set('sheet','Tirelog');
    if(st) u.searchParams.set('station', st);
    if(md) u.searchParams.set('model', md);
    if(pf) u.searchParams.set('plate_full', pf);
    u.searchParams.set('ts', Date.now());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒でタイムアウト（現場4G回線の往復遅延を考慮）

    try{
      const res = await fetch(u.toString(), { cache:'no-store', signal: controller.signal });
      clearTimeout(timeoutId);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      const f = qs('[name="std_f"]'); const r = qs('[name="std_r"]');
      if(data.std_f && f && !f.value) f.value = data.std_f;
      if(data.std_r && r && !r.value) r.value = data.std_r;
      applyPrev(data.prev || {});
      applyPrevDate(data.prev_timestamp);
    }catch(err){
      clearTimeout(timeoutId);
      console.error('fetchSheetData failed (attempt ' + (retryCount + 1) + ')', err);
      if(retryCount < 2){
        setTimeout(() => fetchSheetData(retryCount + 1), 1000);
      } else {
        showToast('前回値の取得に失敗しました');
      }
    }
  }
  // ▲▲▲ 修正ここまで ▲▲▲

  // ▼▼▼ 追加：多重送信対策（同一entry_idの使い回し・保存確認） ▼▼▼
  let currentEntryRequestId = null;

  function genRequestId(){
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getOrCreateEntryRequestId(){
    if (!currentEntryRequestId) currentEntryRequestId = genRequestId();
    return currentEntryRequestId;
  }

  // GASにentry_idが保存済みかを確認する（バックグラウンド復帰時や送信失敗時の再確認用）
  async function checkEntrySaved(requestId){
    if (!requestId || !SHEETS_URL) return false;
    try{
      const u = new URL(SHEETS_URL);
      u.searchParams.set('key', SHEETS_KEY);
      u.searchParams.set('op', 'check_entry');
      u.searchParams.set('entry_id', requestId);
      u.searchParams.set('ts', Date.now());
      const res = await fetch(u.toString(), { cache:'no-store' });
      if(!res.ok) return false;
      const data = await res.json();
      return !!(data && data.saved);
    }catch(e){
      console.error('checkEntrySaved failed', e);
      return false;
    }
  }

  // ページがバックグラウンドから復帰した際、フリーズしていたfetch/タイマーの再開を待たず
  // 即座に保存有無をGASへ確認する（スワイプで離れると送信完了/失敗の通知が止まる事象への対策）
  async function handleVisibilityChange(){
    if (document.visibilityState !== 'visible' || !currentEntryRequestId) return;
    const rid = currentEntryRequestId;
    const saved = await checkEntrySaved(rid);
    if (saved) {
      currentEntryRequestId = null;
      showToast('送信完了');
      setTimeout(() => { toast.textContent = 'ブラウザの戻るか右スワイプ'; toast.hidden = false; }, 2800);
      if (resendBtn) resendBtn.style.display = 'none';
      const pf = gv('[name="plate_full"]');
      if (pf) localStorage.setItem('junkai:tire_completed_plate', pf);
    } else {
      showToast('送信失敗');
      if (resendBtn) resendBtn.style.display = 'block';
    }
  }
  // ▲▲▲ 追加ここまで ▲▲▲

  // ▼▼▼ 修正箇所：ハードタイムアウト(30秒)＋keepalive＋保存確認による多重送信対策 ▼▼▼
  async function postToSheet(){
    if(!SHEETS_URL){ showToast('送信先未設定'); throw new Error('SHEETS_URL is not defined'); }
    const payload = collectPayload();
    const rid = payload.entry_id;
    if (resendBtn) resendBtn.style.display = 'none';

    const body = new URLSearchParams();
    body.set('key', SHEETS_KEY);
    body.set('json', JSON.stringify(payload));

    // 15秒経過時点ではUI表示のみ切り替え（通信は継続）。
    // 30秒でハードタイムアウトし、AbortControllerで打ち切る。
    // keepalive:trueにより、ページ離脱(スワイプ等)後もブラウザ側で送信を継続させる。
    let settled = false;
    const softTimer = setTimeout(() => {
      if (!settled) {
        showToast('応答に時間がかかっています…（送信は継続中）');
        if (resendBtn) resendBtn.style.display = 'block';
      }
    }, SUBMIT_TIMEOUT_MS);
    const controller = new AbortController();
    const hardTimer = setTimeout(() => controller.abort(), 30000);

    try{
      const res = await fetch(SHEETS_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
        body,
        keepalive: true,
        signal: controller.signal
      });
      settled = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      if(!res.ok) throw new Error('HTTP '+res.status);
      currentEntryRequestId = null;
      showToast('送信完了');
      setTimeout(() => { toast.textContent = 'ブラウザの戻るか右スワイプ'; toast.hidden = false; }, 2800);
      if (resendBtn) resendBtn.style.display = 'none';
      const pf = gv('[name="plate_full"]');
      if (pf) localStorage.setItem('junkai:tire_completed_plate', pf);
    }catch(err){ 
      settled = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      console.error(err); 
      // 通信エラーに見えても、GAS側では既に保存が完了している場合があるため確認する
      const saved = await checkEntrySaved(rid);
      if (saved) {
        currentEntryRequestId = null;
        showToast('送信完了');
        setTimeout(() => { toast.textContent = 'ブラウザの戻るか右スワイプ'; toast.hidden = false; }, 2800);
        if (resendBtn) resendBtn.style.display = 'none';
        const pf = gv('[name="plate_full"]');
        if (pf) localStorage.setItem('junkai:tire_completed_plate', pf);
        return;
      }
      showToast('送信失敗');
      if (resendBtn) resendBtn.style.display = 'block';
      throw err;
    }
  }
  // ▲▲▲ 修正ここまで ▲▲▲

  function collectPayload(){
    const obj = {
      station: gv('[name="station"]'),
      plate_full: gv('[name="plate_full"]'),
      model: gv('[name="model"]'),
      std_f: gv('[name="std_f"]'),
      std_r: gv('[name="std_r"]'),
      tread_rf: gv('#tread_rf'), pre_rf: gv('#pre_rf'), dot_rf: gv('#dot_rf'),
      tread_lf: gv('#tread_lf'), pre_lf: gv('#pre_lf'), dot_lf: gv('#dot_lf'),
      tread_lr: gv('#tread_lr'), pre_lr: gv('#pre_lr'), dot_lr: gv('#dot_lr'),
      tread_rr: gv('#tread_rr'), pre_rr: gv('#pre_rr'), dot_rr: gv('#dot_rr'),
      operator: ''
    };
    obj.timestamp_iso = timestampForSheet();
    obj.entry_id = getOrCreateEntryRequestId();
    return obj;
  }

  // ★ 修正箇所 ★
  // 旧: new Date(Date.now() + 9*60*60000) でUTCオフセットを手動計算し、
  //     get系メソッド（ローカルタイム）で取り出していたため JST環境では+18h のズレが生じていた。
  // 新: toLocaleString で Asia/Tokyo を明示指定し、そこから各フィールドを取り出す。
  function timestampForSheet(){
    const now = new Date();
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(now);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
  }

  function applyUrl(){
    const p = new URLSearchParams(location.search);
    isSingleMode = (p.get('mode') === 'single');
    ['station','plate_full','model'].forEach(name => {
      const v = p.get(name);
      if(v) { const el = qs(`[name="${name}"]`); if(el) el.value = v; }
    });
  }

  function wire(){
    ['station','plate_full','model'].forEach(name =>{
      document.querySelectorAll(`[name="${name}"]`).forEach(el=>{
        const h = ()=>{ fetchSheetData(); };
        el.addEventListener('change', h, {passive:true});
        el.addEventListener('input',  h, {passive:true});
      });
    });
    const memBtn = document.getElementById('memReleaseBtn');
    if (memBtn) memBtn.addEventListener('click', releaseMemory);
  }

  const AUTO_SEQUENCE = ['std_f','std_r','tread_rf','pre_rf','dot_rf','tread_lf','pre_lf','dot_lf','tread_lr','pre_lr','dot_lr','tread_rr','pre_rr','dot_rr','submitBtn'];
  const FIELD_RULES = {
    std_f: {len:3}, std_r: {len:3},
    tread_rf: {len:2, decimal:true}, pre_rf: {len:3}, dot_rf: {len:4},
    tread_lf: {len:2, decimal:true}, pre_lf: {len:3}, dot_lf: {len:4},
    tread_lr: {len:2, decimal:true}, pre_lr: {len:3}, dot_lr: {len:4},
    tread_rr: {len:2, decimal:true}, pre_rr: {len:3}, dot_rr: {len:4}
  };
  function formatTread(raw){
    const num = parseInt(raw, 10);
    return isNaN(num) ? '' : (num / 10).toFixed(1);
  }

  function focusNext(currentId){
    const idx = AUTO_SEQUENCE.indexOf(currentId);
    const nextId = AUTO_SEQUENCE[idx + 1];
    if(!nextId) return;
    if(nextId === 'submitBtn'){
      keypad.classList.remove('show');
      if (currentFocusInput) currentFocusInput.blur();
      currentFocusInput = null;
      lastRowElement = null;
      return;
    }
    
    const nextEl = document.getElementById(nextId) || document.querySelector(`[name="${nextId}"]`);
    if(nextEl) {
      nextEl.focus({ preventScroll: true });
    }
  }

  function showKeypad(target){
    keypad.classList.add('show');
    
    const currentRow = target.closest('.tire-row, .std-row') || target.parentElement;
    if(!currentRow) return;
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight;
    const kbRect = keypad.getBoundingClientRect();
    const kbHeight = kbRect.height;

    const rect = currentRow.getBoundingClientRect(); 
    const currentMatrix = new WebKitCSSMatrix(getComputedStyle(mainWrap).transform);
    const currentY = currentMatrix.m42;
    const naturalBottom = rect.bottom - currentY;
    const threshold = vh - kbHeight;
    if(naturalBottom > threshold){
      const shift = naturalBottom - threshold + 20;
      mainWrap.style.transform = `translateY(-${shift}px)`;
    } else {
      mainWrap.style.transform = 'translateY(0)';
    }
    
    lastRowElement = currentRow;
  }

  function hideKeypad(){
    keypad.classList.remove('show');
    if (currentFocusInput) currentFocusInput.blur();
    currentFocusInput = null;
    lastRowElement = null;
  }

  function setupAutoAdvance(){
    AUTO_SEQUENCE.forEach(id => {
      const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
      if(!el || id === 'submitBtn') return;
      el.addEventListener('input', ev => {
        const rule = FIELD_RULES[id];
        if(!rule) return;
        let digits = ev.target.value.replace(/\D/g, '');
        if(digits.length >= rule.len){
          ev.target.value = rule.decimal ? formatTread(digits.slice(0, rule.len)) : digits.slice(0, rule.len);
          focusNext(id);
        }
      });
      el.addEventListener('focus', () => { currentFocusInput = el; showKeypad(el); });
    });
  }

  function setupCustomKeypad(){
    keypad.addEventListener('touchstart', e => {
      if(!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if(AudioContext) audioCtx = new AudioContext();
      }
      const btn = e.target.closest('.key');
      if(!btn || !currentFocusInput) return;
      e.preventDefault();
      playClickSound();
      const val = btn.getAttribute('data-val');
      if(val === 'bs') currentFocusInput.value = currentFocusInput.value.slice(0, -1);
      else if(val !== null) currentFocusInput.value += val;
      else if(btn.id === 'keyClose') {
        hideKeypad();
        return;
      }
      currentFocusInput.dispatchEvent(new Event('input', { bubbles: true }));
    }, {passive: false});
    document.getElementById('keyClose').addEventListener('click', hideKeypad);
    
    document.addEventListener('touchstart', e => {
      if(!keypad.contains(e.target) && !e.target.matches('input[inputmode="none"]')) {
        if(keypad.classList.contains('show')) hideKeypad();
      }
    }, {passive:true});
  }

  async function preloadWorkSplash() {
    try {
      // 1日1回だけ先読みすれば十分なため、同日分のキャッシュがあれば再取得しない
      // （前回データ取得と無関係に毎回GitHub APIを叩いていたのを抑制する対策）
      const cachedUrl  = localStorage.getItem("junkai:preloaded_splash_url");
      const cachedDate = localStorage.getItem("junkai:preloaded_splash_date");
      const today = new Date().toDateString();
      if (cachedUrl && cachedDate === today) return;

      const res = await fetch(GITHUB_IMG_API);
      if (!res.ok) throw new Error("Image API fetch failed");
      const files = await res.json();
      const images = files.filter(f => f.name.match(/\.(jpg|jpeg|png|gif)$/i)).map(f => f.download_url);
      if (images.length > 0) {
        const selectedUrl = images[Math.floor(Math.random() * images.length)];
        localStorage.setItem("junkai:preloaded_splash_url", selectedUrl);
        localStorage.setItem("junkai:preloaded_splash_date", today);
        const img = new Image();
        img.src = selectedUrl;
      }
    } catch(e) {
      console.warn("Splash preload failed", e);
    }
  }

  // 簡易的な現在の週番号計算 (ISO準拠) - 以前のロジックを完全復元
  const getWeek = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  function init(){
    applyUrl(); showPrevPlaceholders(); fetchSheetData(); wire(); setupAutoAdvance(); setupCustomKeypad();
    // 前回データ取得(fetchSheetData)と回線を奪い合わないよう、先読みは少し遅らせて開始する
    setTimeout(preloadWorkSplash, 4000);
    if(form){
      form.addEventListener('submit', async ev => {
        ev.preventDefault();

        // ===== WWYY (週週年年) バリデーション - 以前のロジックを完全復元 =====
        const now = new Date();
        const currentYear2Digit = Number(String(now.getFullYear()).slice(-2));
        const currentWeek = getWeek(now);
        const tires = ['rf', 'lf', 'lr', 'rr'];
        
        for (const pos of tires) {
          const dotVal = gv(`#dot_${pos}`);
          if (!dotVal) continue;

          if (dotVal.length !== 4) {
            showToast(`${pos.toUpperCase()}の製造年週は4桁で入力してください`);
            return; // 送信中止
          }

          const ww = parseInt(dotVal.substring(0, 2), 10);
          const yy = parseInt(dotVal.substring(2, 4), 10);

          if (ww < 1 || ww > 53) {
            showToast(`${pos.toUpperCase()}の製造週が不正です(${ww})`);
            return;
          }
          if (yy > currentYear2Digit) {
            showToast(`${pos.toUpperCase()}の製造年が未来になっています(${yy})`);
            return;
          }
          if (yy === currentYear2Digit && ww > currentWeek) {
            showToast(`${pos.toUpperCase()}の製造週が未来になっています(${ww})`);
            return;
          }
        }
        // ===========================================

        const p = collectPayload();
        if(resHeader) resHeader.textContent = (p.station ? p.station + '\n' : '') + p.plate_full + '\n' + p.model;
        const lines = [
          (p.std_f && p.std_r ? `${p.std_f}-${p.std_r}` : ''),
          `${p.tread_rf||''} ${p.pre_rf||''} ${p.dot_rf||''}  RF`,
          `${p.tread_lf||''} ${p.pre_lf||''} ${p.dot_lf||''}  LF`,
          `${p.tread_lr||''} ${p.pre_lr||''} ${p.dot_lr||''}  LR`,
          `${p.tread_rr||''} ${p.pre_rr||''} ${p.dot_rr||''}  RR`,
          '', new Date().toLocaleString('ja-JP')
        ];
        if(resLines) resLines.textContent = lines.join('\n');
        
        mainWrap.style.transform = 'translateY(0)';
        form.style.display = 'none'; 
        resultCard.style.display = 'block'; 
        window.scrollTo({top:0});
        
        await postToSheet();
      });
    }
    if(backBtn) backBtn.addEventListener('click', () => { toast.hidden = true; resultCard.style.display = 'none'; form.style.display = 'block'; window.scrollTo({top:0}); if(resendBtn) resendBtn.style.display = 'none'; });
    if(resendBtn) resendBtn.addEventListener('click', () => { postToSheet(); });
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
