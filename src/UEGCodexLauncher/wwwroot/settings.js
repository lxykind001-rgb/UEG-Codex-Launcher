(() => {
  const token=location.hash.slice(1), el=id=>document.getElementById(id);
  const labels={name:'姓名',en:'英文姓名',id:'证件编号',post:'职务 / 单位',issuer:'签发机构',level:'授权等级',valid:'有效期',scope:'许可范围',bio:'生物特征'};
  const form=el('card-form'), prefs=el('preferences'), choice=el('profile-select');
  let email='',photo='',busy=false,showEmail=false;
  for(const [key,title] of Object.entries(labels)){
    const label=document.createElement('label'),input=document.createElement('input');
    input.name=key;input.maxLength=key==='name'?80:180;input.placeholder='留空使用默认值';
    label.append(title,input);el('card-inputs').append(label);
  }
  async function api(route,body){
    const response=await fetch('/api'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
      .catch(()=>{throw Error('设置面板已断开，请从 UEG 插件重新打开。');});
    if(response.status===403)throw Error('设置面板已失效，请从 UEG 插件重新打开。');
    const data=await response.json();if(!response.ok)throw Error(data.error||'保存失败');return data;
  }
  function lock(value){
    el('card-fields').disabled=value||!email;el('save-card').disabled=value||!email;el('reload').disabled=value;
    choice.disabled=value||!email;el('save-selection').disabled=value||!email;
    el('reset-card').disabled=value||!email||!choice.value;
  }
  function displayEmail(){el('bound-account').textContent=email?(showEmail?email:email[0]+'***'):'未绑定';el('reveal-email').disabled=!email;el('reveal-email').textContent=showEmail?'隐藏完整邮箱':'显示完整邮箱';}
  function showAnimations(data,selected){
    const list=prefs.elements.namedItem('animation');list.replaceChildren(new Option('UEG 原版','ueg'));
    for(const item of data.animations||[])list.add(new Option(item.id+' · 静态按钮 '+item.buttonCount+' 个',item.id));
    list.value=[...list.options].some(option=>option.value===selected)?selected:'ueg';
    el('animation-folder').textContent=data.animationFolder||'';
    if(list.value!==selected)el('preferences-status').textContent='所选动画文件缺失，本次使用 UEG。';
  }
  async function load(){
    if(busy)return;busy=true;email='';lock(true);el('bound-account').textContent='正在读取…';
    try{
      const data=await api('');email=data.email||'';photo=data.card.photo||'';showEmail=false;displayEmail();
      el('identity-status').textContent=data.message;form.elements.namedItem('label').value=data.card.label||'';
      for(const key of Object.keys(labels))form.elements.namedItem(key).value=data.card[key]||'';
      el('card-photo').value='';el('card-status').textContent=photo?'已设置头像':'';
      prefs.elements.namedItem('display').value=data.preferences.display;prefs.elements.namedItem('language').value=data.preferences.language;
      showAnimations(data,data.preferences.animation);
      prefs.querySelector('button').disabled=false;
      choice.replaceChildren(new Option('自动跟随当前邮箱',''));
      for(const profile of data.profiles||[])choice.add(new Option(profile.label+' · '+profile.emailHint,profile.key));
      choice.value=data.nextCardKey||'';el('reset-confirm').hidden=true;
    }catch(e){el('identity-status').textContent=e.message;el('bound-account').textContent='无法读取';choice.replaceChildren(new Option('自动跟随当前邮箱',''));}
    finally{busy=false;lock(false);}
  }
  prefs.onsubmit=async event=>{
    event.preventDefault();const button=prefs.querySelector('button');button.disabled=true;
    try{await api('/preferences',{display:prefs.elements.namedItem('display').value,language:prefs.elements.namedItem('language').value,animation:prefs.elements.namedItem('animation').value});el('preferences-status').textContent='已保存，下次启动生效。';}
    catch(e){el('preferences-status').textContent=e.message;}finally{button.disabled=false;}
  };
  el('reveal-email').onclick=()=>{showEmail=!showEmail;displayEmail();};
  el('scan-animations').onclick=async()=>{
    try{const selected=prefs.elements.namedItem('animation').value;showAnimations(await api('/animations'),selected);el('preferences-status').textContent='扫描完成；选择动画后保存启动设置。';}
    catch(e){el('preferences-status').textContent=e.message;}
  };
  el('reload').onclick=load;
  el('clear-photo').onclick=()=>{photo='';el('card-photo').value='';el('card-status').textContent='保存后移除头像';};
  choice.onchange=()=>{el('reset-card').disabled=!email||!choice.value;el('reset-confirm').hidden=true;};
  el('card-switch').onsubmit=async event=>{
    event.preventDefault();if(!email)return;el('save-selection').disabled=true;
    try{await api('/selection',{email,key:choice.value});el('selection-status').textContent=choice.value?'已指定下次启动的身份卡。':'已恢复自动跟随邮箱。';}
    catch(e){el('selection-status').textContent=e.message;}finally{el('save-selection').disabled=false;}
  };
  el('reset-card').onclick=()=>{if(!choice.value)return;el('reset-question').textContent='确定重置“'+choice.selectedOptions[0].textContent+'”？这会删除该卡的自填资料和头像，其他身份卡不变。';el('reset-confirm').hidden=false;};
  el('cancel-reset').onclick=()=>{el('reset-confirm').hidden=true;};
  el('confirm-reset').onclick=async()=>{
    if(!email||!choice.value)return;const key=choice.value;el('confirm-reset').disabled=true;
    try{await api('/reset',{email,key});await load();el('selection-status').textContent='已重置所选身份卡，其他身份卡不变。';}
    catch(e){el('selection-status').textContent=e.message;}finally{el('confirm-reset').disabled=false;el('reset-confirm').hidden=true;}
  };
  const readPhoto=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});
  async function cardDraft(){
    const file=el('card-photo').files[0];let image=photo;
    if(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>400000)throw Error('请选择 400 KB 以内的 PNG、JPEG 或 WebP 图片');image=await readPhoto(file);}
    const card={photo:image,label:form.elements.namedItem('label').value.trim()};
    for(const key of Object.keys(labels))card[key]=form.elements.namedItem(key).value.trim();
    return card;
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!email)return;busy=true;lock(true);
    try{const card=await cardDraft();await api('/card',{email,card});busy=false;await load();el('card-status').textContent='已保存到此邮箱，下次启动生效。';}
    catch(e){el('card-status').textContent=e.message;}finally{busy=false;lock(false);}
  };
  el('preview-card').onclick=async()=>{
    try{
      const card=email?await cardDraft():{},en=prefs.elements.namedItem('language').value==='en';
      const defaults=en?{name:'Liu Peiqiang',id:'Generated at launch',issuer:'UEG · Identity Bureau',level:'LEVEL 3 · Habitat access',valid:'This session · Until sign-out',scope:'550C · Read-only access',bio:'Iris · Fingerprint'}
        :{name:'刘培强',id:'启动时生成',issuer:'UEG 联合政府 · 身份管理局',level:'LEVEL 3 · 生活区通行',valid:'本次会话 · 随登出失效',scope:'550C 终端 · 只读查询',bio:'虹膜 · 指纹'};
      el('preview-name').textContent=(en&&card.en)||card.name||defaults.name;
      el('preview-subtitle').textContent=[card.en,card.post].filter(Boolean).join(' · ');
      el('preview-photo').textContent=card.photo?'':'PHOTO';el('preview-photo').style.backgroundImage=card.photo?'url('+JSON.stringify(card.photo)+')':'none';
      const fields=el('preview-fields');fields.replaceChildren();
      for(const key of ['id','issuer','level','valid','scope','bio']){
        const title=document.createElement('dt'),value=document.createElement('dd');title.textContent=labels[key];value.textContent=card[key]||defaults[key];fields.append(title,value);
      }
      el('card-preview').hidden=false;el('card-preview').scrollIntoView({block:'nearest'});
    }catch(e){el('card-status').textContent=e.message;}
  };
  el('close-preview').onclick=()=>{el('card-preview').hidden=true;};
  load();
})();
