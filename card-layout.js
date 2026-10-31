(function(){
 'use strict';
 var grid=document.getElementById('grid'),detail=document.getElementById('detail');
 if(!grid||!detail)return;
 var scheduled=false;

 function sizeCards(selector,root,ratio,footerHeight){
  var cards=root.querySelectorAll(selector);
  if(!cards.length)return;
  var width=cards[0].getBoundingClientRect().width;
  if(width<1)return;
  var height=(width*ratio+footerHeight).toFixed(3)+'px';
  for(var i=0;i<cards.length;i++){
   if(cards[i].style.height!==height)cards[i].style.height=height;
  }
 }
 function apply(){
  scheduled=false;
  if(!detail.hidden&&detail.querySelector('.episode-tile'))
   sizeCards('.episode-tile',detail,9/16,48);
  else if(!grid.hidden)
   sizeCards('.title-card',grid,3/2,50);
 }
 function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(apply);
 }
 if(typeof MutationObserver==='function'){
  var observer=new MutationObserver(schedule);
  observer.observe(grid,{childList:true,attributes:true,attributeFilter:['hidden']});
  observer.observe(detail,{childList:true,attributes:true,attributeFilter:['hidden']});
 }
 window.addEventListener('resize',schedule);
 schedule();
})();
