(function(){'use strict';


var BASES=['https://api.anilibria.app/api/v1','https://aniliberty.top/api/v1'];
var status=document.getElementById('status'),grid=document.getElementById('grid'),detail=document.getElementById('detail'),player=document.getElementById('player');
var current=null,playing=false,focusBefore=null,video=null;
var paused=false, activeEpisode=null, lastSave=0, uiTicker=null, currentDuration=0;
var lastPlaybackPosition=null,lastPlaybackClock=0,completedThisPlayback=false,seekGraceUntil=0;
var overlayVisible=false, overlayTimer=null;
var seekPreview=null,seekHoldStart=0,seekHoldTimer=null,seekHoldDirection=0,seekLastKey=0,seekStepSeconds=0;
var skipRanges=null,skipLabel='';var seekHoldActivated=false;
var HISTORY_KEY='al_tv_recent';
var TOKEN_KEY='al_tv_session',token=localStorage.getItem(TOKEN_KEY)||'',serverPositions={},serverHistory=[],accountReady=false;

var authEpoch=0,activeAuthenticatedXhrs=[];
function trackAuthenticatedXhr(xhr){activeAuthenticatedXhrs.push(xhr);}
function untrackAuthenticatedXhr(xhr){var i=activeAuthenticatedXhrs.indexOf(xhr);if(i>=0)activeAuthenticatedXhrs.splice(i,1);}
function invalidateAuthenticatedRequests(){
 ++authEpoch;var pending=activeAuthenticatedXhrs.slice();activeAuthenticatedXhrs=[];
 pending.forEach(function(xhr){try{xhr.abort();}catch(e){}});
}
function eraseLocalViewingData(){
 try{var keys=[];for(var i=0;i<localStorage.length;i++){
  var k=localStorage.key(i);if(k===HISTORY_KEY||k===CACHE_KEY||
   k.indexOf('al_tv_progress_')===0||k.indexOf(MUTATION_PREFIX)===0||
   k.indexOf(FAVORITE_CACHE_PREFIX)===0)keys.push(k);
 }keys.forEach(function(k){localStorage.removeItem(k);});}catch(e){logError('Очистка сессии',e);}
 cacheClear();
}
function resetAccountRuntime(){
 clearTimeout(syncTimer);syncTimer=null;
 clearTimeout(remoteVerifyTimer);remoteVerifyTimer=null;clearTimeout(historyRepaintTimer);historyRepaintTimer=null;

 ++historyFetchId;++quickHistoryRequestId;++checkGeneration;++favoriteReadVersion;++favoriteListSerial;++releaseLoadToken;
 releaseLoading=false;historyLoading=false;quickHistoryInFlight=false;checkRunning=false;checkQueue=[];
 favoriteReadPending=false;favoriteReadCallbacks=[];favoriteSyncBusy=false;syncInFlight=false;
 surfaceTimecodesLoading=false;surfaceTimecodesQueued=false;
 historyReady=false;historyComplete=false;freshHistoryComplete=false;freshTimecodes=false;accountReady=false;
 serverPositions={};serverHistory=[];recentHistoryResult=null;availability={};titleReleaseCache={};titlePosterCache={};titleReleaseCacheSerial=Object.create(null);
 mutations=Object.create(null);favoriteIds=Object.create(null);favoriteTitles=Object.create(null);favoriteWrites=Object.create(null);
 favoriteLoaded=false;favoriteListBusy=false;favoriteListComplete=false;favoriteBootstrapDone=false;favoriteStartupWaiting=false;
 favoriteReadError='';favoriteLastReadAt=0;
 syncError='';favoriteSyncError='';syncLastSuccess=0;serverTimecodesFetchedAt=0;remoteResponseSerial=0;
 historyOffset=0;continueMembership=Object.create(null);invalidateHistoryIndex();
}
function endAccountSession(){
 invalidateAuthenticatedRequests();resetAccountRuntime();eraseLocalViewingData();
 token='';try{localStorage.removeItem(TOKEN_KEY);}catch(e){}
}

var CACHE_KEY='al_tv_history_cache', historyLoadStarted=0,historyLastPaint=0,historyFetchId=0,historyLoading=false,historyUserRequested=false;
var freshTimecodes=false,historyFetchStarted=false,historyRepaintTimer=null,historyStaleCount=0,freshHistoryComplete=false,serverTimecodesFetchedAt=0;

var accountReadSerial=0,remoteVerifyTimer=null,remoteVerifyCount=0,remoteLastTimecodesCount=0,remoteLastVerifiedAt=0,remoteResponseSerial=0;

var startupSyncDone=false,startupSyncTimer=null,startupSyncError='',quickHistoryInFlight=false,quickHistoryRequestId=0,recentHistoryResult=null;
var startupSyncStartedAt=0,startupSyncSettled=false,startupSyncRevealTimer=null;
var STARTUP_MIN_DISPLAY_MS=7000;

var MUTATION_PREFIX='al_tv_sync_',mutations=Object.create(null),mutationSerial=0;
var syncInFlight=false,syncTimer=null,syncError='',syncLastSuccess=0,syncBatchId=0;

var surfaceTimecodesLoading=false,surfaceTimecodesQueued=false;
function mutationStorageKey(){return MUTATION_PREFIX+token.slice(-16);}
function persistMutations(){try{localStorage.setItem(mutationStorageKey(),JSON.stringify(mutations));return true;}catch(e){logError('Синхронизация: сохранение',e);return false;}}
function loadMutations(){
 mutations=Object.create(null);
 try{var saved=JSON.parse(localStorage.getItem(mutationStorageKey())||'{}');Object.keys(saved||{}).forEach(function(id){if(saved[id]&&saved[id].op)mutations[id]=saved[id];});}catch(e){logError('Синхронизация: чтение',e);}
 Object.keys(mutations).forEach(function(id){mutationSerial=Math.max(mutationSerial,Number(mutations[id].serial)||0);});
 persistMutations();
}
function pendingMutationCount(){return Object.keys(mutations).filter(function(k){return mutations[k].phase==='pending';}).length;}
function syncSummary(){var n=pendingMutationCount();if(!token)return 'Синхронизация: нужен вход';if(syncInFlight)return 'Синхронизация: отправка · '+n;if(n)return 'Синхронизация: ожидает '+n+(syncError?' · ошибка':'');return startupSyncError&&!freshTimecodes?'Синхронизация: ошибка получения сайта':syncLastSuccess?'Синхронизация: подтверждено':freshTimecodes?'Синхронизация: статусы сайта актуальны':'Синхронизация: ожидание проверки сайта';}
function stageEpisodeMutation(r,ep,op,time,watched,send){
 if(!token||!ep||!ep.id)return false;
 var id=String(ep.id),now=Date.now();
 mutations[id]={op:op,id:id,time:Math.max(0,Number(time)||0),watched:!!watched,updated:now,serial:++mutationSerial,phase:'pending',release:r?{id:r.id,name:r.name,poster:r.poster||r.posters}:null,episode:{id:ep.id,ordinal:ep.ordinal,number:ep.number,name:ep.name}};
 if(r){try{if(op==='delete')localStorage.removeItem(storeKey(r,ep));else localStorage.setItem(storeKey(r,ep),JSON.stringify({pos:Math.max(0,Number(time)||0)*1000,watched:!!watched,updated:now}));}catch(e){logError('Прогресс',e);}}

 if(op==='delete')try{var list=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');list=list.filter(function(x){return !x.episode||String(x.episode.id)!==id;});localStorage.setItem(HISTORY_KEY,JSON.stringify(list));}catch(e){}
 persistMutations();invalidateHistoryIndex();
 if(r&&r.id)refreshTitleCardsForId(r.id);
 if(screenName==='release'&&current&&r&&String(current.id)===String(r.id)){refreshVisibleEpisodeTiles();refreshReleasePrimary();}
 updateIndicator();if(send)flushMutations();return true;
}
function sendMutationBatch(method,items,success,failure){
 if(!token){failure('Требуется вход в аккаунт');return;}
 var epoch=authEpoch,accountToken=token;
 var path='/accounts/users/me/views/timecodes';
 var body=items.map(function(m){return method==='DELETE'?{release_episode_id:m.id}:{release_episode_id:m.id,time:m.time,is_watched:!!m.watched};});
 function attempt(index){
  if(index>=BASES.length){failure('Сервер недоступен / CORS');return;}
  var xhr=new XMLHttpRequest();trackAuthenticatedXhr(xhr);xhr.open(method,BASES[index]+path,true);xhr.timeout=18000;
  xhr.setRequestHeader('Accept','application/json');xhr.setRequestHeader('Content-Type','application/json');xhr.setRequestHeader('Authorization','Bearer '+accountToken);
  xhr.onload=function(){untrackAuthenticatedXhr(xhr);if(epoch!==authEpoch||accountToken!==token)return;
   if(xhr.status>=200&&xhr.status<300)success();
   else if(xhr.status>=500&&index+1<BASES.length)attempt(index+1);
   else failure('HTTP '+xhr.status);};
  xhr.onerror=function(){untrackAuthenticatedXhr(xhr);if(epoch!==authEpoch||accountToken!==token)return;
   if(index+1<BASES.length)attempt(index+1);else failure('Сетевая ошибка / CORS');};
  xhr.ontimeout=function(){untrackAuthenticatedXhr(xhr);if(epoch!==authEpoch||accountToken!==token)return;
   if(index+1<BASES.length)attempt(index+1);else failure('Таймаут сервера');};
  try{xhr.send(JSON.stringify(body));}catch(e){untrackAuthenticatedXhr(xhr);if(epoch!==authEpoch||accountToken!==token)return;if(index+1<BASES.length)attempt(index+1);else failure(e.message);}
 }
 attempt(0);
}
function scheduleMutationRetry(ms){clearTimeout(syncTimer);if(!token||!pendingMutationCount())return;syncTimer=setTimeout(function(){syncTimer=null;flushMutations();},ms||30000);}
function flushMutations(){
 if(syncInFlight||!token)return;
 clearTimeout(syncTimer);syncTimer=null;
 var batch=Object.keys(mutations).map(function(id){return mutations[id];}).filter(function(x){return x.phase==='pending';}).slice(0,40);
 if(!batch.length){syncError='';updateIndicator();return;}
 var method=batch[0].op==='delete'?'DELETE':'POST';batch=batch.filter(function(x){return (x.op==='delete'?'DELETE':'POST')===method;});
 syncInFlight=true;syncError='';updateIndicator();var requestAccount=token;
 var snapshots=batch.map(function(x){return {id:x.id,serial:x.serial,op:x.op,time:x.time,watched:x.watched};});
 sendMutationBatch(method,snapshots,function(){
  if(token!==requestAccount){syncInFlight=false;return;}
  syncInFlight=false;syncLastSuccess=Date.now();
  snapshots.forEach(function(x){var m=mutations[x.id];if(m&&m.serial===x.serial&&m.phase==='pending'){m.phase='confirmed';m.confirmedAt=Date.now();}});
  persistMutations();updateIndicator();if(pendingMutationCount())flushMutations();
 },function(reason){if(token!==requestAccount){syncInFlight=false;return;}syncInFlight=false;syncError=reason;logError('Синхронизация',method+' '+reason);updateIndicator();scheduleMutationRetry(reason.indexOf('HTTP 401')===0||reason.indexOf('HTTP 403')===0?120000:30000);});
}


function reconcileConfirmedTimecodes(){
 if(!freshTimecodes)return;
 var changed=false,now=Date.now();
 Object.keys(mutations).forEach(function(id){
  var m=mutations[id];if(m.phase!=='confirmed')return;
  var p=serverPositions[id],acknowledged=m.op==='delete'?
    !p:
    !!(p&&p.watched===!!m.watched&&Math.abs((p.pos||0)/1000-m.time)<10);
  var elapsed=now-(Number(m.confirmedAt)||Number(m.updated)||now);
  if(acknowledged||elapsed>8000){if(!acknowledged)logError('Синхронизация','Подтверждённое изменение '+id+' уступило более свежему ответу сайта');delete mutations[id];changed=true;}
 });
 if(changed){persistMutations();invalidateHistoryIndex();}
 return changed;
}
function reconcileConfirmedMutations(){reconcileConfirmedTimecodes();}


function showStartupCurtain(message,hint){
 var cover=document.getElementById('syncCurtain');if(!cover)return;
 document.getElementById('syncCurtainMessage').textContent=message;
 document.getElementById('syncCurtainHint').textContent=hint||'';
 cover.hidden=false;
}
function hideStartupCurtain(){var cover=document.getElementById('syncCurtain');if(cover)cover.hidden=true;}
function finishStartupSync(error){
 if(startupSyncDone||startupSyncSettled)return;
 if(token&&!error&&!favoriteBootstrapDone){favoriteStartupWaiting=true;return;}
 startupSyncSettled=true;
 clearTimeout(startupSyncTimer);startupSyncTimer=null;
 startupSyncError=error||'';
 if(error)logError('Стартовая синхронизация',error);


 var left=Math.max(0,STARTUP_MIN_DISPLAY_MS-(Date.now()-startupSyncStartedAt));
 if(left){
  showStartupCurtain(error?'Не удалось синхронизировать':!token?'Загрузка AniLiberty TV':favoriteReadError?'Синхронизация выполнена частично':'Синхронизация завершена',
   error?'Продолжим с сохранёнными данными':!token?'Подготовка каталога…':favoriteReadError?'Избранное не удалось обновить · используется кеш':'Открываем приложение…');
 }
 function reveal(){
  if(startupSyncDone)return;
  startupSyncDone=true;startupSyncRevealTimer=null;
  hideStartupCurtain();
  if(error)msg('Сайт недоступен · данные из кеша · '+error);
  else if(token&&favoriteReadError)msg('Не удалось загрузить избранное · доступны сохранённые данные');
  updateIndicator();
 }
 if(left)startupSyncRevealTimer=setTimeout(reveal,left);
 else reveal();
}
function beginStartupSync(){
 startupSyncStartedAt=Date.now();startupSyncDone=false;startupSyncSettled=false;
 clearTimeout(startupSyncRevealTimer);startupSyncRevealTimer=null;
 if(!token){
  showStartupCurtain('Загрузка AniLiberty TV','Подготовка каталога…');
  finishStartupSync(null);
  return;
 }
 showStartupCurtain('Синхронизация с AniLiberty','Получение просмотров и избранного…');
 favoriteBootstrapDone=false;favoriteStartupWaiting=false;
 refreshFavoriteIds(function(err){
  favoriteBootstrapDone=true;
  if(err)logError('Избранное при запуске',err);
  if(favoriteStartupWaiting){favoriteStartupWaiting=false;finishStartupSync(null);}
 });

 startupSyncTimer=setTimeout(function(){finishStartupSync('Таймаут ожидания, проверка продолжится в фоне');},22000);
}
function scheduleHistoryRepaint(){
 if(historyRepaintTimer||playing||screenName!=='history'||grid.hidden)return;
 historyRepaintTimer=setTimeout(function(){historyRepaintTimer=null;
  if(!playing&&screenName==='history'&&!grid.hidden)showServerContinue(historyMode,false,true);
 },120);
}


var FAVORITE_CACHE_PREFIX='al_tv_favorites_',favoriteIds=Object.create(null),favoriteTitles=Object.create(null);
var favoriteLoaded=false,favoriteReadPending=false,favoriteReadCallbacks=[],favoriteReadVersion=0;
var favoriteReadError='',favoriteLastReadAt=0;
var favoriteWrites=Object.create(null),favoriteWriteSerial=0,favoriteSyncBusy=false,favoriteSyncError='';
var favoriteListBusy=false,favoriteListSerial=0,favoriteListComplete=false,favoriteBootstrapDone=false,favoriteStartupWaiting=false;
var favoriteServerRevision=0;
function favoriteKey(){return FAVORITE_CACHE_PREFIX+token.slice(-16);}
function persistFavoriteState(){
 try{localStorage.setItem(favoriteKey(),JSON.stringify({ids:Object.keys(favoriteIds),titles:favoriteTitles}));return true;}
 catch(e){logError('Избранное: кеш',e);return false;}
}
function loadFavoriteState(){
 favoriteIds=Object.create(null);favoriteTitles=Object.create(null);favoriteWrites=Object.create(null);
 favoriteLoaded=false;favoriteListComplete=false;favoriteReadPending=false;favoriteReadCallbacks=[];
 favoriteWriteSerial=0;favoriteSyncBusy=false;favoriteSyncError='';favoriteServerRevision=0;
 favoriteReadError='';favoriteLastReadAt=0;
 if(!token)return;
 try{var saved=JSON.parse(localStorage.getItem(favoriteKey())||'{}');
  (saved.ids||[]).forEach(function(id){favoriteIds[String(id)]=true;});
  Object.keys(saved.titles||{}).forEach(function(id){favoriteTitles[String(id)]=saved.titles[id];});
 }catch(e){logError('Избранное: чтение кеша',e);}

 persistFavoriteState();
}
function favoriteValue(id){
 id=String(id||'');
 var inFlight=favoriteWrites[id];
 return inFlight?!!inFlight.desired:!!favoriteIds[id];
}
function favoriteSyncSummary(){
 if(!token)return 'Избранное: нужен вход';
 if(favoriteSyncError)return 'Избранное: ошибка отправки';
 if(favoriteReadError)return 'Избранное: ошибка загрузки';
 if(favoriteSyncBusy)return 'Избранное: отправка';
 if(favoriteReadPending)return 'Избранное: загрузка';
 return favoriteLoaded?'Избранное: синхронизировано':'Избранное: ожидание данных';
}
function publishFavoriteIds(raw){
 if(!Array.isArray(raw))return false;
 var next=Object.create(null);
 raw.forEach(function(id){
  if(typeof id==='number'||typeof id==='string')next[String(id)]=true;
  else if(id&&id.release_id!=null)next[String(id.release_id)]=true;
 });
 favoriteIds=next;favoriteLoaded=true;favoriteReadError='';favoriteSyncError='';favoriteLastReadAt=Date.now();
 persistFavoriteState();refreshReleaseFavorite();if(screenName==='favorites')renderFavorites(true);
 return true;
}
function refreshFavoriteIds(done){
 if(!token){if(done)done('Требуется вход');return;}
 if(favoriteReadPending){if(done)favoriteReadCallbacks.push(done);return;}
 favoriteReadPending=true;favoriteReadCallbacks=done?[done]:[];
 var requestAccount=token,readVersion=++favoriteReadVersion,revisionAtStart=favoriteServerRevision;
 function finish(err,payload){
  if(token!==requestAccount||readVersion!==favoriteReadVersion)return;
  favoriteReadPending=false;
  var callbacks=favoriteReadCallbacks;favoriteReadCallbacks=[];
  if(!err){

   if(revisionAtStart===favoriteServerRevision&&!favoriteSyncBusy){
    if(!publishFavoriteIds(payload))err='Некорректный список избранного';
   }
  }
  if(err){
   favoriteReadError=String(err);logError('Избранное: загрузка',err);
   msg('Не удалось загрузить избранное · доступны сохранённые данные');
  }
  updateIndicator();callbacks.forEach(function(cb){cb(err||null);});
 }
 authRequest(freshAccountPath('/accounts/users/me/favorites/ids'),'GET',null,function(response){
  finish(null,Array.isArray(response)?response:response&&response.data);
 },function(error){finish(error);});
}
function sendFavoriteChange(id,desired,serial,account,sessionEpoch){
 authRequest('/accounts/users/me/favorites',desired?'POST':'DELETE',[{release_id:Number(id)}],function(){
  if(account!==token||sessionEpoch!==authEpoch)return;
  var pending=favoriteWrites[id];if(!pending||pending.serial!==serial)return;
  if(desired)favoriteIds[id]=true;else delete favoriteIds[id];
  delete favoriteWrites[id];favoriteSyncBusy=Object.keys(favoriteWrites).length>0;
  favoriteSyncError='';++favoriteServerRevision;
  persistFavoriteState();refreshReleaseFavorite();if(screenName==='favorites')renderFavorites(true);
  updateIndicator();
 },function(err){
  if(account!==token||sessionEpoch!==authEpoch)return;
  var pending=favoriteWrites[id];if(!pending||pending.serial!==serial)return;
  delete favoriteWrites[id];favoriteSyncBusy=Object.keys(favoriteWrites).length>0;
  favoriteSyncError=String(err);++favoriteServerRevision;
  logError('Избранное: отправка',err);
  refreshReleaseFavorite();if(screenName==='favorites')renderFavorites(true);
  msg('Не удалось изменить избранное');updateIndicator();
 });
}
function rememberFavoriteTitle(r){if(!r||r.id==null)return;var id=String(r.id);
 if(!favoriteTitles[id]||title(r)&&title(r)!=='Тайтл '+id)favoriteTitles[id]=r;
}
function toggleFavorite(r){
 if(!token){promptGuestLogin();return;}
 var id=String(r&&r.id||'');if(!/^\d+$/.test(id))return;


 if(favoriteWrites[id]){msg('Изменение избранного ещё отправляется');return;}
 var next=!favoriteValue(id),serial=++favoriteWriteSerial;
 favoriteWrites[id]={id:id,desired:next,serial:serial};
 favoriteSyncBusy=true;favoriteSyncError='';++favoriteServerRevision;
 if(next)rememberFavoriteTitle(r);
 refreshReleaseFavorite();if(screenName==='favorites')renderFavorites(true);
 msg(next?'Добавлено в избранное · отправляем на сайт':'Удалено из избранного · отправляем на сайт');
 updateIndicator();sendFavoriteChange(id,next,serial,token,authEpoch);
}
function refreshReleaseFavorite(){
 var button=document.getElementById('releaseFavorite');if(!button||!current)return;
 var chosen=favoriteValue(current.id),label=chosen?'♥ Убрать из избранного':'♡ В избранное';
 if(button.textContent!==label)button.textContent=label;
 button.setAttribute('aria-pressed',chosen?'true':'false');
 button.className='release-favorite'+(chosen?' release-favorite-selected':'');
}
function favoriteTitleList(){
 var ids=Object.create(null);
 Object.keys(favoriteIds).forEach(function(id){if(favoriteValue(id))ids[id]=true;});
 Object.keys(favoriteWrites).forEach(function(id){if(favoriteValue(id))ids[id]=true;else delete ids[id];});
 var releases=Object.keys(ids).map(function(id){return favoriteTitles[id]||null;}).filter(Boolean);
 releases.sort(function(a,b){return title(a).localeCompare(title(b),'ru');});
 return {ids:ids,releases:releases,total:Object.keys(ids).length};
}
function renderFavorites(preserve){
 if(screenName!=='favorites'||grid.hidden)return;
 var list=favoriteTitleList(),main=document.getElementById('scrollMain');
 var scrollTop=main?main.scrollTop:0,selected=focusId(document.activeElement);
 var focusBeforeUpdate=document.activeElement,focusWasInGrid=grid.contains(focusBeforeUpdate);
 var old=Object.create(null);if(preserve){Array.prototype.forEach.call(grid.querySelectorAll('.title-card'),function(b){old[focusId(b)]=b;});}
 var wanted=[];
 list.releases.forEach(function(r){var fid='favorite-'+String(r.id),b=old[fid];
  if(b){b._titleRelease=r;b.onclick=function(){openRelease(r);};b._longPress=function(){openTitleActions(r);};updateTitleCard(b,r);}
  else b=titleCard(r,null,fid,function(){openRelease(r);});
  wanted.push(b);
 });
 var absent=list.total-list.releases.length;
 if(!token)msg('Для избранного войди в аккаунт AniLiberty');
 else msg('Избранное · '+list.total+(favoriteListBusy?' · обновляется…':'')+(absent?' · загружаются обложки: '+absent:''));
 if(!wanted.length){var headline=node('h2','history-heading',favoriteListBusy?'Загружаем избранное…':list.total?'Загружаем сведения о тайтлах…':'В избранном пока нет тайтлов');wanted.push(headline);}
 Array.prototype.slice.call(grid.children).forEach(function(el){if(wanted.indexOf(el)<0)grid.removeChild(el);});
 wanted.forEach(function(el,i){var at=grid.children[i];if(at!==el)grid.insertBefore(el,at||null);});

 if(preserve&&main)scrollFocusTo(main,scrollTop,true);
 if(focusWasInGrid&&!document.contains(focusBeforeUpdate)){


  var replacement=Array.prototype.find.call(grid.querySelectorAll('button'),function(b){return focusId(b)===selected;})
    ||firstContentButton(contentButtons())||document.getElementById('favoritesBtn');
  focusAndReveal(replacement,true);
 }
}
function refreshFavoriteTitles(){
 if(!token)return;
 var epoch=++favoriteListSerial,account=token,page=1,limit=50;
 favoriteListBusy=true;if(screenName==='favorites')renderFavorites(true);
 function nextPage(){
  authRequest(freshAccountPath('/accounts/users/me/favorites/releases?page='+page+'&limit='+limit),'GET',null,function(payload){
   if(epoch!==favoriteListSerial||token!==account)return;
   var items=payload&&Array.isArray(payload.data)?payload.data:Array.isArray(payload)?payload:null;
   if(!items){favoriteListBusy=false;favoriteReadError='Некорректный список релизов';logError('Избранное',favoriteReadError);if(screenName==='favorites')renderFavorites(true);msg('Не удалось загрузить избранное · доступны сохранённые данные');updateIndicator();return;}
   items.forEach(function(r){if(r&&r.id!=null)favoriteTitles[String(r.id)]=r;});
   persistFavoriteState();if(screenName==='favorites')renderFavorites(true);
   var meta=payload&&payload.meta||{},end=items.length<limit||(meta.pagination&&meta.pagination.total_pages&&page>=meta.pagination.total_pages);

   if(!end&&page<20){page++;nextPage();}
   else{favoriteListBusy=false;favoriteListComplete=!!end;persistFavoriteState();if(screenName==='favorites')renderFavorites(true);}
  },function(err){
   if(epoch!==favoriteListSerial||token!==account)return;
   favoriteListBusy=false;favoriteReadError=String(err);logError('Избранное: список',err);if(screenName==='favorites'){renderFavorites(true);msg('Не удалось загрузить избранное · доступны сохранённые данные');}updateIndicator();
  });
 }
 nextPage();
}
function showFavorites(){
 if(!token){showLoginRequired('избранным','favorites');return;}
 clear();setScreen('favorites');refreshSurfaceTimecodes();
 renderFavorites(false);restoreFocus('favoritesBtn');
 refreshFavoriteIds(function(err){if(err){logError('Избранное: обновление',err);msg('Не удалось загрузить избранное · доступны сохранённые данные');return;}if(screenName==='favorites')renderFavorites(true);});
 refreshFavoriteTitles();
}

var focusMemory={},screenName='catalog',lastFocused=null,focusGuard=false;
var releaseOrigin=null,releaseLoadToken=0,releaseLoading=false,catalogSnapshot=null;


var sectionFocusMemory=Object.create(null);
var playbackReturn=null;


var relatedTrail=[],relatedScreen=null,relatedState=null,relatedLookupSerial=0,relatedPendingOpen=null;
function relatedId(r){return String(r&&r.id!=null?r.id:r&&r.alias||'');}

function focusId(el){if(!el)return '';return el.getAttribute('data-focus-id')||el.id||'';}
function navigationSection(){
 if(screenName==='release')return 'release:'+String(current&&current.id||'unknown');
 if(screenName==='related')return 'related:'+relatedId(relatedScreen&&relatedScreen.owner);
 return activeNavId(screenName)||'latest';
}
function contentButtons(){
 var main=document.getElementById('scrollMain');
 if(!main)return [];
 return Array.prototype.slice.call(main.querySelectorAll('button')).filter(function(b){
  return !b.disabled&&b.offsetWidth>0&&b.offsetHeight>0;
 });
}
function rememberFocus(){
 var a=document.activeElement,main=document.getElementById('scrollMain');


 if(!a||a.tagName!=='BUTTON'||!main||!main.contains(a))return;
 var id=focusId(a),r=a.getBoundingClientRect();
 if(!id)return;
 lastFocused=a;
 focusMemory[screenName]={id:id,x:r.left,y:r.top,scroll:main.scrollTop};
 sectionFocusMemory[navigationSection()]={id:id,scroll:main.scrollTop};
}
function firstContentButton(buttons){
 var first=null,firstTop=Infinity,firstLeft=Infinity;
 buttons.forEach(function(b){var r=b.getBoundingClientRect();

  if(r.top<firstTop-2||(Math.abs(r.top-firstTop)<=2&&r.left<firstLeft)){
   first=b;firstTop=r.top;firstLeft=r.left;
  }
 });
 return first;
}
function sectionReturnButton(){
 var buttons=contentButtons(),saved=sectionFocusMemory[navigationSection()],target=null;
 if(saved&&saved.id)target=buttons.filter(function(b){return focusId(b)===saved.id;})[0];
 return target||firstContentButton(buttons);
}
function restoreFocus(preferred){
 if(playing)return;
 var buttons=Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(x){return !x.disabled&&x.offsetWidth>0&&x.offsetHeight>0;});
 if(!buttons.length)return;
 var m=focusMemory[screenName]||{},target=null;
 if(preferred)target=buttons.filter(function(x){return focusId(x)===preferred;})[0];


 if(!preferred&&document.querySelector('header').contains(document.activeElement))return;
 if(!target&&m.id)target=buttons.filter(function(x){return focusId(x)===m.id;})[0];
 if(!target&&m.x!=null){var best=Infinity;contentButtons().forEach(function(x){var r=x.getBoundingClientRect(),d=Math.pow(r.left-m.x,2)+Math.pow(r.top-m.y,2);if(d<best){best=d;target=x;}});}
 if(!target)target=firstContentButton(contentButtons())||buttons[0];
 focusAndReveal(target);
}
function focusAndReveal(el,immediate){
 if(!el||!document.contains(el)||el.disabled)return false;
 focusWithoutBrowserScroll(el);
 ensureFocusVisible(el,!!immediate);
 return true;
}


function activeNavId(name){
 if((name==='release'||name==='related')&&releaseOrigin)name=releaseOrigin.screen;
 if(name==='catalog')return 'latest';
 if(name==='history')return historyMode==='continue'?'continueBtn':'historyBtn';
 if(name==='favorites')return 'favoritesBtn';
 if(name==='account')return 'accountBtn';
 return '';
}
function updateActiveNav(name){
 var active=activeNavId(name);if(!active)return;
 ['latest','continueBtn','historyBtn','favoritesBtn','accountBtn'].forEach(function(id){
  var b=document.getElementById(id);if(!b)return;
  var yes=id===active;
  if(yes){b.classList.add('nav-current');b.setAttribute('aria-current','page');}
  else {b.classList.remove('nav-current');b.removeAttribute('aria-current');}
 });
}
function setScreen(name){if(releaseLoading&&name!=='release'){releaseLoadToken++;releaseLoading=false;}if(screenName!==name){rememberFocus();screenName=name;}if(name!=='account')document.getElementById('accountBtn').removeAttribute('data-nav-down');updateActiveNav(name);}
function assignFocus(el,id){el.setAttribute('data-focus-id',id);return el;}
var sessionErrors=[],availability={},checkQueue=[],checkBusy=0,checkDone=0,checkFailed=0,checkTotal=0,checkGeneration=0,checkRunning=false,historyReady=false;
var CACHE_DB='AniLibertyTV',CACHE_STORE='records';

var cachedHistoryGroups=null,cachedHistoryById=Object.create(null);
function invalidateHistoryIndex(){cachedHistoryGroups=null;cachedHistoryById=Object.create(null);}
var visibleTitleCards=Object.create(null),titleImagePriority=0;
function refreshTitleCardsForId(id){var cards=visibleTitleCards[String(id||'')]||[];cards.forEach(function(b){if(b.isConnected&&b._titleRelease)updateTitleCard(b,b._titleRelease);});}
var cacheStats={source:'ожидание',records:0,readMs:0,savedAt:0,write:'не проверено'};
function logError(source,error){var raw=String(error&&error.message||error||'Неизвестная ошибка').replace(/Bearer\s+[^\s]+/gi,'Bearer [hidden]');sessionErrors.push({time:new Date().toLocaleTimeString(),source:source,message:raw.slice(0,500)});if(sessionErrors.length>200)sessionErrors.shift();}
window.addEventListener('error',function(e){logError('JavaScript',e.message);});
window.addEventListener('unhandledrejection',function(e){logError('Promise',e.reason);});
loadMutations();loadFavoriteState();
function dbOpen(cb){if(!window.indexedDB){logError('Кеш','IndexedDB недоступна');cb(null);return;}try{var r=indexedDB.open(CACHE_DB,1);r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains(CACHE_STORE))r.result.createObjectStore(CACHE_STORE);};r.onsuccess=function(){cb(r.result);};r.onerror=function(){logError('Кеш',r.error);cb(null);};}catch(e){logError('Кеш',e);cb(null);}}
function cacheRead(cb){var started=Date.now();dbOpen(function(db){if(!db){cb(null);return;}try{var tx=db.transaction(CACHE_STORE,'readonly'),req=tx.objectStore(CACHE_STORE).get('history');req.onsuccess=function(){var x=req.result;cacheStats.readMs=Date.now()-started;cacheStats.source=x&&x.account===token.slice(-16)?'IndexedDB':'нет кеша';cacheStats.records=x&&x.history&&x.account===token.slice(-16)?x.history.length:0;cacheStats.savedAt=x&&x.savedAt||0;cb(x&&x.account===token.slice(-16)?x:null);};req.onerror=function(){logError('Кеш','Ошибка чтения IndexedDB');cb(null);};tx.oncomplete=function(){db.close();};}catch(e){logError('Кеш',e);db.close();cb(null);}});}
function cacheWrite(){var snapshot={account:token.slice(-16),history:serverHistory,savedAt:Date.now(),complete:historyComplete};dbOpen(function(db){if(!db)return;try{var tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).put(snapshot,'history');tx.onerror=function(){cacheStats.write='ошибка';logError('Кеш',tx.error);};tx.oncomplete=function(){cacheStats.write='успешно';cacheStats.records=snapshot.history.length;cacheStats.savedAt=snapshot.savedAt;db.close();};}catch(e){logError('Кеш',e);db.close();}});}
function cacheClear(){try{localStorage.removeItem(CACHE_KEY);}catch(e){}dbOpen(function(db){if(!db)return;var tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).delete('history');tx.oncomplete=function(){db.close();};});}
function updateIndicator(){var el=document.getElementById('syncIndicator');if(!el)return;if(!token){el.textContent='Без аккаунта · прогресс не сохраняется';el.className='ready';return;}var text='';if(historyLoading)text='История: '+serverHistory.length+' записей';else if(!historyReady)text='История: ожидание';else if(checkRunning)text='Проверка серий: '+checkDone+'/'+checkTotal+(checkFailed?' · ошибок '+checkFailed:'');else if(checkFailed)text='Проверено частично: '+checkDone+'/'+checkTotal;else if(checkTotal)text='✓ Список готов · '+checkTotal;else text='История готова';el.textContent=text+' · '+syncSummary()+' · '+favoriteSyncSummary();el.className=checkFailed||syncError||favoriteReadError||favoriteSyncError?'warning':checkRunning||historyLoading||syncInFlight||favoriteReadPending||favoriteSyncBusy?'busy':'ready';var accountLine=document.getElementById('accountSyncStatus');if(accountLine)accountLine.textContent=syncSummary()+(syncError?' · '+syncError:'')+' · '+favoriteSyncSummary()+(favoriteReadError?' · '+favoriteReadError:'');updateHeaderNotice();}


