/* AniLiberty TV: Smart Hub Preview background service (Tizen Web Service / Node.js).
   Only public catalog data is fetched. No account tokens are read or transmitted. */
'use strict';
var https = require('https');
var SERVICE_MIN_UPDATE_MS = 10 * 60 * 1000;
var STAMP_FILE = 'aniliberty-preview-timestamp.json';
var CATALOG_PATH = '/api/v1/anime/releases/latest?limit=49';
var HOSTS = ['api.anilibria.app', 'aniliberty.top'];
var busy = false;

function exit() {
 try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* ignore */ }
}
function log(message) {
 try { console.log('[AniLiberty Smart Hub] ' + String(message)); } catch (e) { /* ignore */ }
}
function listOf(data) {
 if (Array.isArray(data)) return data;
 if (data && Array.isArray(data.data)) return data.data;
 if (data && Array.isArray(data.items)) return data.items;
 return [];
}
function titleOf(release) {
 var name = release && release.name;
 return String((name && (name.main || name.russian || name.english)) ||
   (release && (release.title || release.name_ru)) || ('Релиз ' + release.id));
}
function posterOf(release) {
 var p = (release && (release.poster || release.posters)) || {};
 var choices = [];
 function add(value) {
  if (!value) return;
  if (typeof value === 'object') {
   add(value.preview); add(value.thumbnail); add(value.main);
   add(value.src); add(value.url); add(value.original);
   return;
  }
  if (typeof value !== 'string') return;
  if (value.indexOf('//') === 0) value = 'https:' + value;
  else if (value.charAt(0) === '/') value = 'https://aniliberty.top' + value;
  if (!/^https:\/\//i.test(value) || /\.(?:webp|avif|gif|svg)(?:[?#]|$)/i.test(value)) return;
  if (choices.indexOf(value) < 0) choices.push(value);
 }
 if (p.optimized) { add(p.optimized.preview); add(p.optimized.thumbnail); }
 add(p.preview); add(p.thumbnail); add(p.main);
 if (p.optimized) add(p.optimized.main);
 add(p.original); add(p.src); add(p.url);
 if (typeof p === 'string') add(p);
 add(release && release.image);
 return choices[0] || '';
}
function makePreview(data) {
 var releases = listOf(data), tiles = [], seen = Object.create(null);
 for (var i = 0; i < releases.length && tiles.length < 40; i++) {
  var release = releases[i] || {}, id = String(release.id || '');
  if (!/^\d{1,12}$/.test(id) || id === '0' || seen[id]) continue;
  var image = posterOf(release);
  if (!image) continue;
  seen[id] = true;
  tiles.push({
   title: titleOf(release),
   image_url: image,
   image_ratio: '2by3',
   action_data: JSON.stringify({releaseId:Number(id)}),
   is_playable: false,
   position: tiles.length + 1
  });
 }
 return {sections: [{title: 'Новинки', position: 1, tiles: tiles}]};
}
function fetchCatalog(hostIndex, done) {
 if (hostIndex >= HOSTS.length) { done(new Error('Все источники новинок недоступны')); return; }
 var host = HOSTS[hostIndex], buffer = '', complete = false;
 function fallback(error) {
  if (complete) return;
  complete = true;
  log(host + ': ' + String(error && error.message || error));
  fetchCatalog(hostIndex + 1, done);
 }
 var req;
 try {
  req = https.get({hostname:host, port:443, path:CATALOG_PATH, method:'GET',
     headers:{'Accept':'application/json', 'User-Agent':'AniLiberty-TV-SmartHub/1.0.7'}},
   function(res) {
    if (res.statusCode !== 200) { res.resume(); fallback(new Error('HTTP '+res.statusCode)); return; }
    res.setEncoding('utf8');
    res.on('data',function(chunk){
     buffer += chunk;
     if (buffer.length > 1500000) { req.destroy(); fallback(new Error('JSON слишком большой')); }
    });
    res.on('end',function(){
     if (complete) return;
     try {
      var data = JSON.parse(buffer), preview = makePreview(data);
      if (!preview.sections[0].tiles.length) throw new Error('Нет изображений новинок');
      complete = true; done(null,preview);
     } catch (e) { fallback(e); }
    });
    res.on('error',fallback);
   });
  req.setTimeout(8000,function(){req.destroy();fallback(new Error('Таймаут'));});
  req.on('error',fallback);
 } catch (e) { fallback(e); }
}
function readStamp(done) {
 try {
  tizen.filesystem.resolve('wgt-private',function(dir){
   var file;
   try { file=dir.resolve(STAMP_FILE); } catch(e) {done(0);return;}
   file.openStream('r',function(stream){
    var raw='';try {raw=stream.read(stream.bytesAvailable);}catch(e){}
    try {stream.close();}catch(e){}
    var timestamp=Number(raw);
    done(isFinite(timestamp)?timestamp:0);
   },function(){done(0);});
  },function(){done(0);},'rw');
 } catch(e) {done(0);}
}
function writeStamp(done) {
 try {
  tizen.filesystem.resolve('wgt-private',function(dir){
   var file;
   try {file=dir.resolve(STAMP_FILE);}catch(e){
    try{file=dir.createFile(STAMP_FILE);}catch(x){done();return;}
   }
   file.openStream('w',function(stream){
    try{stream.write(String(Date.now()));stream.close();}catch(e){}
    done();
   },done);
  },done,'rw');
 }catch(e){done();}
}
function update() {
 if (busy) return;
 busy=true;
 readStamp(function(last){
  if (last && Date.now()-last < SERVICE_MIN_UPDATE_MS) {busy=false;exit();return;}
  fetchCatalog(0,function(error,preview){
   if (error) {log(error.message);busy=false;exit();return;}
   try {
    if (!webapis || !webapis.preview || !webapis.preview.setPreviewData) {
     throw new Error('Preview API недоступен');
    }
    webapis.preview.setPreviewData(JSON.stringify(preview),function(){
     writeStamp(function(){busy=false;exit();});
    },function(e){log('setPreviewData: '+String(e&&e.message||e));busy=false;exit();});
   }catch(e){log(e.message);busy=false;exit();}
  });
 });
}
module.exports.onStart=function(){};
module.exports.onRequest=function(){update();};
module.exports.onExit=function(){};
/* Export pure helpers for deterministic tests on a development machine. */
module.exports._test={makePreview:makePreview,posterOf:posterOf};