function beginAvailability(){if(!historyReady||!serverHistory.length||!token)return;var generation=++checkGeneration;checkQueue=groupedHistory().map(function(g){return g;});checkTotal=checkQueue.length;checkDone=0;checkFailed=0;checkBusy=0;checkRunning=!!checkTotal;updateIndicator();pumpAvailability(generation);}
function pumpAvailability(generation){
 if(generation!==checkGeneration)return;
 while(checkBusy<3&&checkQueue.length){
  (function(g){
   checkBusy++;var readSerial=++releaseRequestSerial;
   request('/anime/releases/'+encodeURIComponent(g.release.id),function(res){
    if(generation!==checkGeneration)return;
    var full=res.data||res,eps=episodeList(full);
    if(!eps.length){
     logError('Доступность серий',g.release.id+' · список серий пуст или неизвестный формат');
     availability[String(g.release.id)]={status:'error'};checkFailed++;checkDone++;checkBusy--;
     availabilityChanged(generation,g.release.id);return;
    }
    var releaseId=String(g.release.id);
    if(!availability[releaseId]||Number(availability[releaseId].serial||0)<=readSerial)
     availability[releaseId]={status:'ok',full:full,checked:Date.now(),serial:readSerial};
    checkDone++;checkBusy--;availabilityChanged(generation,g.release.id);
   },function(err){
    if(generation!==checkGeneration)return;
    logError('Доступность серий '+g.release.id,err);
    availability[String(g.release.id)]={status:'error'};checkFailed++;checkDone++;checkBusy--;
    availabilityChanged(generation,g.release.id);
   });
  })(checkQueue.shift());
 }
}
function availabilityChanged(generation,id){if(generation!==checkGeneration)return;onTitleEpisodeDataChanged(id);if(!checkQueue.length&&!checkBusy){checkRunning=false;updateIndicator();cacheAvailability();}else{updateIndicator();pumpAvailability(generation);}}
function cacheAvailability(){dbOpen(function(db){if(!db)return;var slim={};Object.keys(availability).forEach(function(k){var a=availability[k];if(a.status==='ok')slim[k]={status:a.status,checked:a.checked};});var tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).put({account:token.slice(-16),values:slim},'availability');tx.oncomplete=function(){db.close();};});}
function readAvailability(){dbOpen(function(db){if(!db)return;var tx=db.transaction(CACHE_STORE,'readonly'),req=tx.objectStore(CACHE_STORE).get('availability');req.onsuccess=function(){var v=req.result;if(v&&v.account===token.slice(-16)){Object.keys(v.values||{}).forEach(function(id){if(!availability[id])availability[id]=v.values[id];});if(screenName==='history')scheduleHistoryRepaint();}};tx.oncomplete=function(){db.close();};});}
function startBackgroundHistory(){if(!token||historyLoading)return;var generation=historyFetchId;cacheRead(function(c){if(historyFetchId!==generation||historyLoading)return;if(c&&Array.isArray(c.history)&&c.history.length){serverHistory=c.history;invalidateHistoryIndex();refreshVisibleProgressViews();historyComplete=!!c.complete;accountReady=true;historyReady=true;if(screenName==='history'){showServerContinue(historyMode,false,true);}msg('История из кеша · обновление в фоне…');readAvailability();}loadAccount(true);});}
var historyMode='continue',historyOffset=0,historyPageSize=49,historyComplete=false;
var resumeFailed=false, resumePending=false, resumeTarget=0, resumeAttempts=0, resumeStarted=0, resumeConfirmed=false, resumeSeekInFlight=false, resumeLastSeek=0, resumeLastError="";
function hideOverlay(){overlayVisible=false;document.body.classList.remove('overlay-visible');}
function showOverlay(){if(!playing)return;overlayVisible=true;document.body.classList.add('overlay-visible');clearTimeout(overlayTimer);overlayTimer=setTimeout(hideOverlay,5000);}
function av(){return window.webapis&&webapis.avplay;}
function stamp(ms){if(!isFinite(ms)||ms<0)return '00:00';var s=Math.floor(ms/1000);return (Math.floor(s/3600)?Math.floor(s/3600)+':':'')+('0'+Math.floor(s%3600/60)).slice(-2)+':'+('0'+s%60).slice(-2);}
function position(){try{return video?video.currentTime*1000:av()?webapis.avplay.getCurrentTime():0;}catch(e){return 0;}}
function duration(){try{return video?video.duration*1000:av()?webapis.avplay.getDuration():0;}catch(e){return 0;}}
function storeKey(r,ep){return 'al_tv_progress_'+String(r.id||r.alias)+'_'+String(ep.ordinal||ep.number||ep.id||'0');}
function saveRecent(){if(!token||!activeEpisode||!current)return;try{var list=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');list=list.filter(function(x){return x.key!==activeEpisode;});list.unshift({key:activeEpisode,release:{id:current.id,name:current.name,poster:current.poster},episode:window._lastEpisode?{id:window._lastEpisode.id,ordinal:window._lastEpisode.ordinal,number:window._lastEpisode.number}:null,position:position(),updated:Date.now()});localStorage.setItem(HISTORY_KEY,JSON.stringify(list.slice(0,40)));invalidateHistoryIndex();}catch(e){}}
function saveProgress(force){
 if(!token||!playing||!activeEpisode||resumePending||resumeFailed||completedThisPlayback)return;
 var now=Date.now();if(!force&&now-lastSave<5000)return;
 var pos=position();if(!isFinite(pos)||pos<0)return;
 lastSave=now;saveRecent();
 var ep=window._lastEpisode;
 if(ep&&ep.id){
  var id=String(ep.id),previous=titleEpisodeRecord(current,ep,titleGroup(current));

  if(!(previous&&previous.watched)){
   var manual=mutations[id];
   if(!(manual&&manual.op==='put'&&manual.watched))stageEpisodeMutation(current,ep,'put',pos/1000,false,false);
  }
 }
 try{
  var old=JSON.parse(localStorage.getItem(activeEpisode)||'null');
  if(!old||!old.watched)localStorage.setItem(activeEpisode,JSON.stringify({pos:pos,updated:now,watched:false}));
 }catch(e){}
 invalidateHistoryIndex();
}
function markEpisodeWatched(reason){
 if(!playing||!activeEpisode||completedThisPlayback)return;
 if(!token){completedThisPlayback=true;return;}
 completedThisPlayback=true;resumePending=false;resumeFailed=false;
 var now=Date.now(),ep=window._lastEpisode,d=duration(),p=position();
 var endPos=d>0?d:Math.max(0,p);
 if(ep&&ep.id){
  var id=String(ep.id);
  stageEpisodeMutation(current,ep,'put',endPos/1000,true,true);
 }
 try{localStorage.setItem(activeEpisode,JSON.stringify({pos:endPos,watched:true,updated:now}));}catch(e){}
 saveRecent();invalidateHistoryIndex();
 if(current&&current.id){
  if(!titleEpisodeData(current))enqueueTitleDetails(current);
  refreshTitleCardsForId(current.id);
 }

 if(ep&&ep.id){
  var tile=document.querySelector('[data-focus-id="episode-'+String(ep.id)+'"]');
  if(tile&&current)syncEpisodeTile(tile,current,ep,titleGroup(current));
 }
}


function renderPlaybackStatus(){
 var text=seekPreview!==null&&seekHoldDirection
  ?'ПЕРЕМОТКА '+(seekHoldDirection>0?'▶▶':'◀◀')+' · '+seekStepSeconds+' с'
  :paused?'ПАУЗА':'ВОСПРОИЗВЕДЕНИЕ';
 var label=document.getElementById('pauseState');
 if(label.textContent!==text)label.textContent=text;
}
function updateProgress(){
 if(!playing)return;
 if(resumePending)tryRestoreProgress();
 var p=position(),d=duration(),now=Date.now();

 if(!paused&&!resumePending&&!resumeFailed&&!completedThisPlayback&&seekPreview===null&&
    now>=seekGraceUntil&&d>0&&p>=d-5000&&p<=d+1000&&
    lastPlaybackPosition!==null&&lastPlaybackClock>0){
  var delta=p-lastPlaybackPosition,wall=now-lastPlaybackClock;
  if(delta>0&&delta<=Math.max(2500,wall+1600)&&wall<=3500)markEpisodeWatched('last-five-seconds');
 }
 lastPlaybackPosition=p;lastPlaybackClock=now;
 document.getElementById('elapsed').textContent=stamp(seekPreview!==null?seekPreview:p);
 document.getElementById('total').textContent=stamp(d);

 var pos=seekPreview!==null?seekPreview:p;
 var progress=d>0&&isFinite(d)&&isFinite(pos)?Math.max(0,Math.min(100,100*pos/d)):0;
 var progressPercent=progress+'%';
 document.getElementById('progressFill').style.width=progressPercent;
 document.getElementById('progressThumb').style.left=progressPercent;
 updateSkipButton(p,d);updateSkipMarkers(d);
 renderPlaybackStatus();
 saveProgress(false);
}
function setDiagnosticRect(){try{if(av()){webapis.avplay.setDisplayRect(0,0,1920,1080);webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');}}catch(e){msg('Ошибка displayRect: '+e.message);}}
function togglePause(){try{if(video){if(video.paused){video.play();paused=false;}else{video.pause();paused=true;}}else if(av()){var state=webapis.avplay.getState();if(state==='PLAYING'){webapis.avplay.pause();paused=true;}else if(state==='PAUSED'||state==='READY'){webapis.avplay.play();paused=false;}}if(paused){saveProgress(true);flushMutations();}updateProgress();}catch(e){msg('Ошибка паузы: '+e.message);}}
function registerMediaKeys(){try{if(window.tizen&&tizen.tvinputdevice){var supported=tizen.tvinputdevice.getSupportedKeys()||[];['MediaPlayPause','MediaPlay','MediaPause','MediaStop'].forEach(function(n){if(supported.some(function(k){return k.name===n;}))try{tizen.tvinputdevice.registerKey(n);}catch(e){}});}}catch(e){}}

function msg(s){
 status.textContent=s;status.title=s;
 updateHeaderNotice();
}
function updateHeaderNotice(){
 var header=document.getElementById('headerStatus');if(!header)return;
 var value=status.textContent||'';
 var urgent=/Ошибка|ошибка|Не удалось|не удалось|недоступен|недоступна|Неожиданный|неизвестный формат|Сначала останови|Дождись|Требуется вход|Для этой функции|Нет новинок|нет распознанного|Проверка неполная|получена частично|показаны доступные данные|восстановить позицию/.test(value);
 var syncTrouble=!!token&&!!(syncError||favoriteReadError||favoriteSyncError||(startupSyncError&&!freshTimecodes));
 if(syncTrouble&&!urgent){
  status.textContent=favoriteReadError?'Не удалось загрузить избранное · доступны сохранённые данные':
   favoriteSyncError?'Не удалось изменить избранное · подробности в «Аккаунте»':'Ошибка синхронизации · подробности в «Аккаунте»';
  status.title=status.textContent;urgent=true;
 }
 header.classList.toggle('has-warning',urgent||syncTrouble);
}

function request(path,done,fail,index){index=index||0;if(index>=BASES.length){fail('API недоступен. Проверь сеть, CORS и адрес API.');return;}
 var xhr=new XMLHttpRequest();xhr.open('GET',BASES[index]+path,true);xhr.timeout=13000;xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){try{done(JSON.parse(xhr.responseText));}catch(e){fail('Ошибка JSON: '+e.message);}}else request(path,done,fail,index+1);};xhr.onerror=xhr.ontimeout=function(){request(path,done,fail,index+1);};xhr.send();}
function arr(x){if(Array.isArray(x))return x;if(x&&Array.isArray(x.data))return x.data;if(x&&Array.isArray(x.items))return x.items;return [];}
function title(r){return (r.name&&(r.name.main||r.name.russian||r.name.english))||r.title||r.name_ru||('Релиз '+r.id);}
function imageCandidates(r){
 var p=r&&((r.poster||r.posters))||{},list=[];
 function add(v){
  if(!v)return;
  if(typeof v==='object'){add(v.original);add(v.main);add(v.src);add(v.url);add(v.preview);add(v.thumbnail);return;}
  if(typeof v!=='string')return;
  if(v.indexOf('//')===0)v='https:'+v;
  else if(v.charAt(0)==='/')v='https://aniliberty.top'+v;
  else if(!/^https?:\/\//i.test(v))return;
  if(list.indexOf(v)<0)list.push(v);
 }


 add(p.main);add(p.preview);
 if(p.optimized)add(p.optimized.preview);
 add(p.original);add(p.src);add(p.url);
 if(typeof p==='string')add(p);
 if(p.optimized){add(p.optimized.original);add(p.optimized.main);}
 add(p.thumbnail);if(p.optimized)add(p.optimized.thumbnail);
 add(r&&r.image);
 return list;
}


function attachArtwork(container,urls,fallback,eager,context){
 var isPoster=fallback==='Нет обложки',ratio=isPoster?2/3:16/9;
 var placeholder=isPoster?'title-placeholder.png':'episode-placeholder.png';
 var img=node('img','artwork-image');img.alt='';
 img.setAttribute('width',isPoster?'240':'320');
 img.setAttribute('height',isPoster?'360':'180');
 if(!eager)img.loading='lazy';
 var candidates=urls.slice(),index=0,failed=[],bestUrl='',bestWidth=0;
 function layout(){
  if(!img.naturalWidth||!img.naturalHeight)return;
  var width=container.clientWidth;if(!width)return;
  var sourceRatio=img.naturalWidth/img.naturalHeight;
  img.style.width='100%';img.style.height='auto';img.style.marginLeft='0';img.style.marginTop='0';
  if(Math.abs(sourceRatio-ratio)<0.035){container.style.height='';return;}
  var targetHeight=width/ratio;
  container.style.height=targetHeight+'px';
  if(sourceRatio>ratio){
   var imgWidth=targetHeight*sourceRatio;
   img.style.width=imgWidth+'px';img.style.marginLeft=-((imgWidth-width)/2)+'px';
  }else{
   var imgHeight=width/sourceRatio;
   img.style.marginTop=-((imgHeight-targetHeight)/2)+'px';
  }
 }
 function fallbackImage(){
  if(bestUrl){img.onerror=null;img.onload=layout;img.src=bestUrl;layout();return;}
  img.onerror=null;img.onload=layout;img.src=placeholder;
  if(context&&failed.length)logError('Изображение',context+' · '+failed.join(' | '));
  if(!container.querySelector('.poster-fallback,.episode-no-preview'))
   container.appendChild(node('div',isPoster?'poster-fallback':'episode-no-preview',fallback));
 }
 function loadNext(){
  if(index<candidates.length){img.src=candidates[index++];return;}
  fallbackImage();
 }
 img.onload=function(){
  var width=img.naturalWidth||0;
  if(width>=bestWidth){bestWidth=width;bestUrl=img.src;}

  if(width<(isPoster?260:240)&&index<candidates.length){
   if(!container._lowResUrl)container._lowResUrl=img.src;
   loadNext();return;
  }
  layout();
 };
 img.onerror=function(){failed.push(img.src);loadNext();};
 container._layoutArtwork=layout;
 container._refreshArtwork=function(next){
  if(!next||!next.length)return;
  var added=next.filter(function(url){return candidates.indexOf(url)<0;});
  if(!added.length)return;

  candidates=added.concat(candidates);
  index=0;
  loadNext();
 };
 container.appendChild(img);
 if(candidates.length)loadNext();else fallbackImage();
}
function enhanceTitleArtwork(id,release){
 var cards=visibleTitleCards[String(id)]||[],urls=imageCandidates(release);
 if(!urls.length)return;
 cards.forEach(function(card){
  var art=card.querySelector('.title-card-art');
  if(art&&art._refreshArtwork)art._refreshArtwork(urls);
 });
}
window.addEventListener('resize',function(){
 Array.prototype.forEach.call(document.querySelectorAll('.title-card-art,.episode-thumb'),function(art){if(art._layoutArtwork)art._layoutArtwork();});
});
function node(tag,cl,txt){var e=document.createElement(tag);if(cl)e.className=cl;if(txt!=null)e.textContent=txt;return e;}
function clear(){cancelFocusScroll();rememberFocus();grid.innerHTML='';visibleTitleCards=Object.create(null);titleImagePriority=0;titleRequestQueue.forEach(function(r){delete titleRequestPending[String(r.id)];});titleRequestQueue=[];detail.innerHTML='';detail.hidden=true;grid.hidden=false;}

var titleReleaseCache={},titlePosterCache={},titleRequestQueue=[],titleRequestBusy=0,titleRequestPending={},titleRequestFailure={},titleRequestTimer=null;
var releaseRequestSerial=0,titleReleaseCacheSerial=Object.create(null);
function titleGroup(r){var id=String(r&&r.id||'');if(!id)return null;groupedHistory();return cachedHistoryById[id]||null;}
function titleEpisodeData(r){
 var id=String(r&&r.id||''),a=availability[id];
 var best=null,bestSerial=-1;
 function consider(full,serial){
  if(full&&episodeList(full).length&&serial>=bestSerial){best=full;bestSerial=serial;}
 }


 consider(r,Number(r&&r._tvEpisodesSerial)||0);
 consider(titleReleaseCache[id],Number(titleReleaseCacheSerial[id])||0);
 if(a&&a.status==='ok')consider(a.full,Number(a.serial)||Number(a.checked)||0);
 return best;
}
function cacheTitleEpisodes(r,serial){
 if(!r||r.id==null||!episodeList(r).length)return;
 var id=String(r.id),version=Number(serial)||Number(r._tvEpisodesSerial)||0;
 if(version>=Number(titleReleaseCacheSerial[id]||0)){
  titleReleaseCache[id]=r;titleReleaseCacheSerial[id]=version;

  r._tvEpisodesSerial=version;
 }
}
function titleEpisodeRecord(r,ep,g){
 if(!token)return {watched:false,pos:0};
 var id=String(ep.id),m=mutations[id];
 if(m)return m.op==='delete'?{watched:false,pos:0}:{watched:!!m.watched,pos:m.time*1000};


 var p=serverPositions[id];
 if(freshTimecodes)return p?{watched:!!p.watched,pos:Number(p.pos)||0}:{watched:false,pos:0};
 var e=g&&g.episodesById&&g.episodesById[id];
 if(p)return {watched:!!p.watched,pos:Number(p.pos)||0};
 if(e)return {watched:!!e.watched,pos:Number(e.ms)||0};
 try{var l=JSON.parse(localStorage.getItem(storeKey(r,ep))||'null');if(l)return {watched:!!l.watched,pos:Number(l.pos)||0};}catch(e){}
 return {watched:false,pos:0};
}
function titleStatus(r){
 var g=titleGroup(r),full=titleEpisodeData(r),eps=full?episodeList(full).slice().sort(function(a,b){return epNum(a)-epNum(b);}):[];
 if(!eps.length){
  if(g&&g.latest&&!g.latest.watched&&g.latest.ms>0)return {kind:'progress',episode:null,text:'Серия '+(g.latest.episode.ordinal||g.latest.episode.number||'?')+' · '+stamp(g.latest.ms)};
  return {kind:'unknown',text:titleRequestFailure[String(r&&r.id||'')]?'Нет данных о сериях':'Загрузка серий…'};
 }
 var watchedCount=0,lastWatchedIndex=-1,partial=null;
 eps.forEach(function(ep,i){
  var v=titleEpisodeRecord(full,ep,g);
  if(v.watched){watchedCount++;lastWatchedIndex=i;}
  else if(v.pos>0&&(!partial||i>partial.index))partial={index:i,episode:ep,pos:v.pos};
 });
 if(partial)return {kind:'progress',episode:partial.episode,pos:partial.pos,text:'Серия '+(partial.episode.ordinal||partial.episode.number||'?')+' · '+stamp(partial.pos)};
 if(!watchedCount)return {kind:'available',nextEpisode:eps[0],text:'Доступно '+eps.length+' '+seriesWord(eps.length)};

 if(watchedCount===eps.length)
  return {kind:'complete',watchedCount:watchedCount,total:eps.length,text:'Просмотрено '+watchedCount+' из '+eps.length};


 var next=null;
 for(var i=lastWatchedIndex+1;i<eps.length;i++){
  if(!titleEpisodeRecord(full,eps[i],g).watched){next=eps[i];break;}
 }
 if(!next){
  for(var j=0;j<eps.length;j++){
   if(!titleEpisodeRecord(full,eps[j],g).watched){next=eps[j];break;}
  }
 }
 return {kind:'new',nextEpisode:next,text:'Новые серии · следующая '+episodeNumber(next)};
}
function syncEpisodeTile(tile,r,ep,g){
 var v=titleEpisodeRecord(r,ep,g),label=tile.querySelector('.episode-watch');
 if(!label)return;
 var state=v.watched?'complete':v.pos>0?'progress':'available';
 var text=v.watched?'Просмотрено':v.pos>0?'Продолжить с '+stamp(v.pos):'';
 if(label.textContent!==text)label.textContent=text;
 var stateClass='episode-tile episode-state-'+state;
 if(tile.className!==stateClass)tile.className=stateClass;
}
function refreshVisibleEpisodeTiles(){
 if(screenName!=='release'||!current||playing)return;
 var g=titleGroup(current),tiles=detail.querySelectorAll('.episode-tile');
 Array.prototype.forEach.call(tiles,function(tile){if(tile._titleEpisode)syncEpisodeTile(tile,current,tile._titleEpisode,g);});
}
function seriesWord(n){var m=n%100;if(m>=11&&m<=14)return 'серий';m=n%10;return m===1?'серия':m>=2&&m<=4?'серии':'серий';}
function updateTitleCard(b,r){
 if(!b)return;
 var state=titleStatus(r),foot=b.querySelector('.title-card-footer');if(!foot)return;
 if(state.kind==='unknown'&&b._fallbackTitleStatus&&!titleRequestFailure[String(r&&r.id||'')])state={kind:'progress',text:b._fallbackTitleStatus};
 if(foot.textContent!==state.text)foot.textContent=state.text;
 var fc='title-card-footer title-status-'+state.kind;if(foot.className!==fc)foot.className=fc;
 var old=b._titleStateKind;if(old!==state.kind){if(old)b.classList.remove('title-state-'+old);b.classList.add('title-state-'+state.kind);b._titleStateKind=state.kind;}
 var a=title(r)+(state.text?' · '+state.text:'');if(b.getAttribute('aria-label')!==a)b.setAttribute('aria-label',a);
}
function refreshVisibleTitleCards(){Object.keys(visibleTitleCards).forEach(refreshTitleCardsForId);}
function refreshVisibleProgressViews(){
 refreshVisibleTitleCards();
 if(screenName==='release'){refreshVisibleEpisodeTiles();refreshReleasePrimary();}
}
function enqueueTitleDetails(r){
 var id=String(r&&r.id||'');if(!id||titlePosterCache[id]||titleRequestPending[id]||titleRequestFailure[id])return;
 titleRequestPending[id]=true;titleRequestQueue.push(r);

 if(!titleRequestTimer)titleRequestTimer=setTimeout(function(){titleRequestTimer=null;pumpTitleDetails();},180);
}
function pumpTitleDetails(){

 while(titleRequestBusy<2&&titleRequestQueue.length){
  (function(r){var id=String(r.id);titleRequestBusy++;var readSerial=++releaseRequestSerial;
   request('/anime/releases/'+encodeURIComponent(id),function(res){
    var full=res.data||res;
    if(episodeList(full).length){cacheTitleEpisodes(full,readSerial);delete titleRequestFailure[id];}
    else titleRequestFailure[id]=true;
    titlePosterCache[id]=imageCandidates(full);enhanceTitleArtwork(id,full);
    delete titleRequestPending[id];
    onTitleEpisodeDataChanged(id);titleRequestBusy--;pumpTitleDetails();
   },function(err){logError('Карточка тайтла '+id,err);titleRequestFailure[id]=true;delete titleRequestPending[id];onTitleEpisodeDataChanged(id);titleRequestBusy--;pumpTitleDetails();});
  })(titleRequestQueue.shift());
 }
}
function titleCard(release,status,focusKey,open){
 var b=assignFocus(node('button','card title-card'),focusKey),id=String(release&&release.id||'');
 b._titleRelease=release;b._fallbackTitleStatus=status||'';if(release&&release.id&&favoriteValue(release.id))rememberFavoriteTitle(release);
 var art=node('div','title-card-art');attachArtwork(art,imageCandidates(release),'Нет обложки',titleImagePriority++<14,title(release));
 var nameOverlay=node('div','title-card-name');nameOverlay.appendChild(node('span','title-card-name-text',title(release)));art.appendChild(nameOverlay);
 b.appendChild(art);
 b.appendChild(node('div','title-card-footer'));
 updateTitleCard(b,release);b.onclick=open;b._longPress=function(){openTitleActions(release);};
 if(id){
  (visibleTitleCards[id]||(visibleTitleCards[id]=[])).push(b);
  if(titlePosterCache[id])art._refreshArtwork(titlePosterCache[id]);
 }
 enqueueTitleDetails(release);
 return b;
}
function renderCatalog(data,resetToFirst){catalogSnapshot=data;clear();setScreen('catalog');refreshSurfaceTimecodes();var list=arr(data);msg(list.length?'Тайтлов: '+list.length:'Нет новинок');list.forEach(function(r){grid.appendChild(titleCard(r,null,'catalog-'+String(r.id||r.alias),function(){openRelease(r);}));});if(resetToFirst){delete focusMemory.catalog;var main=document.getElementById('scrollMain');cancelFocusScroll();if(main)main.scrollTop=0;restoreFocus(list.length?'catalog-'+String(list[0].id||list[0].alias):'latest');if(main)scrollFocusTo(main,0,true);}else restoreFocus();}
function showLoginRequired(feature,section){
 clear();if(section==='continue'){historyMode='continue';section='history';}
 setScreen(section||'account');grid.hidden=true;detail.hidden=false;
 msg('Для этой функции требуется аккаунт AniLiberty');
 detail.appendChild(node('h1','','Войдите в аккаунт'));
 detail.appendChild(node('p','','Для работы с '+feature+' нужна авторизация. Без аккаунта можно открывать тайтлы и смотреть серии, но прогресс не сохраняется.'));
 var actions=node('div','release-actions');
 var enter=assignFocus(node('button','release-primary','Войти в аккаунт'),'guest-login');
 enter.onclick=function(){showAccount();};actions.appendChild(enter);
 detail.appendChild(actions);

 var header=document.querySelector('header');
 if(!header||!header.contains(document.activeElement))focusAndReveal(enter,true);
}
function promptGuestLogin(){
 var box=actionMenu('Требуется авторизация','Чтобы управлять статусами просмотра, войдите в аккаунт AniLiberty.');
 var enter=menuAction(box,'Войти в аккаунт',function(){closeActionDialog();showAccount();},false);
 menuClose(box);focusWithoutBrowserScroll(enter);
}
function showContinue(){
 if(!token){showLoginRequired('разделом «Продолжить»','continue');return;}
 if(token&&!accountReady&&!historyLoading)startBackgroundHistory();

 showServerContinue('continue');
 if(token)refreshQuickHistory();
}
function authRequest(path,method,body,done,fail,index){
 var epoch=authEpoch,accountToken=token;
 var favoriteWrite=path==='/accounts/users/me/favorites'&&(method==='POST'||method==='DELETE');
 function attempt(i){
  if(epoch!==authEpoch||accountToken!==token)return;
  if(i>=BASES.length){fail('Сервер недоступен или запрос заблокирован (CORS).');return;}
  var xhr=new XMLHttpRequest();trackAuthenticatedXhr(xhr);
  xhr.open(method,BASES[i]+path,true);xhr.timeout=15000;
  xhr.setRequestHeader('Accept','application/json');
  if(body!==null)xhr.setRequestHeader('Content-Type','application/json');
  if(accountToken)xhr.setRequestHeader('Authorization','Bearer '+accountToken);
  xhr.onload=function(){
   untrackAuthenticatedXhr(xhr);if(epoch!==authEpoch||accountToken!==token)return;
   if(xhr.status>=200&&xhr.status<300){try{done(xhr.responseText&&xhr.responseText.trim()?JSON.parse(xhr.responseText):null);}catch(e){fail('Неверный ответ API: '+e.message);}}
   else if(xhr.status===401||xhr.status===403)fail('Нет доступа (HTTP '+xhr.status+'). Проверь авторизацию.');
   else if(!favoriteWrite&&i+1<BASES.length)attempt(i+1);
   else{logError('API',path+' HTTP '+xhr.status);fail('Ошибка API: HTTP '+xhr.status);}
  };
  xhr.onerror=xhr.ontimeout=function(){
   untrackAuthenticatedXhr(xhr);if(epoch!==authEpoch||accountToken!==token)return;
   if(!favoriteWrite&&i+1<BASES.length)attempt(i+1);
   else{logError('API',path+' Сетевая ошибка / CORS');fail('Сетевая ошибка / CORS');}
  };
  try{xhr.send(body===null?null:JSON.stringify(body));}
  catch(e){untrackAuthenticatedXhr(xhr);if(epoch===authEpoch&&accountToken===token)fail('Ошибка запроса: '+e.message);}
 }
 attempt(index||0);
}

var loginDialog=null,loginReturnFocus=null,loginInFlight=false;
function closeLoginDialog(){
 if(!loginDialog)return;
 var closing=loginDialog;loginDialog=null;
 var password=closing.querySelector('#loginPassword');if(password)password.value='';
 closing.remove();loginInFlight=false;
 if(loginReturnFocus&&document.contains(loginReturnFocus))focusWithoutBrowserScroll(loginReturnFocus);
 loginReturnFocus=null;
}
function loginAccount(){
 if(loginDialog)return;
 loginReturnFocus=document.activeElement;
 var overlay=node('div','login-overlay');overlay.id='loginDialog';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 var form=node('form','login-dialog');form.setAttribute('autocomplete','off');
 form.appendChild(node('h2','','Вход в AniLiberty'));
 form.appendChild(node('p','login-description','Введите данные аккаунта. Пароль не сохраняется на телевизоре.'));
 var loginLabel=node('label','','Логин');loginLabel.setAttribute('for','loginUsername');
 var username=node('input','login-input');username.id='loginUsername';username.type='text';username.autocomplete='username';username.spellcheck=false;username.autocapitalize='off';
 var passwordLabel=node('label','','Пароль');passwordLabel.setAttribute('for','loginPassword');
 var password=node('input','login-input');password.id='loginPassword';password.type='password';password.autocomplete='current-password';
 var info=node('p','login-error','');info.id='loginError';info.setAttribute('role','status');
 var actions=node('div','login-actions'),submit=node('button','login-submit','Войти'),cancel=node('button','login-cancel','Отмена');
 submit.type='submit';cancel.type='button';cancel.onclick=closeLoginDialog;
 actions.appendChild(submit);actions.appendChild(cancel);
 form.appendChild(loginLabel);form.appendChild(username);form.appendChild(passwordLabel);form.appendChild(password);form.appendChild(info);form.appendChild(actions);
 overlay.appendChild(form);document.body.appendChild(overlay);loginDialog=overlay;
 form.onsubmit=function(e){
  e.preventDefault();if(loginInFlight)return;
  var enteredLogin=username.value.trim(),enteredPassword=password.value;
  if(!enteredLogin||!enteredPassword){info.textContent='Заполни логин и пароль.';return;}
  loginInFlight=true;submit.disabled=true;cancel.disabled=true;info.textContent='Выполняется вход…';

  authRequest('/accounts/users/auth/login','POST',{login:enteredLogin,password:enteredPassword},function(data){
   password.value='';
   if(!loginDialog)return;
   loginInFlight=false;
   if(!data||!data.token){info.textContent='Сервер не вернул токен';submit.disabled=false;cancel.disabled=false;return;}
   closeLoginDialog();endAccountSession();token=data.token;localStorage.setItem(TOKEN_KEY,token);
   loadMutations();loadFavoriteState();favoriteBootstrapDone=false;refreshFavoriteIds();loadAccount(true);showAccount();
  },function(err){
   password.value='';if(!loginDialog)return;
   loginInFlight=false;submit.disabled=false;cancel.disabled=false;
   info.textContent='Не удалось войти: '+err;focusWithoutBrowserScroll(password);
  });
 };
 focusWithoutBrowserScroll(username);
}
function logoutLocal(){
 var count=pendingMutationCount();
 if(count&&!confirm('Есть '+count+' неотправленных изменений. При выходе они будут удалены с телевизора и не будут отправлены позже. Продолжить?'))return;
 endAccountSession();showAccount('account-login');updateIndicator();
}
function clearLocalHistory(){
 if(!token){showLoginRequired('историей просмотра','account');return;}
 if(playing){msg('Сначала останови воспроизведение, затем повтори удаление.');return;}
 if(syncInFlight){msg('Идёт отправка просмотра на сайт. Дождись её завершения, затем повтори локальную очистку.');return;}
 if(!confirm('Удалить локальную историю и все ожидающие отправки изменения?\n\nИстория на сайте НЕ изменится. Для удаления отметок на сайте используй меню серии или тайтла.'))return;
 var keys=[];
 try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k===HISTORY_KEY||k.indexOf('al_tv_progress_')===0)keys.push(k);}
 keys.forEach(function(k){localStorage.removeItem(k);});
 clearTimeout(syncTimer);syncTimer=null;++historyFetchId;++quickHistoryRequestId;++checkGeneration;
 historyLoading=false;quickHistoryInFlight=false;syncError='';syncLastSuccess=0;freshTimecodes=false;
 serverPositions={};serverHistory=[];invalidateHistoryIndex();mutations=Object.create(null);localStorage.removeItem(mutationStorageKey());cacheClear();accountReady=false;historyOffset=0;historyComplete=false;
 showAccount('account-clear');msg('Локальная история очищена. Данные на сайте не изменены. Для загрузки нажми «Загрузить историю с сайта».');
 }catch(e){msg('Ошибка очистки локальной истории: '+e.message);}
}


function freshAccountPath(path){return path+(path.indexOf('?')<0?'?':'&')+'_tv_read='+Date.now()+'_'+(++accountReadSerial);}
function parseRemoteTimecodes(codes){
 if(!Array.isArray(codes))return null;
 var result=Object.create(null);
 codes.forEach(function(t){if(Array.isArray(t)&&t.length>=3&&t[0]!=null)result[String(t[0])]={pos:Number(t[1])*1000||0,watched:!!t[2]};});
 return result;
}
function remoteChanged(next){
 var before=Object.keys(serverPositions),after=Object.keys(next);
 if(before.length!==after.length)return true;
 for(var i=0;i<after.length;i++){var id=after[i],a=serverPositions[id],b=next[id];if(!a||a.pos!==b.pos||a.watched!==b.watched)return true;}
 return false;
}
function publishRemoteTimecodes(fresh,readSerial){

 if(readSerial&&readSerial<remoteResponseSerial)return false;
 if(readSerial)remoteResponseSerial=readSerial;
 var changed=!freshTimecodes||remoteChanged(fresh);
 serverPositions=fresh;freshTimecodes=true;serverTimecodesFetchedAt=Date.now();remoteLastTimecodesCount=Object.keys(fresh).length;
 var journalChanged=reconcileConfirmedTimecodes();
 if(changed||journalChanged){invalidateHistoryIndex();refreshVisibleProgressViews();scheduleHistoryRepaint();}
 return changed||journalChanged;
}


function verifyRemoteTimecodes(loadId,attempt){
 if(loadId!==historyFetchId||!token)return;
 remoteVerifyCount=attempt;
 var url=freshAccountPath('/accounts/users/me/views/timecodes'),readSerial=accountReadSerial;
 authRequest(url,'GET',null,function(codes){
  if(loadId!==historyFetchId||!token)return;
  var fresh=parseRemoteTimecodes(codes);
  if(!fresh){logError('Проверка таймкодов','Неожиданный формат');return;}
  if(readSerial<remoteResponseSerial)return;
  var changed=publishRemoteTimecodes(fresh,readSerial);remoteLastVerifiedAt=Date.now();updateIndicator();
  if(changed)logError('Проверка синхронизации','Обнаружено обновление сайта при проверке '+attempt);
 },function(err){if(loadId===historyFetchId)logError('Проверка таймкодов',err);});
}
function scheduleRemoteVerification(loadId){
 clearTimeout(remoteVerifyTimer);remoteVerifyCount=0;

 remoteVerifyTimer=setTimeout(function(){verifyRemoteTimecodes(loadId,1);remoteVerifyTimer=setTimeout(function(){verifyRemoteTimecodes(loadId,2);remoteVerifyTimer=null;},6500);},3000);
}
function loadAccount(background){historyUserRequested=!background;if(!token){showAccount();return;}if(historyLoading)return;clearTimeout(remoteVerifyTimer);remoteVerifyTimer=null;historyLoading=true;historyLoadStarted=Date.now();updateIndicator();historyLastPaint=0;var loadId=++historyFetchId;freshHistoryComplete=false;if(!background)msg('Обновляю историю с сайта…');
 var url=freshAccountPath('/accounts/users/me/views/timecodes'),readSerial=accountReadSerial;
 authRequest(url,'GET',null,function(codes){
  if(loadId!==historyFetchId)return;
  var fresh=parseRemoteTimecodes(codes);
  if(!fresh){historyLoading=false;logError('Таймкоды','Неожиданный формат ответа');msg('Сервер вернул неизвестный формат таймкодов; данные не перезаписаны.');finishStartupSync('Неожиданный формат таймкодов');updateIndicator();return;}
  publishRemoteTimecodes(fresh,readSerial);scheduleRemoteVerification(loadId);

  if(pendingMutationCount())flushMutations();
  finishStartupSync(null);
  loadHistoryPage(1,[],50,{},loadId,background);
 },function(err){historyLoading=false;finishStartupSync(err);msg('Не удалось получить таймкоды: '+err);updateIndicator();});
}
function loadHistoryPage(page,all,limit,seen,loadId,background){
 limit=limit||50;seen=seen||{};
 if(loadId!==historyFetchId)return;
 updateIndicator();if(!background||page%4===1)msg('Загружаю историю сайта: '+all.length+' записей (страница '+page+', по '+limit+')…');
 authRequest(freshAccountPath('/accounts/users/me/views/history?page='+page+'&limit='+limit),'GET',null,function(result){
  if(loadId!==historyFetchId)return;
  var chunk=arr(result),pg=result&&result.meta&&result.meta.pagination;
  var total=pg&&(Number(pg.total_pages)||Number(pg.totalPages)||0);
  var count=pg&&(Number(pg.total)||Number(pg.total_items)||Number(pg.totalItems)||0);
  if(chunk.length){
   var signature=chunk.map(function(x){return String(x.id||((x.release_episode||{}).id)||JSON.stringify(x).slice(0,100));}).join('|');
   if(seen[signature]){finishHistory(all,false,'API повторил страницу '+page+'; загрузка остановлена',loadId);return;}
   seen[signature]=true;
  }
  all=all.concat(chunk);

  var more=total?page<total:count?all.length<count:chunk.length===limit;
  if(more&&chunk.length&&page<10000){loadHistoryPage(page+1,all,limit,seen,loadId,background);return;}
  finishHistory(all,!more,more?'Достигнут защитный предел страниц':'',loadId);
 },function(err){if(loadId===historyFetchId)finishHistory(all,false,'Ошибка страницы '+page+': '+err,loadId);});
}
function finishHistory(all,complete,warning,loadId){
 if(loadId!==historyFetchId)return;
 historyLoading=false;


 if(complete){serverHistory=mergeRecentHistoryEntries(all,recentHistoryResult||[]);historyComplete=true;freshHistoryComplete=true;historyReady=true;cacheStats.source='сервер';reconcileConfirmedTimecodes();}
 else {historyStaleCount++;logError('История',warning||'Неполный список');historyReady=historyReady||!!serverHistory.length;}
 accountReady=historyReady||freshTimecodes;
 invalidateHistoryIndex();refreshVisibleProgressViews();updateIndicator();
 if(complete){cacheWrite();beginAvailability();}
 flushMutations();
 if(screenName==='history'&&!grid.hidden)showServerContinue(historyMode,false,true);
 else if(historyUserRequested)showServerContinue('continue',true);
 if(!complete)msg('История сайта получена частично ('+all.length+'): '+(warning||'неполная загрузка')+'. Сохранён предыдущий полный список.');
}

function historyEntryId(row){var ep=row&&row.release_episode||{};return ep.id!=null?'episode:'+String(ep.id):row&&row.id!=null?'row:'+String(row.id):'';}
function mergeRecentHistoryEntries(existing,recent){
 var seen=Object.create(null),merged=[];
 function add(row){var id=historyEntryId(row);if(id&&seen[id])return;if(id)seen[id]=true;merged.push(row);}
 recent.forEach(add);existing.forEach(add);
 return merged;
}
function refreshQuickHistory(){
 if(!token||quickHistoryInFlight||!startupSyncDone)return;
 quickHistoryInFlight=true;var id=++quickHistoryRequestId,account=token,readDone=false,historyDone=false;
 var path=freshAccountPath('/accounts/users/me/views/timecodes'),serial=accountReadSerial;
 authRequest(path,'GET',null,function(codes){
  if(id!==quickHistoryRequestId||account!==token)return;
  var fresh=parseRemoteTimecodes(codes);
  if(fresh){publishRemoteTimecodes(fresh,serial);remoteLastVerifiedAt=Date.now();updateIndicator();}
  else logError('Быстрое обновление','Неизвестный формат таймкодов');
  readDone=true;if(historyDone)quickHistoryInFlight=false;
 },function(err){if(id!==quickHistoryRequestId||account!==token)return;logError('Быстрые таймкоды',err);readDone=true;if(historyDone)quickHistoryInFlight=false;});
 authRequest(freshAccountPath('/accounts/users/me/views/history?page=1&limit=50'),'GET',null,function(data){
  if(id!==quickHistoryRequestId||account!==token)return;
  var fresh=arr(data);

  if(fresh.length){
   recentHistoryResult=fresh;
   serverHistory=mergeRecentHistoryEntries(serverHistory,fresh);
   historyReady=true;accountReady=true;invalidateHistoryIndex();

   if(screenName==='history')scheduleHistoryRepaint();
  }
  historyDone=true;if(readDone)quickHistoryInFlight=false;
 },function(err){if(id!==quickHistoryRequestId||account!==token)return;logError('Последние 50 просмотров',err);historyDone=true;if(readDone)quickHistoryInFlight=false;});
}
function epNum(ep){var n=Number(ep.ordinal!=null?ep.ordinal:ep.number);return isFinite(n)?n:0;}
function groupedHistory(){
 if(cachedHistoryGroups)return cachedHistoryGroups;
 var groups=Object.create(null),meta=Object.create(null),recent=[];
 if(token)try{recent=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')||[];}catch(e){}
 function remember(r,ep){if(r&&r.id&&ep&&ep.id)meta[String(ep.id)]={release:r,episode:ep};}

 serverHistory.forEach(function(item){var ep=item.release_episode||{};remember(ep.release||{},ep);});
 recent.forEach(function(item){remember(item.release||{},item.episode||{});});
 Object.keys(mutations).forEach(function(id){var m=mutations[id];remember(m.release,m.episode);});
 Object.keys(titleReleaseCache).forEach(function(id){var r=titleReleaseCache[id];episodeList(r).forEach(function(ep){remember(r,ep);});});
 Object.keys(availability).forEach(function(id){var a=availability[id];if(a&&a.full)episodeList(a.full).forEach(function(ep){remember(a.full,ep);});});
 function insert(r,ep,ms,watched,updated){
  if(!r||!r.id||!ep||!ep.id)return;
  var rid=String(r.id),id=String(ep.id),g=groups[rid];
  if(!g)g=groups[rid]={release:r,latest:null,unfinished:null,count:0,updated:0,episodes:[],episodesById:Object.create(null)};
  var existing=g.episodesById[id];
  if(existing){existing.ms=ms;existing.watched=watched;existing.updated=updated||existing.updated;return;}
  var entry={release:r,episode:ep,ms:ms,watched:watched,updated:updated||0};
  g.episodesById[id]=entry;g.episodes.push(entry);g.count++;
 }
 serverHistory.forEach(function(item){
  var ep=item.release_episode||{},r=ep.release||{},id=String(ep.id||''),m=mutations[id],p=serverPositions[id];
  if(!id||!r.id||m&&m.op==='delete')return;


  if(freshTimecodes&&!p&&!m)return;
  var ms=m?m.time*1000:p?Number(p.pos)||0:Number(item.time||0)*1000;
  var watched=m?!!m.watched:p?!!p.watched:!!item.is_watched;
  if(!watched&&ms<=0)return;
  var updated=m?m.updated:(Date.parse(item.updated_at||item.created_at||0)||0);
  insert(r,ep,ms,watched,updated);
 });

 if(freshTimecodes){Object.keys(serverPositions).forEach(function(id){
  var p=serverPositions[id],m=mutations[id],known=meta[id];
  if(!known||m&&m.op==='delete')return;
  var ms=m?m.time*1000:Number(p.pos)||0,watched=m?!!m.watched:!!p.watched;
  if(watched||ms>0){var prior=groups[String(known.release.id)],already=prior&&prior.episodesById[id];
   insert(known.release,known.episode,ms,watched,m?m.updated:already?0:serverTimecodesFetchedAt);
  }
 });}

 if(!freshTimecodes)recent.forEach(function(item){
  var ep=item.episode||{},r=item.release||{},id=String(ep.id||''),m=mutations[id];
  if(!id||!r.id||m&&m.op==='delete')return;
  var local=null;try{local=JSON.parse(localStorage.getItem(storeKey(r,ep))||'null');}catch(e){}
  var p=serverPositions[id];if(m)p={pos:m.time*1000,watched:m.watched};
  if(!p&&local)p=local;if(!p)return;
  var ms=Number(p.pos)||0,watched=!!p.watched;
  if(watched||ms>0)insert(r,ep,ms,watched,Number(m&&m.updated||local&&local.updated||item.updated)||0);
 });


 Object.keys(mutations).forEach(function(id){var m=mutations[id],known=meta[id];
  if(!known)return;
  if(m.op==='delete'){var rid=String(known.release.id),g=groups[rid];if(g&&g.episodesById[id]){
    var existing=g.episodesById[id];g.episodes=g.episodes.filter(function(x){return x!==existing;});delete g.episodesById[id];g.count--;
   }return;}
  insert(known.release,known.episode,m.time*1000,!!m.watched,m.updated);
 });
 Object.keys(groups).forEach(function(id){var g=groups[id];g.latest=null;g.unfinished=null;g.updated=0;
  g.episodes.forEach(function(e){
   if(!g.latest||e.updated>g.latest.updated)g.latest=e;
   if(!e.watched&&e.ms>0&&(!g.unfinished||e.updated>g.unfinished.updated))g.unfinished=e;
   if(e.updated>g.updated)g.updated=e.updated;
  });
 });
 cachedHistoryGroups=Object.keys(groups).map(function(k){return groups[k];}).filter(function(g){return g.episodes.length>0;}).sort(function(a,b){return b.updated-a.updated;});
 cachedHistoryGroups.forEach(function(g){cachedHistoryById[String(g.release.id)]=g;});
 return cachedHistoryGroups;
}
var continueMembership=Object.create(null),continueRerenderTimer=null;
function scheduleContinueMembershipRefresh(){
 if(continueRerenderTimer||playing||screenName!=='history'||historyMode!=='continue')return;
 continueRerenderTimer=setTimeout(function(){
  continueRerenderTimer=null;
  if(!playing&&screenName==='history'&&historyMode==='continue')showServerContinue('continue',false,true);
 },60);
}
function onTitleEpisodeDataChanged(id){
 id=String(id||'');


 if(freshTimecodes&&cachedHistoryGroups){
  var r=titleEpisodeData({id:id}),g=cachedHistoryById[id];
  if(r&&episodeList(r).some(function(ep){return !!serverPositions[String(ep.id)]&&(!g||!g.episodesById[String(ep.id)]);})){invalidateHistoryIndex();}
 }
 refreshTitleCardsForId(id);
 if(playing)return;
 if(screenName==='history'&&historyMode==='continue'){
  var g=titleGroup({id:id});
  var state=g?titleStatus(titleEpisodeData(g.release)||g.release):null;
  var bucket=g?(state.kind==='progress'?'unfinished':state.kind==='new'?'new':'other'):'other';
  if(bucket!==(continueMembership[id]||'other'))scheduleContinueMembershipRefresh();
 }else if(screenName==='history')scheduleHistoryRepaint();
 else if(screenName==='release'&&current&&String(current.id)===id){refreshVisibleEpisodeTiles();refreshReleasePrimary();}
}
function historyCard(g){
 return titleCard(g.release,null,'anime-'+String(g.release.id),function(){openRelease(g.release);});
}
function showServerContinue(mode,reset,preserve,focusNewAt){
 var oldMode=historyMode;
 if(mode)historyMode=mode;
 var reuse=!!(preserve&&screenName==='history'&&historyMode===oldMode&&!grid.hidden);
 if(historyMode==='continue')continueMembership=Object.create(null);
 var prev=focusMemory.history||{},active=document.activeElement,selected=active&&focusId(active),main=document.getElementById('scrollMain'),oldScroll=main?main.scrollTop:0;
 if(reset!==false)historyOffset=0;
 if(!reuse){clear();setScreen('history');}
 var groups=groupedHistory();
 msg((historyMode==='continue'?'Продолжить':'История просмотров')+' · сайт и телевизор · '+groups.length+' аниме / '+serverHistory.length+' записей'+(!historyComplete?' · история обновляется':' '));
 var sections=[];
 if(historyMode==='continue'){
  var unfinished=[],unwatched=[],other=[];
  groups.forEach(function(g){var state=titleStatus(titleEpisodeData(g.release)||g.release);
   var bucket=state.kind==='progress'?'unfinished':state.kind==='new'?'new':'other';
   continueMembership[String(g.release.id)]=bucket;
   if(bucket==='unfinished')unfinished.push(g);else if(bucket==='new')unwatched.push(g);else other.push(g);
  });
  sections=[['Продолжить просмотр',unfinished],['Новые серии',unwatched]];
 }else sections=[['История просмотров',groups]];
 var reusedCards=Object.create(null),reusedHeadings=Object.create(null),reusedMore=null;
 if(reuse){Array.prototype.forEach.call(grid.children,function(el){
  var fid=el.getAttribute('data-focus-id');
  if(el.classList.contains('title-card')&&fid)reusedCards[fid]=el;
  else if(el.classList.contains('history-heading'))reusedHeadings[el.getAttribute('data-history-heading')]=el;
  else if(fid==='history-more')reusedMore=el;
 });}
 var wanted=[],totalShown=0,limit=historyOffset+historyPageSize,newFocus=null;
 sections.forEach(function(section,index){
  var heading=reusedHeadings[String(index)]||node('h2','history-heading');
  heading.setAttribute('data-history-heading',String(index));
  var headingText=section[0]+' · '+section[1].length;
  if(heading.textContent!==headingText)heading.textContent=headingText;
  wanted.push(heading);
  section[1].forEach(function(g){
   if(totalShown>=limit)return;
   var fid='anime-'+String(g.release.id),card=reusedCards[fid];
   if(card){card._titleRelease=g.release;card.onclick=function(){openRelease(g.release);};card._longPress=function(){openTitleActions(g.release);};updateTitleCard(card,g.release);}
   else card=historyCard(g);
   if(focusNewAt!=null&&totalShown===focusNewAt)newFocus=card;
   wanted.push(card);totalShown++;
  });
 });
 var visibleCount=sections.reduce(function(n,section){return n+section[1].length;},0);
 if(totalShown<visibleCount){
  var more=reusedMore||assignFocus(node('button','history-more'),'history-more');
  var label='Показать ещё ('+(visibleCount-totalShown)+')';if(more.textContent!==label)more.textContent=label;
  more.onclick=function(){var firstNew=limit;historyOffset+=historyPageSize;cancelFocusScroll();showServerContinue(historyMode,false,true,firstNew);};wanted.push(more);
 }
 if(reuse){

  Array.prototype.slice.call(grid.children).forEach(function(el){if(wanted.indexOf(el)<0)grid.removeChild(el);});
  wanted.forEach(function(el,i){if(grid.children[i]!==el)grid.insertBefore(el,grid.children[i]||null);});

  visibleTitleCards=Object.create(null);
  wanted.forEach(function(el){if(el._titleRelease){var id=String(el._titleRelease.id);(visibleTitleCards[id]||(visibleTitleCards[id]=[])).push(el);}});
 }else wanted.forEach(function(el){grid.appendChild(el);});
 if(!reuse)restoreFocus(selected||prev.id);
 else if(active&&!document.contains(active))restoreFocus(selected||prev.id);
 if(newFocus){focusAndReveal(newFocus,true);}
 else if(preserve&&main&&(!reuse||Math.abs(main.scrollTop-oldScroll)>1))scrollFocusTo(main,oldScroll,true);
}
function showHistory(){if(!token){historyMode='history';showLoginRequired('историей просмотра','history');return;}if(!accountReady&&!historyLoading)startBackgroundHistory();showServerContinue('history');if(token)refreshQuickHistory();}


function accountGroup(heading,description,items){
 var section=node('section','account-section');
 section.appendChild(node('h2','account-heading',heading));
 if(description)section.appendChild(node('p','account-note',description));
 var wrap=node('div','account-actions');
 items.forEach(function(item){
  var b=assignFocus(node('button','account-action',item[0]),item[2]);
  b.setAttribute('data-nav-axis','vertical');
  b.onclick=item[1];wrap.appendChild(b);
 });
 section.appendChild(wrap);detail.appendChild(section);
}
function wireAccountNavigation(){
 var items=Array.prototype.slice.call(detail.querySelectorAll('.account-action'));
 var accountTab=document.getElementById('accountBtn');
 if(!items.length){accountTab.removeAttribute('data-nav-down');return;}

 items.forEach(function(b,i){
  if(i)b.setAttribute('data-nav-up',focusId(items[i-1]));
  if(i+1<items.length)b.setAttribute('data-nav-down',focusId(items[i+1]));
 });
}
function appVersion(){try{if(window.tizen&&tizen.application){var info=tizen.application.getAppInfo();if(info&&info.version)return String(info.version);}}catch(e){}return '1.0.1';}


function showAccount(preferredFocusId){
 clear();setScreen('account');grid.hidden=true;detail.hidden=false;
 if(!preferredFocusId)refreshSurfaceTimecodes();
 var main=document.getElementById('scrollMain');if(main)scrollFocusTo(main,0,true);
 msg(token?'Аккаунт AniLiberty · '+syncSummary():'Просмотр без аккаунта · прогресс не сохраняется');
 detail.appendChild(node('h1','','Аккаунт AniLiberty'));
 if(token){
  detail.appendChild(node('p','account-intro','Вы вошли в аккаунт. Здесь можно обновить историю просмотров и управлять данными на телевизоре.'));
  var accountSyncLine=node('p','account-status',syncSummary()+(syncError?' · '+syncError:'')+' · '+favoriteSyncSummary());
  accountSyncLine.id='accountSyncStatus';detail.appendChild(accountSyncLine);
  accountGroup('Синхронизация','Получить актуальную историю просмотров с AniLiberty.',[
   ['Загрузить историю с сайта',function(){loadAccount(false);},'account-refresh']]);
  accountGroup('Данные на телевизоре','Удаляет локальную историю и ожидающие отправки изменения. Данные на сайте не удаляются.',[
   ['Очистить локальную историю',clearLocalHistory,'account-clear']]);
  accountGroup('Управление аккаунтом','Выход удалит с телевизора данные и прогресс текущего аккаунта.',[
   ['Выйти из аккаунта',function(){if(confirm('Выйти из аккаунта и удалить локальную историю и прогресс просмотра с телевизора?'))logoutLocal();},'account-logout']]);
 }else{
  detail.appendChild(node('p','account-intro','Для синхронизации истории просмотра и избранного войдите в AniLiberty. Без аккаунта каталог и воспроизведение доступны без сохранения прогресса.'));
  accountGroup('Авторизация','Выполните вход, чтобы синхронизировать просмотр и избранное.',[
   ['Войти в аккаунт',loginAccount,'account-login']]);
 }
 detail.appendChild(node('p','app-version','AniLiberty TV · '+appVersion()));
 wireAccountNavigation();
 var id=typeof preferredFocusId==='string'?preferredFocusId:'accountBtn';
 var target=document.getElementById(id);
 if(!target)target=Array.prototype.find.call(detail.querySelectorAll('button'),function(b){return focusId(b)===id;});
 focusAndReveal(target||document.getElementById('accountBtn'),true);
}
function latest(resetToFirst){var reset=resetToFirst===true;setScreen('catalog');msg('Загружаю новинки…');request('/anime/releases/latest?limit=49',function(data){if(screenName==='catalog')renderCatalog(data,reset);},function(e){if(screenName==='catalog')msg(e);});}


function franchiseLinks(payload,sourceId){
 var groups=arr(payload);if(!groups.length&&payload&&payload.franchise_releases)groups=[payload];
 var seen=Object.create(null),links=[];
 groups.forEach(function(group){
  arr(group&&group.franchise_releases).forEach(function(link,index){
   var id=link&&((link.release&&link.release.id)||link.release_id);
   if(id==null||!/^\d+$/.test(String(id))||seen[String(id)])return;
   seen[String(id)]=true;
   var order=Number(link.sort_order);
   links.push({id:Number(id),order:isFinite(order)?order:index,group:links.length});
  });
 });
 if(sourceId&&/^\d+$/.test(String(sourceId))&&!seen[String(sourceId)]){
  links.unshift({id:Number(sourceId),order:-1,group:-1});
 }
 return links.sort(function(a,b){return a.order-b.order||a.group-b.group;});
}
function fetchRelatedReleases(owner,success,failure){
 var source=relatedId(owner);
 request('/anime/franchises/release/'+encodeURIComponent(source),function(data){
  var links=franchiseLinks(data,source),other=links.filter(function(x){return String(x.id)!==source;});
  if(!other.length){success([]);return;}
  var all=Object.create(null),groups=[],pending=0,broken=false;
  for(var i=0;i<links.length;i+=50)groups.push(links.slice(i,i+50));
  pending=groups.length;
  groups.forEach(function(chunk){
   var params=chunk.map(function(x){return 'ids%5B%5D='+encodeURIComponent(x.id);}).join('&');
   request('/anime/releases/list?'+params+'&limit=50&page=1',function(result){
    var items=arr(result);
    items.forEach(function(r){if(r&&r.id!=null)all[String(r.id)]=r;});
    if(!--pending)finish();
   },function(err){broken=true;if(!--pending)finish();});
  });
  function finish(){
   var titles=links.map(function(x){return all[String(x.id)]||(String(x.id)===source?owner:null);}).filter(Boolean);

   if(broken){failure('Не удалось загрузить часть связанных релизов');return;}
   if(!titles.some(function(r){return relatedId(r)!==source})){success([]);return;}
   success(titles);
  }
 },failure);
}
function beginRelatedLookup(r){
 var id=relatedId(r),serial=++relatedLookupSerial;
 relatedState={id:id,status:'loading',items:[]};
 refreshReleaseRelatedButton();
 fetchRelatedReleases(r,function(items){
  if(serial!==relatedLookupSerial||!relatedState||relatedState.id!==id)return;
  relatedState={id:id,status:'ready',items:items};refreshReleaseRelatedButton();
 },function(err){
  if(serial!==relatedLookupSerial||!relatedState||relatedState.id!==id)return;
  relatedState={id:id,status:'error',items:[]};
  logError('Связанные '+id,err);refreshReleaseRelatedButton();
 });
}
function refreshReleaseRelatedButton(){
 var b=document.getElementById('releaseRelated');if(!b||!current)return;
 var available=relatedState&&relatedState.status==='ready'&&
  relatedState.id===relatedId(current)&&relatedState.items.some(function(r){return relatedId(r)!==relatedId(current);});
 b.hidden=!available;b.disabled=!available;
}


function refreshSurfaceTimecodes(){
 if(!token||!startupSyncDone)return;
 if(surfaceTimecodesLoading){surfaceTimecodesQueued=true;return;}
 surfaceTimecodesLoading=true;
 var account=token,path=freshAccountPath('/accounts/users/me/views/timecodes'),serial=accountReadSerial;
 function finish(){
  if(account!==token)return;
  surfaceTimecodesLoading=false;
  var again=surfaceTimecodesQueued;surfaceTimecodesQueued=false;
  if(again)refreshSurfaceTimecodes();
 }
 authRequest(path,'GET',null,function(codes){
  if(account!==token)return;
  var fresh=parseRemoteTimecodes(codes);
  if(fresh)publishRemoteTimecodes(fresh,serial);
  else logError('Синхронизация раздела','Некорректный ответ таймкодов');
  finish();
 },function(err){
  if(account===token)logError('Синхронизация раздела',err);
  finish();
 });
}
function refreshRelatedStatuses(){
 if(!token)return;
 refreshSurfaceTimecodes();
}
function showRelated(ctx,selected,scroll,fromChild){
 relatedScreen={owner:ctx.owner,items:ctx.items.slice(),fromChild:!!fromChild};
 clear();setScreen('related');grid.hidden=false;detail.hidden=true;
 grid.appendChild(node('h2','history-heading','Связанные · '+title(ctx.owner)));
 relatedScreen.items.forEach(function(r){
  var id=relatedId(r),fid='related-'+id;
  var b=titleCard(r,null,fid,function(){
   if(id===relatedId(relatedScreen.owner)){backFromRelated();return;}
   var main=document.getElementById('scrollMain');
   openRelease(r,{owner:relatedScreen.owner,items:relatedScreen.items,
    chosenId:id,scroll:main?main.scrollTop:0});
  });
  if(id===relatedId(relatedScreen.owner))b.classList.add('related-origin');
  grid.appendChild(b);
 });
 var main=document.getElementById('scrollMain');
 if(main)scrollFocusTo(main,scroll||0,true);
 var wanted=selected?'related-'+selected:'related-'+relatedId(relatedScreen.items[0]);
 restoreFocus(wanted);
 msg('Связанные · '+relatedScreen.items.length+' тайтлов');
 refreshRelatedStatuses();
}
function openRelated(){
 if(screenName!=='release'||!current||!relatedState||relatedState.status!=='ready'||relatedState.id!==relatedId(current))return;
 var ctx={owner:current,items:relatedState.items};showRelated(ctx,null,0,false);
}
function backFromRelated(){
 if(!relatedScreen){backFromRelease();return;}
 var ctx=relatedScreen;
 if(ctx.fromChild&&relatedTrail.length)relatedTrail.pop();
 relatedScreen=null;
 relatedState={id:relatedId(ctx.owner),status:'ready',items:ctx.items.slice()};
 ++relatedLookupSerial;
 showRelease(ctx.owner);
 if(token)refreshFavoriteIds();
 focusAndReveal(document.getElementById('releaseRelated'),true);
}
function openRelease(r,viaRelated){
 var main=document.getElementById('scrollMain');
 if(viaRelated){relatedPendingOpen=viaRelated;}
 else{
  relatedTrail=[];relatedScreen=null;relatedPendingOpen=null;
  releaseOrigin={screen:screenName,mode:historyMode,focus:focusId(document.activeElement),scroll:main?main.scrollTop:0,offset:historyOffset};
 }
 beginRelatedLookup(r);
 var rid=++releaseLoadToken,account=token,episodeReadSerial=++releaseRequestSerial;
 releaseLoading=true;current=r;
 var cached=titleEpisodeData(r),loaded=null,episodeDone=false,statusDone=!token,favoriteDone=!token,errors=[];
 msg('Проверяю серии и статусы просмотра…');

 function finish(){
  if(rid!==releaseLoadToken||!releaseLoading||!episodeDone||!statusDone||!favoriteDone)return;
  releaseLoading=false;
  if(loaded||cached){
   if(relatedPendingOpen){relatedTrail.push(relatedPendingOpen);if(relatedTrail.length>2)relatedTrail.shift();relatedPendingOpen=null;}
   showRelease(loaded||cached);if(errors.length)msg('Проверка неполная · '+errors.join(' · ')+' · показаны доступные данные');
  }
  else msg('Не удалось загрузить серии: '+errors.join(' · '));
 }

 request(freshAccountPath('/anime/releases/'+encodeURIComponent(r.id||r.alias)),function(full){
  if(rid!==releaseLoadToken||!releaseLoading)return;
  var fresh=full.data||full;
  titlePosterCache[String(r.id||r.alias)]=imageCandidates(fresh);enhanceTitleArtwork(String(r.id||r.alias),fresh);
  if(episodeList(fresh).length){cacheTitleEpisodes(fresh,episodeReadSerial);loaded=titleEpisodeData(fresh);}
  else errors.push('список серий пуст');
  episodeDone=true;finish();
 },function(err){if(rid!==releaseLoadToken||!releaseLoading)return;errors.push('серии: '+err);episodeDone=true;finish();});
 if(token){
  refreshFavoriteIds(function(err){
   if(rid!==releaseLoadToken||!releaseLoading||account!==token)return;
   if(err)errors.push('избранное: '+err);
   favoriteDone=true;finish();
  });
  var url=freshAccountPath('/accounts/users/me/views/timecodes'),serial=accountReadSerial;
  authRequest(url,'GET',null,function(codes){
   if(rid!==releaseLoadToken||!releaseLoading||account!==token)return;
   var fresh=parseRemoteTimecodes(codes);
   if(fresh)publishRemoteTimecodes(fresh,serial);
   else errors.push('неизвестный формат статусов');
   statusDone=true;finish();
  },function(err){if(rid!==releaseLoadToken||!releaseLoading)return;errors.push('статусы: '+err);statusDone=true;finish();});
 }
}
/* Restore navigation after card geometry has been laid out. */
var returnToTitleSerial=0;
function restoreTitleOriginAfterLayout(from){
 var serial=++returnToTitleSerial;
 function applyReturn(){
  /* Do not steal focus if the user has navigated elsewhere meanwhile. */
  if(serial!==returnToTitleSerial||screenName!==from.screen||grid.hidden||playing||releaseLoading)return;
  var main=document.getElementById('scrollMain');
  var matches=Array.prototype.filter.call(document.querySelectorAll('button'),function(b){
   return focusId(b)===from.focus&&!b.disabled&&b.offsetWidth>0&&b.offsetHeight>0;
  });
  var target=matches[0]||null;
  if(!target){
   /* If the release disappeared (for example, the last favorite was removed),
      focus a remaining title; when the section is empty, use its header tab. */
   target=grid.querySelector('.title-card')||document.getElementById(activeNavId(from.screen));
  }
  if(!target)return;
  if(main)scrollFocusTo(main,main.contains(target)?from.scroll:0,true);
  focusAndReveal(target,true);
  /* A second frame accounts for late browser focus scrolling on older Tizen.
     Do not override an intentional subsequent focus change. */
  if(main&&main.contains(target))requestAnimationFrame(function(){
   if(serial===returnToTitleSerial&&screenName===from.screen&&document.activeElement===target){
    ensureFocusVisible(target,true);
   }
  });
 }
 /* Restore after the layout frame and the subsequent geometry update. */
 requestAnimationFrame(function(){requestAnimationFrame(applyReturn);});
}
function backFromRelease(){
 if(relatedTrail.length){
  var frame=relatedTrail[relatedTrail.length-1];
  showRelated({owner:frame.owner,items:frame.items},frame.chosenId,frame.scroll,true);
  return;
 }
 if(!releaseOrigin){latest();return;}
 var from=releaseOrigin;releaseOrigin=null;
 historyOffset=from.offset;
 if(from.screen==='history'){showServerContinue(from.mode,false,true);refreshQuickHistory();}
 else if(from.screen==='catalog'&&catalogSnapshot)renderCatalog(catalogSnapshot);
 else if(from.screen==='favorites'){clear();setScreen('favorites');renderFavorites(false);
  refreshSurfaceTimecodes();refreshFavoriteIds(function(err){if(err)logError('Избранное: возврат',err);});refreshFavoriteTitles();}
 else {latest();return;}
 restoreTitleOriginAfterLayout(from);
}
function episodeList(r){var x=r.episodes||{};return arr(x).length?arr(x):arr(x.list).length?arr(x.list):Array.isArray(x)?x:Object.keys(x).filter(function(k){return /^\d+$/.test(k);}).map(function(k){return x[k];});}
function urls(ep){var h=ep.hls_1080||ep.hls_720||ep.hls_480||ep.hls||ep.video||ep.sources||{};var candidates=[h,ep.hls_1080,ep.hls_720,ep.hls_480,ep.url,ep.src];if(typeof h==='object')candidates.unshift(h.fhd,h.hd,h.sd,h.url,h.src,h[1080],h[720]);return candidates.map(function(v){return typeof v==='string'?v:v&&(v.src||v.url);}).filter(Boolean);}
function episodePreviewCandidates(ep){var p=ep.preview||ep.image||ep.thumbnail||null;return p?imageCandidates({poster:p}):[];}

function releasePlayAction(r){
 var state=titleStatus(r),ep=null,label='';
 if(state.kind==='progress'){
  ep=state.episode;
  label=ep?'▶ Продолжить серию '+episodeNumber(ep)+' · '+stamp(state.pos||0):'Ожидание списка серий…';
 }else if(state.kind==='new'){
  ep=state.nextEpisode;label='▶ Смотреть серию '+episodeNumber(ep);
 }else if(state.kind==='available'){
  ep=state.nextEpisode;label='▶ Смотреть серию '+episodeNumber(ep);
 }else if(state.kind==='complete'){


  var full=titleEpisodeData(r)||r;
  var episodes=episodeList(full).slice().sort(function(a,b){return epNum(a)-epNum(b);});
  ep=episodes.length?episodes[episodes.length-1]:null;
  label=ep?'▶ Пересмотреть серию '+episodeNumber(ep):state.text;
 }
 else label='Ожидание списка серий…';
 return {episode:ep,text:label,kind:state.kind};
}
function episodeNumber(ep){return String(ep.ordinal!=null?ep.ordinal:ep.number!=null?ep.number:'?');}


function episodeFocusId(ep,r,index){
 if(ep&&ep.id!=null)return 'episode-'+String(ep.id);
 if(index==null){
  var ordered=episodeList(r).slice().sort(function(a,b){return epNum(a)-epNum(b);});
  index=ordered.indexOf(ep);
 }
 return index>=0?'episode-index-'+String(index):'';
}
function refreshReleasePrimary(){
 if(screenName!=='release'||!current)return;
 var button=document.getElementById('releasePrimary');if(!button)return;
 var action=releasePlayAction(current),wasFocused=document.activeElement===button;
 if(button.textContent!==action.text)button.textContent=action.text;
 button._playEpisode=action.episode||null;
 button.disabled=!action.episode;
 button.setAttribute('data-state',action.kind);
 if(wasFocused&&button.disabled){
  var first=detail.querySelector('.episode-tile');if(first)focusWithoutBrowserScroll(first);
 }
}
function showRelease(r){
 current=r;
 if(r&&r.id&&episodeList(r).length)cacheTitleEpisodes(r);
 clear();setScreen('release');grid.hidden=true;detail.hidden=false;
 msg('Выбери серию или продолжи просмотр');
 detail.appendChild(node('h1','',title(r)));
 var d=r.description||'';if(typeof d==='object')d=d.plain||d.html||'';
 detail.appendChild(node('p','release-description',String(d).replace(/<[^>]*>/g,'').slice(0,650)));
 var actions=node('div','release-actions release-title-actions');
 var primary=assignFocus(node('button','release-primary',''),'release-primary');primary.id='releasePrimary';
 primary.onclick=function(){if(primary._playEpisode)play(primary._playEpisode,current,focusId(primary));};
 actions.appendChild(primary);
 var fav=assignFocus(node('button','release-favorite',''),'release-favorite');fav.id='releaseFavorite';
 fav.onclick=function(){toggleFavorite(current);};actions.appendChild(fav);
 var related=assignFocus(node('button','release-related','Связанные'),'release-related');
 related.id='releaseRelated';related.hidden=true;related.disabled=true;related.onclick=openRelated;
 actions.appendChild(related);detail.appendChild(actions);refreshReleaseFavorite();refreshReleaseRelatedButton();
 detail.appendChild(node('h2','release-episodes-heading','Серии'));
 var wrap=node('div','episodes'),eps=episodeList(r).slice().sort(function(a,b){return epNum(a)-epNum(b);}),g=titleGroup(r);
 eps.forEach(function(ep,i){
  var b=assignFocus(node('button','episode-tile'),episodeFocusId(ep,r,i));
  var thumb=node('div','episode-thumb'),previews=episodePreviewCandidates(ep);
  attachArtwork(thumb,previews,'Нет кадра',i<8,title(r)+' · Серия '+episodeNumber(ep));
  var name=ep.name||ep.name_russian||ep.name_english||'';
  if(name){var value=typeof name==='string'?name:String(name.main||name.russian||'');if(value)thumb.appendChild(node('div','episode-name',value));}
  b.appendChild(thumb);
  var footer=node('div','episode-footer');
  footer.appendChild(node('span','episode-number','Серия '+episodeNumber(ep)));
  footer.appendChild(node('span','episode-watch',''));
  b.appendChild(footer);
  b._titleEpisode=ep;
  syncEpisodeTile(b,r,ep,g);
  b.onclick=function(){play(ep,r,focusId(b));};b._longPress=function(){openEpisodeActions(r,ep);};wrap.appendChild(b);
 });
 detail.appendChild(wrap);
 if(!eps.length)msg('Не удалось получить список серий. Попробуй открыть тайтл позже.');
 refreshReleasePrimary();


 suppressFocusReveal=true;
 try{
  if(!primary.disabled)focusWithoutBrowserScroll(primary);
  else if(wrap.firstChild)focusWithoutBrowserScroll(wrap.firstChild);
  else focusWithoutBrowserScroll(fav);
 }finally{suppressFocusReveal=false;}
 var main=document.getElementById('scrollMain');
 if(main)scrollFocusTo(main,0,true);
}


var actionDialog=null,actionReturnFocus=null,actionGeneration=0;
function closeActionDialog(){
 if(!actionDialog)return;
 var nodeToRemove=actionDialog;actionDialog=null;nodeToRemove.remove();
 var returnTarget=actionReturnFocus&&document.contains(actionReturnFocus)?actionReturnFocus:null;
 if(!returnTarget)returnTarget=sectionReturnButton()||document.getElementById(activeNavId(screenName));
 if(returnTarget)focusAndReveal(returnTarget,true);
 actionReturnFocus=null;
}
function actionMenu(heading,subtitle){
 closeActionDialog();actionReturnFocus=document.activeElement;
 var overlay=node('div','action-overlay');overlay.id='actionDialog';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 var box=node('div','action-dialog');box.appendChild(node('h2','',heading));box.appendChild(node('p','action-description',subtitle||''));
 overlay.appendChild(box);document.body.appendChild(overlay);actionDialog=overlay;
 return box;
}
function menuAction(box,label,fn,destructive){var b=node('button','action-choice'+(destructive?' danger':''),label);b.onclick=fn;box.appendChild(b);return b;}
function menuClose(box){var b=menuAction(box,'Отмена',closeActionDialog,false);return b;}
function manualStatusRefresh(r){
 invalidateHistoryIndex();refreshVisibleProgressViews();
 if(r&&r.id)refreshTitleCardsForId(r.id);
 if(screenName==='history')setTimeout(function(){if(!actionDialog&&screenName==='history')showServerContinue(historyMode,false,true);},0);
 updateIndicator();
}
function applyManualEpisodes(r,eps,op){
 if(!token){closeActionDialog();promptGuestLogin();return;}
 if(!eps.length){closeActionDialog();msg('Изменения не требуются: все серии уже имеют нужный статус.');return;}

 eps.forEach(function(ep){stageEpisodeMutation(r,ep,op,0,op==='put',false);});
 closeActionDialog();manualStatusRefresh(r);flushMutations();
 msg(op==='delete'?'Отметки сброшены · '+syncSummary():'Просмотр отмечен · '+syncSummary());
}
function openEpisodeActions(r,ep){
 if(playing)return;
 if(!token){promptGuestLogin();return;}
 var v=titleEpisodeRecord(r,ep,titleGroup(r));
 var box=actionMenu('Серия '+episodeNumber(ep),v.watched?'Просмотрено':v.pos>0?'Недосмотрена · '+stamp(v.pos):'Не просмотрена');
 var first=null;
 if(!v.watched)first=menuAction(box,'Отметить просмотренной',function(){applyManualEpisodes(r,[ep],'put');},false);
 if(v.watched||v.pos>0||(mutations[String(ep.id)]&&mutations[String(ep.id)].op==='put')){var reset=menuAction(box,'Сбросить просмотр',function(){applyManualEpisodes(r,[ep],'delete');},true);if(!first)first=reset;}
 var cancel=menuClose(box);focusWithoutBrowserScroll(first||cancel);
}
function openTitleActions(r){
 if(playing)return;
 if(!token){promptGuestLogin();return;}
 var generation=++actionGeneration,episodeReadSerial=++releaseRequestSerial;
 var box=actionMenu(title(r),'Проверяю актуальный список серий…');
 var cancel=menuClose(box);focusWithoutBrowserScroll(cancel);
 request('/anime/releases/'+encodeURIComponent(r.id||r.alias),function(reply){
  if(generation!==actionGeneration||!actionDialog||!box.isConnected)return;
  var full=reply.data||reply,eps=episodeList(full).slice().sort(function(a,b){return epNum(a)-epNum(b);});
  if(!eps.length){box.querySelector('.action-description').textContent='Сервер не предоставил полный список эпизодов. Изменение всего тайтла недоступно.';return;}
  cacheTitleEpisodes(full,episodeReadSerial);
  box.querySelector('.action-description').textContent='Доступно серий: '+eps.length+' · изменения будут отправлены на сайт';
  var first=menuAction(box,'Отметить все серии просмотренными',function(){if(confirm('Отметить все '+eps.length+' доступных серий просмотренными?'))applyManualEpisodes(full,eps.filter(function(ep){return !titleEpisodeRecord(full,ep,titleGroup(full)).watched;}),'put');});
  menuAction(box,'Сбросить просмотр всего тайтла',function(){if(confirm('Сбросить просмотр всех '+eps.length+' доступных серий? Тайтл исчезнет из истории, если других отметок нет.'))applyManualEpisodes(full,eps.filter(function(ep){var v=titleEpisodeRecord(full,ep,titleGroup(full));return v.watched||v.pos>0||(mutations[String(ep.id)]&&mutations[String(ep.id)].op==='put');}),'delete');},true);

  box.appendChild(cancel);focusWithoutBrowserScroll(first);
 },function(err){if(generation!==actionGeneration||!actionDialog||!box.isConnected)return;box.querySelector('.action-description').textContent='Не удалось проверить список серий: '+err+'. Массовое изменение не выполнено.';});
}

var okHold=null,OK_HOLD_MS=800;
function beginCardOK(e){
 if(okHold){e.preventDefault();return true;}
 var target=document.activeElement;
 if(!target||typeof target._longPress!=='function'||playing||actionDialog)return false;
 okHold={target:target,held:false,timer:setTimeout(function(){
  if(okHold&&okHold.target===target&&!playing&&!actionDialog){okHold.held=true;target._longPress();}
 },OK_HOLD_MS)};
 e.preventDefault();return true;
}
function releaseCardOK(e){
 if(!okHold)return false;
 var h=okHold;okHold=null;clearTimeout(h.timer);e.preventDefault();
 if(!h.held&&document.contains(h.target)&&!actionDialog)h.target.click();
 return true;
}
function cancelCardOK(){if(okHold){clearTimeout(okHold.timer);okHold=null;}}
function play(ep,r,entryFocusId){current=r;window._lastEpisode=ep;skipRanges={opening:ep.opening||null,ending:ep.ending||null};seekPreview=null;clearTimeout(seekHoldTimer);seekHoldDirection=0;seekHoldActivated=false;seekStepSeconds=0;
lastPlaybackPosition=null;lastPlaybackClock=0;completedThisPlayback=false;seekGraceUntil=Date.now()+2500;
var u=urls(ep)[0];if(!u){msg('У серии нет распознанного HLS-адреса.');return;}if(u.indexOf('//')===0)u='https:'+u;


playbackReturn={screen:screenName,releaseId:String(r.id!=null?r.id:r.alias),
 focusId:entryFocusId||episodeFocusId(ep,r),episodeFocus:episodeFocusId(ep,r)};
cancelFocusScroll();
activeEpisode=storeKey(r,ep);paused=false;lastSave=0;resumePending=false;resumeFailed=false;resumeTarget=0;resumeAttempts=0;resumeConfirmed=false;resumeSeekInFlight=false;resumeLastSeek=0;resumeLastError="";resumeStarted=Date.now();var playbackState=token&&ep.id?titleEpisodeRecord(r,ep,titleGroup(r)):null;if(playbackState&&!playbackState.watched&&playbackState.pos>5000){resumeTarget=playbackState.pos;resumePending=true;}player.hidden=false;document.body.classList.add("video-playing");playing=true;showOverlay();clearInterval(uiTicker);uiTicker=setInterval(updateProgress,1000);updateProgress();document.getElementById('playingTitle').textContent=title(r)+' · серия '+(ep.ordinal||ep.number||'');try{if(window.webapis&&webapis.avplay){webapis.avplay.open(u);setDiagnosticRect();webapis.avplay.setListener({onerror:function(e){stop();msg('Ошибка AVPlay: '+e);},onstreamcompleted:function(){markEpisodeWatched('avplay-complete');stop();},oncurrentplaytime:function(){if(resumePending)tryRestoreProgress();}});webapis.avplay.prepareAsync(function(){webapis.avplay.play();tryRestoreProgress();},function(e){stop();msg('Не удалось подготовить видео: '+e);});}else{video=document.createElement('video');video.src=u;video.autoplay=true;video.controls=true;video.style.cssText='width:100%;height:100%';document.getElementById('videoArea').appendChild(video);video.play();video.addEventListener('loadedmetadata',tryRestoreProgress);video.addEventListener('ended',function(){markEpisodeWatched('html5-ended');stop();});}}catch(e){stop();msg('Ошибка плеера: '+e.message);}}
function tryRestoreProgress(){
 if(!resumePending||!playing)return;
 try{
  var d=duration(),now=position(),elapsed=Date.now()-resumeStarted;
  if(d>0&&resumeTarget>=d-3000){resumePending=false;return;}

  if(resumeAttempts>0&&Math.abs(now-resumeTarget)<=2500){
   resumeConfirmed=true;resumePending=false;resumeSeekInFlight=false;updateProgress();return;
  }
  if(elapsed>8000||resumeAttempts>=16){
   resumePending=false;resumeFailed=true;resumeSeekInFlight=false;
   msg('Не удалось восстановить позицию ('+stamp(resumeTarget)+'). Сохранённый прогресс оставлен.');

   lastSave=Date.now()+60000;
   return;
  }
  if(!video&&(!av()||webapis.avplay.getState()!=='PLAYING'))return;
  if(video&&video.readyState<1)return;
  if(resumeSeekInFlight&&Date.now()-resumeLastSeek<2200)return;
  if(Date.now()-resumeLastSeek<1500)return;
  resumeSeekInFlight=true;resumeAttempts++;resumeLastSeek=Date.now();
  if(video){video.currentTime=resumeTarget/1000;resumeSeekInFlight=false;}
  else webapis.avplay.seekTo(Math.floor(resumeTarget),function(){

   resumeSeekInFlight=false;
  },function(e){resumeLastError=String(e);resumeSeekInFlight=false;});
 }catch(e){resumeLastError=String(e);resumeSeekInFlight=false;}
}
function refreshAfterPlayback(){
 refreshVisibleTitleCards();

 if(screenName==='release'&&current){refreshVisibleEpisodeTiles();refreshReleasePrimary();if(token)refreshFavoriteIds();return;}
 if(screenName==='history'&&!grid.hidden){showServerContinue(historyMode,false,true);}
}
function stop(){if(!playing)return;var destination=playbackReturn;playbackReturn=null;finishSeekPreview();var wasRestoring=resumePending;if(wasRestoring){resumePending=false;}if(!wasRestoring)saveProgress(true);flushMutations();clearInterval(uiTicker);uiTicker=null;clearTimeout(overlayTimer);hideOverlay();activeEpisode=null;try{if(window.webapis&&webapis.avplay){webapis.avplay.stop();webapis.avplay.close();}}catch(e){}if(video){video.pause();video.remove();video=null;}playing=false;paused=false;player.hidden=true;document.body.classList.remove("video-playing");refreshAfterPlayback();


 if(destination&&destination.screen==='release'&&screenName==='release'&&current&&
    String(current.id!=null?current.id:current.alias)===destination.releaseId){
  var choices=detail.querySelectorAll('button'),target=null,episodeTile=null;
  for(var i=0;i<choices.length;i++){
   if(focusId(choices[i])===destination.focusId)target=choices[i];
   if(focusId(choices[i])===destination.episodeFocus)episodeTile=choices[i];
  }
  if(focusAndReveal(target,true)||focusAndReveal(episodeTile,true))return;
 }
 restoreFocus();}
function normalizedSkip(t,d){if(!t||!isFinite(Number(t.start))||!isFinite(Number(t.stop)))return null;var a=Number(t.start),b=Number(t.stop);if(a<0&&d>0)a=d/1000+a;if(b<0&&d>0)b=d/1000+b;return a>=0&&b>a&&(!d||b<=d/1000+1)?{start:a*1000,stop:b*1000}:null;}
function updateSkipButton(p,d){var btn=document.getElementById('skipButton');if(!btn)return;var match=null,label='';if(skipRanges){['opening','ending'].forEach(function(type){var range=normalizedSkip(skipRanges[type],d);if(range&&p>=range.start&&p<range.stop){match=range;label=type==='opening'?'Пропустить опенинг':'Пропустить эндинг';}});}btn.hidden=!match;btn.textContent=label;btn.dataset.target=match?String(Math.max(match.start,match.stop-2000)):'';skipLabel=label;}
function jumpTo(ms){seekGraceUntil=Date.now()+2500;lastPlaybackPosition=null;lastPlaybackClock=0;var d=duration();var target=Math.max(0,Math.min(d>0?d-1000:Infinity,ms));try{if(video)video.currentTime=target/1000;else if(av())webapis.avplay.seekTo(Math.floor(target));}catch(e){logError('Перемотка',e);}}
function seekStep(dir){var held=Date.now()-seekHoldStart;var step=held<3000?10000:held<5000?30000:held<15000?60000:120000;var base=seekPreview===null?position():seekPreview;var d=duration();seekPreview=Math.max(0,Math.min(d>0?d-1000:Infinity,base+dir*step));seekStepSeconds=step/1000;showOverlay();updateProgress();}
function updateSkipMarkers(d){var track=document.getElementById('progressTrack');if(!track)return;['opening','ending'].forEach(function(type){var marker=document.getElementById('skipMarker_'+type);if(!marker){marker=document.createElement('div');marker.id='skipMarker_'+type;marker.className='skip-marker';track.appendChild(marker);}var r=skipRanges&&normalizedSkip(skipRanges[type],d);marker.style.display=r&&d>0?'block':'none';if(r&&d>0){marker.style.left=(100*r.start/d)+'%';marker.style.width=(100*(r.stop-r.start)/d)+'%';}});}
function skipTargetAt(p){var d=duration();if(!skipRanges)return null;for(var i=0;i<2;i++){var type=i===0?'opening':'ending';var r=normalizedSkip(skipRanges[type],d);if(r&&p>=r.start&&p<r.stop-2000)return Math.max(r.start,r.stop-2000);}return null;}
function startSeekHold(dir){
 if(seekHoldDirection!==dir){finishSeekPreview();seekHoldDirection=dir;seekHoldStart=Date.now();seekHoldActivated=false;}
 seekLastKey=Date.now();
 if(!seekHoldTimer){seekHoldTimer=setTimeout(function tick(){if(!seekHoldDirection)return;if(Date.now()-seekLastKey>800){finishSeekPreview();return;}seekHoldActivated=true;seekStep(seekHoldDirection);seekHoldTimer=setTimeout(tick,350);},350);}
}
function finishSeekPreview(){var dir=seekHoldDirection,wasHeld=seekHoldActivated;clearTimeout(seekHoldTimer);seekHoldTimer=null;seekHoldDirection=0;seekHoldActivated=false;seekStepSeconds=0;renderPlaybackStatus();if(seekPreview!==null){var target=seekPreview;seekPreview=null;jumpTo(target);}else if(dir&&!wasHeld){var targetSkip=dir>0?skipTargetAt(position()):null;if(targetSkip!==null)jumpTo(targetSkip);else jumpTo(position()+dir*10000);showOverlay();}}

var focusScrollFrame=0,focusScrollDestination=null,focusScrollLastTime=0;
var suppressFocusReveal=false;
function cancelFocusScroll(){
 if(focusScrollFrame)cancelAnimationFrame(focusScrollFrame);
 focusScrollFrame=0;focusScrollLastTime=0;focusScrollDestination=null;
}
function scrollFocusTo(main,destination,immediate){
 var max=Math.max(0,main.scrollHeight-main.clientHeight);
 focusScrollDestination=Math.max(0,Math.min(max,destination));
 if(immediate){cancelFocusScroll();main.scrollTop=Math.max(0,Math.min(max,destination));return;}
 if(focusScrollFrame)return;
 function frame(now){
  var dt=focusScrollLastTime?Math.min(50,now-focusScrollLastTime):16;
  focusScrollLastTime=now;
  var distance=focusScrollDestination-main.scrollTop;
  if(Math.abs(distance)<1){main.scrollTop=focusScrollDestination;focusScrollFrame=0;focusScrollLastTime=0;return;}

  var advance=Math.sign(distance)*Math.min(Math.abs(distance),Math.max(1,dt*1.9));
  main.scrollTop+=advance;
  focusScrollFrame=requestAnimationFrame(frame);
 }
 focusScrollFrame=requestAnimationFrame(frame);
}
function focusWithoutBrowserScroll(el){
 try{el.focus({preventScroll:true});}catch(e){el.focus();}
}
function ensureFocusVisible(el,immediate){
 var main=document.getElementById('scrollMain');
 if(!main||!el||playing)return;
 var header=document.querySelector('header');
 if(header&&header.contains(el)){cancelFocusScroll();return;}
 if(!main.contains(el))return;

 if(immediate)cancelFocusScroll();
 var r=el.getBoundingClientRect(),box=main.getBoundingClientRect();
 var base=main.scrollTop;
 var top=r.top-box.top+base,bottom=r.bottom-box.top+base;
 var target=focusScrollDestination===null?base:focusScrollDestination;
 var margin=24,viewHeight=main.clientHeight;
 if(top<target+margin)target=top-margin;
 else if(bottom>target+viewHeight-margin)target=bottom-viewHeight+margin;
 var first=main.querySelector('.episode-tile, #grid .card');
 if(first===el)target=0;
 scrollFocusTo(main,target,!!immediate);
}


var navHoldKey=0,navHoldTimer=null,navHoldInterval=null;
function stopNavHold(){
 if(navHoldTimer)clearTimeout(navHoldTimer);
 if(navHoldInterval)clearInterval(navHoldInterval);
 navHoldTimer=null;navHoldInterval=null;navHoldKey=0;
}
function pageMoveFocus(k){
 if(playing||loginDialog||actionDialog||releaseLoading||!startupSyncDone)return;
 var main=document.getElementById('scrollMain'),active=document.activeElement;
 if(!main||!main.contains(active))return;
 var from=active.getBoundingClientRect();
 var cx=(from.left+from.right)/2,cy=(from.top+from.bottom)/2;
 var direction=k===38?-1:1,step=Math.max(120,main.clientHeight-110);
 var pool=contentButtons().filter(function(b){
  return b!==active&&focusId(b)!=='history-more'&&main.contains(b);
 });
 var best=null,bestScore=Infinity;
 pool.forEach(function(b){
  var r=b.getBoundingClientRect(),y=(r.top+r.bottom)/2,delta=(y-cy)*direction;
  if(delta<10)return;
  var x=(r.left+r.right)/2;

  var score=Math.abs(delta-step)+Math.abs(x-cx)*0.65;
  if(score<bestScore){bestScore=score;best=b;}
 });
 if(best)focusAndReveal(best,true);
}
function armNavHold(k){
 if(navHoldKey===k)return;
 stopNavHold();navHoldKey=k;
 navHoldTimer=setTimeout(function(){
  navHoldTimer=null;
  if(navHoldKey!==k)return;
  pageMoveFocus(k);
  navHoldInterval=setInterval(function(){if(navHoldKey===k)pageMoveFocus(k);},450);
 },700);
}
function key(e){var k=e.keyCode;
 if(k!==38&&k!==40&&navHoldKey)stopNavHold();
 if(loginDialog){
  if((k===10009||k===27)&&!loginInFlight){closeLoginDialog();e.preventDefault();return;}
  var controls=Array.prototype.slice.call(loginDialog.querySelectorAll('input,button')).filter(function(el){return !el.disabled;});
  var active=document.activeElement,idx=controls.indexOf(active);
  if(k===38||k===40){if(controls.length){focusWithoutBrowserScroll(controls[Math.max(0,Math.min(controls.length-1,idx+(k===38?-1:1)))]);}e.preventDefault();return;}

  if(k===37||k===39)return;
  if(k===13&&active&&active.tagName==='INPUT'){
   if(active.id==='loginUsername')focusWithoutBrowserScroll(loginDialog.querySelector('#loginPassword'));
   else loginDialog.querySelector('.login-dialog').requestSubmit?loginDialog.querySelector('.login-dialog').requestSubmit():loginDialog.querySelector('.login-submit').click();
   e.preventDefault();return;
  }
  return;
 }
 if(!playing&&!startupSyncDone){e.preventDefault();return;}
 if(!playing&&releaseLoading){
  if(k===10009||k===27){
   releaseLoadToken++;releaseLoading=false;++relatedLookupSerial;
   if(relatedPendingOpen){relatedPendingOpen=null;current=relatedScreen&&relatedScreen.owner||current;}
   else releaseOrigin=null;
   msg('Проверка тайтла отменена');
  }
  e.preventDefault();return;
 }
 if(!playing&&actionDialog&&(k===10009||k===27)){closeActionDialog();e.preventDefault();return;}
 if(!playing&&!actionDialog&&k===13&&beginCardOK(e))return;
 if(playing){if(k===38||k===40){showOverlay();e.preventDefault();return;}if(k===10009||k===27||k===413){stop();e.preventDefault();}
 else if(k===13||k===10252){var sb=document.getElementById('skipButton');if(k===13&&sb&&!sb.hidden&&sb.dataset.target){finishSeekPreview();jumpTo(Number(sb.dataset.target));sb.hidden=true;}else togglePause();showOverlay();e.preventDefault();}
 else if(k===415){if(paused)togglePause();showOverlay();e.preventDefault();}
 else if(k===19){if(!paused)togglePause();showOverlay();e.preventDefault();}
 else if(k===37||k===39){startSeekHold(k===37?-1:1);e.preventDefault();}
 return;}
 if(k===10009||k===27){if(screenName==='release'){backFromRelease();}else if(screenName==='related'){backFromRelated();}else if(screenName==='favorites'){latest();}else if(!detail.hidden){clear();latest();}else try{tizen.application.getCurrentApplication().exit();}catch(x){}e.preventDefault();return;}
 if(k===37||k===38||k===39||k===40){

  if((k===38||k===40)&&navHoldKey===k){e.preventDefault();return;}
  if((k===38||k===40)&&!actionDialog&&document.getElementById('scrollMain').contains(document.activeElement))armNavHold(k);
  var els=Array.prototype.slice.call((actionDialog||document).querySelectorAll('button')).filter(function(x){return !x.disabled&&x.offsetWidth>0&&x.offsetHeight>0;});
  var active=document.activeElement,header=document.querySelector('header'),main=document.getElementById('scrollMain');
  if(els.indexOf(active)<0){if(els.length)focusAndReveal(firstContentButton(contentButtons())||els[0],true);e.preventDefault();return;}
  var inHeader=!!(header&&header.contains(active)),inContent=!!(main&&main.contains(active));
  var direction=k===37?'left':k===38?'up':k===39?'right':'down';


  if(!actionDialog&&inHeader){
   if(k===40){var resume=sectionReturnButton();if(resume)focusAndReveal(resume,true);e.preventDefault();return;}
   if(k===38){e.preventDefault();return;}
  }

  if((k===37||k===39)&&active.getAttribute('data-nav-axis')==='vertical'){e.preventDefault();return;}
  var routeId=active.getAttribute('data-nav-'+direction),routed=null;
  if(routeId)routed=els.filter(function(b){return focusId(b)===routeId;})[0];
  if(routed){focusAndReveal(routed,true);e.preventDefault();return;}


  var pool=els;
  if(!actionDialog&&inHeader)pool=els.filter(function(b){return header.contains(b);});
  else if(!actionDialog&&inContent)pool=els.filter(function(b){return main.contains(b);});
  var from=active.getBoundingClientRect(),cx=(from.left+from.right)/2,cy=(from.top+from.bottom)/2,best=null,bestScore=Infinity;
  pool.forEach(function(el){if(el===active)return;var r=el.getBoundingClientRect(),dx=(r.left+r.right)/2-cx,dy=(r.top+r.bottom)/2-cy;
   var along=k===37?-dx:k===39?dx:k===38?-dy:dy;
   if(along<=2)return;
   var across=k===37||k===39?Math.abs(dy):Math.abs(dx);
   var score=along+across*3;
   if(score<bestScore){bestScore=score;best=el;}
  });
  if(best)focusAndReveal(best);
  else if(!actionDialog&&inContent&&k===38){


   var owner=document.getElementById(activeNavId(screenName));
   if(owner)focusAndReveal(owner,true);
  }
  e.preventDefault();

 }}
 document.addEventListener('focusin',function(e){if(e.target&&e.target.tagName==='BUTTON'&&!(actionDialog&&actionDialog.contains(e.target))){rememberFocus();if(!suppressFocusReveal)ensureFocusVisible(e.target);}});
 document.getElementById('latest').onclick=latest;document.getElementById('continueBtn').onclick=showContinue;document.getElementById('historyBtn').onclick=showHistory;document.getElementById('favoritesBtn').onclick=showFavorites;document.getElementById('accountBtn').onclick=showAccount;document.addEventListener('keydown',key);document.addEventListener('keyup',function(e){if((e.keyCode===38||e.keyCode===40)&&navHoldKey===e.keyCode)stopNavHold();if(e.keyCode===13&&releaseCardOK(e))return;if(playing&&(e.keyCode===37||e.keyCode===39))finishSeekPreview();});document.addEventListener('blur',function(){cancelCardOK();stopNavHold();});registerMediaKeys();if(!token)eraseLocalViewingData();try{localStorage.removeItem(CACHE_KEY);}catch(e){}beginStartupSync();focusWithoutBrowserScroll(document.getElementById('latest'));latest();updateIndicator();if(token){setTimeout(function(){startBackgroundHistory();},100);}
})();
