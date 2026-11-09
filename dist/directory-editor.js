(function () {
  'use strict';
  const API = 'https://lfmm-directory-data.harvey-the-rabbit.chatgpt.site/api/referrals';
  const SESSION_KEY = 'lfmm.referral.editor.session.v1';
  const textFields = ['firstName','group','website','locationsUrl','phone','fax','photoUrl','staffNotes','officeNotes'];
  const officeLimits = {label:160,address:500,city:120,region:80,zip:20,phone:100,fax:100,hours:1500,notes:5000,status:40,sourceUrl:2000};
  const editor = {enabled:false, initialize, open:openEditor, openNote:provider=>openEditor(provider, 'staffNotes'), activate:provider=>saveActivation(provider, true)};
  window.LFMM_EDITOR = editor;
  let token = '', expiresAt = 0, baseProviders = [], edits = new Map(), loading = null, loadGeneration = 0;
  let dialog, loginDialog, active = null, pendingOpen = null, saving = false, synced = false, geocoding = null, imageUpload = null;
  const clean = value => ['Not provided','Not mapped'].includes(value) ? '' : String(value ?? '');

  async function request(path, options = {}) {
    const controller = new AbortController();
    const multipart = options.body instanceof FormData;
    const timeout = setTimeout(()=>controller.abort(), multipart ? 60000 : 20000);
    const cancel = ()=>controller.abort();
    options.signal?.addEventListener('abort', cancel, {once:true});
    if(options.signal?.aborted)controller.abort();
    try {
      const response = await fetch(API + path, {...options, credentials:'omit', cache:'no-store', signal:controller.signal,
        headers:{...(options.body && !multipart ? {'Content-Type':'application/json'} : {}), ...(token ? {Authorization:'Bearer '+token} : {})}});
      const data = await response.json().catch(()=>({error:'The directory response could not be read.'}));
      if (!response.ok) { const error = new Error(data.error || 'The request failed.'); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' && !options.signal?.aborted) throw new Error('The request timed out. Try again.');
      throw error;
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); }
  }
  function rememberSession() {
    try { if (token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({token,expiresAt})); else sessionStorage.removeItem(SESSION_KEY); } catch {}
  }
  function refreshBanner(message = '') {
    document.getElementById('directory-sync-message').textContent = message || (editor.enabled ? 'Editing live referral directory' : synced ? 'Shared directory is up to date' : 'Loading shared directory…');
    document.getElementById('directory-sync-bar').classList.toggle('sync-error', Boolean(message));
    document.getElementById('directory-lock').hidden = !editor.enabled;
    document.getElementById('directory-add-provider').hidden = !editor.enabled;
    document.getElementById('edit-directory').textContent = editor.enabled ? 'Editing enabled' : 'Edit directory';
    document.body.classList.toggle('editing-directory', editor.enabled);
  }
  function mergeOffices(base, patch) {
    const previous = new Map(base.map(office=>[office.id, office]));
    return patch.map(office=>{
      const original = previous.get(office.id) || {};
      const merged = {...structuredClone(original), ...office};
      if (office.address !== original.address) {
        for (const key of ['geocodeProvenance','matchedAddress','coordinateBasis','geoSource']) delete merged[key];
        merged.verificationStatus = 'edited';
      }
      return merged;
    });
  }
  function applyEdits() {
    const bases = [...baseProviders, ...Array.from(edits.values()).filter(row=>row.created && !baseProviders.some(p=>p.id===row.id))
      .map(row=>doctorProvider({...row.patch,id:row.id,sourceTitle:row.patch.firstName,createdAt:row.createdAt}))];
    const updated = bases.map(base=>{
      const row = edits.get(base.id), patch = row?.patch || {};
      const value = {...structuredClone(base), ...structuredClone(patch)};
      if (patch.locations) value.locations = mergeOffices(base.locations, patch.locations);
      value.sourceTitle = value.firstName;
      value.specialty = value.group;
      value.caseRules = {...value.caseRules, wc:value.wcApproved ? 'yes' : 'unknown'};
      value.inactive = Boolean(row?.inactive);
      return doctorProvider(value);
    });
    providers.splice(0, providers.length, ...updated);
    setupFilters();
    if (![...specialtySelect.options].some(option=>option.value===state.specialty)) state.specialty='all';
    specialtySelect.value=state.specialty;
    bodySelect.value=state.body;
    const selected = providers.find(p=>p.id===state.selectedId);
    if (selected?.inactive && !editor.enabled) { state.selectedId=null; closePanels(); }
    render();
    if (selected && detailSheet.classList.contains('open')) detailContent.innerHTML=detailTemplate(selected);
  }
  async function loadLive() {
    if (loading) return loading;
    const generation=loadGeneration;
    loading=(async()=>{
      try {
        const data = await request('/directory');
        if (data.rosterVersion !== source.rosterVersion || !Array.isArray(data.edits)) throw new Error('The directory version does not match. Refresh this page.');
        if(generation!==loadGeneration)return;
        edits = new Map(data.edits.map(row=>[row.id,row]));
        synced=true; applyEdits(); refreshBanner();
      } catch (error) { refreshBanner('Shared updates unavailable. Use Refresh data to retry.'); throw error; }
      finally { loading=null; }
    })();
    return loading;
  }
  function officeValue(office) {
    const result={id:office.id};
    for (const key of Object.keys(officeLimits)) result[key]=Array.isArray(office[key]) ? office[key].join('\n') : clean(office[key]);
    result.status = office.status==='coming_soon'?'coming_soon':'listed';
    result.geocodeSource=clean(office.geocodeSource);
    result.sourceUrl ||= office.sourceUrls?.[0] || '';
    for (const key of ['lat','lng']) result[key]=Number.isFinite(office[key]) ? office[key] : null;
    return result;
  }
  function editable(provider) {
    const result={};
    for (const key of textFields) result[key]=clean(provider[key]);
    result.publicEmails=provider.publicEmails || [];
    result.wcApproved=Boolean(provider.wcApproved);
    result.referralBlocked=Boolean(provider.referralBlocked);
    result.locations=provider.locations.map(officeValue);
    return result;
  }
  function field(key, label, value, options={}) {
    const attrs=' name="'+key+'" id="edit-'+key+'"'+(options.required?' required':'');
    let input;
    if (options.choices) input='<select'+attrs+'>'+options.choices.map(v=>'<option value="'+escapeHtml(v)+'"'+(value===v?' selected':'')+'>'+escapeHtml(v)+'</option>').join('')+'</select>';
    else if (options.multiline) input='<textarea'+attrs+' rows="3" maxlength="'+(options.max||5000)+'">'+escapeHtml(Array.isArray(value)?value.join('\n'):value)+'</textarea>';
    else input='<input'+attrs+' type="'+(options.number?'number':'text')+'"'+(options.number?' step="any"':' maxlength="'+(options.max||500)+'"')+' value="'+escapeHtml(value??'')+'">';
    return '<label class="editor-field'+(options.wide?' editor-wide':'')+'"><span>'+label+'</span>'+input+'</label>';
  }
  function officesHtml(offices, openId) {
    return offices.map((office,index)=>{
      const f=(key,label,options={})=>field('office-'+index+'-'+key,label,office[key],options).replace(/<(input|select|textarea)/,'<$1 data-office-field="'+key+'"');
      return '<details class="editor-office" data-office-row data-office-id="'+escapeHtml(office.id)+'"'+(office.id===openId?' open':'')+'><summary>'+escapeHtml(office.label||office.city||'New location')+' · '+escapeHtml(office.address)+'</summary><div class="editor-grid">'+
        f('label','Location name',{max:160})+f('status','Status',{choices:['listed','coming_soon']})+f('address','Full street address',{required:true,wide:true})+
        f('city','City',{max:120})+f('region','State',{max:80})+f('zip','ZIP',{max:20})+f('phone','Phone',{max:100})+f('fax','Fax',{max:100})+
        f('hours','Hours',{multiline:true,wide:true,max:1500})+f('notes','Location note',{multiline:true,wide:true})+f('sourceUrl','Office website',{wide:true,max:2000})+
        '<div class="editor-wide"><button type="button" class="secondary-button" data-locate-office>Locate this address</button><span class="editor-office-status" role="status">'+(office.lat!==null?'Mapped':'Not mapped')+'</span><div class="editor-office-choices"></div></div>'+
        f('lat','Latitude',{number:true})+f('lng','Longitude',{number:true})+'<input type="hidden" data-office-field="geocodeSource" value="'+escapeHtml(office.geocodeSource||'')+'">'+
        '<button type="button" class="editor-remove-office editor-wide" data-remove-office>Remove location</button></div></details>';
    }).join('');
  }
  function readOffices() {
    return [...dialog.querySelectorAll('[data-office-row]')].map(row=>{
      const office={id:row.dataset.officeId};
      for (const key of [...Object.keys(officeLimits),'geocodeSource','lat','lng']) {
        const value=row.querySelector('[data-office-field="'+key+'"]').value.trim();
        office[key]=['lat','lng'].includes(key) ? value===''?null:Number(value) : value;
      }
      return office;
    });
  }
  function valuesFromForm() {
    const form=document.getElementById('provider-edit-form'), value={};
    for (const key of textFields) value[key]=form.elements[key].value.trim();
    value.publicEmails=form.elements.publicEmails.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    value.wcApproved=form.elements.wcApproved.checked;
    value.referralBlocked=form.elements.referralBlocked.checked;
    value.locations=readOffices();
    return value;
  }
  function changes() {
    const values=valuesFromForm();
    return Object.fromEntries(Object.entries(values).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(active.original[key])));
  }
  function dirty() { return Boolean(active && Object.keys(changes()).length); }
  function closeEditor(force=false) {
    if (saving) return;
    if (!force && (dirty() || imageUpload?.pending) && !window.confirm('Discard this unsaved draft?')) return;
    imageUpload?.dispose(); imageUpload=null; geocoding?.abort(); dialog.close(); active=null;
  }
  function openLogin() { loginDialog.showModal(); document.getElementById('editor-password').focus(); }
  async function openEditor(provider, focusField) {
    if (!editor.enabled) { pendingOpen={providerId:provider.id,focusField}; openLogin(); return; }
    if (!synced) { showToast('Refresh shared data before editing.'); return; }
    if (dialog.open) { closeEditor(); if(dialog.open)return; }
    closePanels();
    const values=editable(provider);
    active={id:provider.id,isNew:provider.isNew,original:values,revision:edits.get(provider.id)?.revision||0,inactive:provider.inactive};
    const f=(key,label,options={})=>field(key,label,values[key],options);
    dialog.innerHTML='<form id="provider-edit-form"><header class="provider-editor-head"><div><p class="detail-kicker">EDIT LIVE REFERRAL DIRECTORY</p><h2 id="provider-editor-title">'+escapeHtml(provider.isNew?'Add provider':provider.name)+'</h2><p>Saved changes appear for everyone.</p></div><button type="button" class="sheet-close" data-editor-close aria-label="Close editor">'+iconSvg('close')+'</button></header><div class="provider-editor-body"><fieldset class="editor-section"><legend>Provider</legend><div class="editor-grid">'+
      f('firstName','Provider name',{required:true,max:100})+f('group','Service',{choices:Object.keys(CATEGORY_CONFIG)})+f('website','Website',{max:2000})+f('locationsUrl','Locations website',{max:2000})+
      f('photoUrl','Photo / logo URL',{wide:true,max:2000})+f('phone','Main phone',{max:100})+f('fax','Main fax',{max:100})+f('publicEmails','Office emails · one per line',{multiline:true,wide:true})+
      '<label class="editor-check"><input type="checkbox" name="wcApproved"'+(values.wcApproved?' checked':'')+'>WC approved list</label><label class="editor-check"><input type="checkbox" name="referralBlocked"'+(values.referralBlocked?' checked':'')+'>Do not refer</label>'+
      f('staffNotes','Provider note',{multiline:true,wide:true})+f('officeNotes','Office contact notes',{multiline:true,wide:true})+'</div></fieldset><fieldset class="editor-section"><legend>Locations · '+values.locations.length+'</legend><label class="editor-field">Find a location<input type="search" id="editor-office-search" placeholder="City, name or address"></label><div id="editor-offices">'+officesHtml(values.locations,state.selectedLocationId||values.locations[0]?.id)+'</div><button type="button" class="secondary-button" id="editor-add-office">Add location</button></fieldset></div><footer class="provider-editor-footer"><p id="editor-save-status" class="editor-save-status" role="status">Save when your changes are ready.</p><button type="button" class="secondary-button" id="editor-reload" hidden>Load latest version</button><div>'+(!provider.isNew?'<button type="button" class="editor-activation-button" id="editor-activation">'+(provider.inactive?'Activate':'Deactivate')+' provider</button>':'')+'<button type="button" class="secondary-button" data-editor-close>Cancel</button><button type="submit" class="primary-button" id="editor-save">Save to live directory</button></div></footer></form>';
    const form=dialog.querySelector('form');
    imageUpload=window.LFMM_IMAGE_UPLOAD.attach({input:form.elements.photoUrl,upload:async(file,signal)=>{
      const body=new FormData(); body.append('image',file);
      try { return await request('/images',{method:'POST',body,signal}); }
      catch(error){if(error.status===401){token='';expiresAt=0;rememberSession();openLogin();}throw error;}
    },onBusy:busy=>{if(form.isConnected)form.querySelectorAll('[type="submit"],#editor-activation').forEach(button=>button.disabled=busy);}});
    dialog.showModal();
    form.elements[focusField||'firstName']?.focus();
  }
  async function submit(event, activation) {
    event?.preventDefault();
    const form=document.getElementById('provider-edit-form');
    if (saving || imageUpload?.pending || !form.reportValidity()) return;
    if (!token) { openLogin(); return; }
    const patch=active.isNew ? valuesFromForm() : changes();
    if (!active.isNew && !Object.keys(patch).length && activation===undefined) { closeEditor(true); return; }
    saving=true; form.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
    const status=document.getElementById('editor-save-status'); status.textContent='Saving to the shared directory…'; status.classList.remove('editor-error');
    try {
      const path=active.isNew?'/providers':'/providers/'+active.id+(activation===undefined?'':'/activation');
      const payload={patch,revision:active.revision,rosterVersion:source.rosterVersion};
      if(active.isNew)payload.id=active.id;
      if(activation!==undefined)payload.active=activation;
      const result=await request(path,{method:active.isNew||activation!==undefined?'POST':'PUT',body:JSON.stringify(payload)});
      loadGeneration++;edits.set(result.edit.id,result.edit); saving=false; closeEditor(true); applyEdits(); showToast('Saved to the live referral directory.');
    } catch(error) {
      status.textContent=error.message; status.classList.add('editor-error');
      if(error.status===409)document.getElementById('editor-reload').hidden=false;
      if(error.status===401){token='';expiresAt=0;rememberSession();openLogin();}
    } finally { saving=false; form.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false); }
  }
  async function saveActivation(provider, enabled) {
    if(saving || !editor.enabled)return;
    saving=true;
    try {
      const result=await request('/providers/'+provider.id+'/activation',{method:'POST',body:JSON.stringify({active:enabled,patch:{},revision:edits.get(provider.id)?.revision||0,rosterVersion:source.rosterVersion})});
      loadGeneration++;edits.set(provider.id,result.edit);applyEdits();showToast(enabled?'Provider activated.':'Provider deactivated.');
    } catch(error){showToast(error.message);} finally {saving=false;}
  }
  async function locateOffice(row) {
    const status=row.querySelector('.editor-office-status'), choices=row.querySelector('.editor-office-choices');
    const office=readOffices().find(o=>o.id===row.dataset.officeId);
    if(!office.address){status.textContent='Enter the full street address.';return;}
    geocoding?.abort();const controller=new AbortController();geocoding=controller;
    status.textContent='Looking up address…';choices.replaceChildren();
    try {
      const query=[office.address,...[office.city,office.region,office.zip].filter(value=>value&&!normalized(office.address).includes(normalized(value)))].join(', ');
      const matches=await window.LFMM_ADDRESS_GEOCODER.search(query,{signal:controller.signal});
      if(controller.signal.aborted || !row.isConnected)return;
      const choose=match=>{
        row.querySelector('[data-office-field="lat"]').value=match.lat;
        row.querySelector('[data-office-field="lng"]').value=match.lng;
        row.querySelector('[data-office-field="geocodeSource"]').value='US Census address lookup';
        status.textContent=match.label;choices.replaceChildren();
      };
      if(matches.length===1)choose(matches[0]);
      else if(matches.length){status.textContent='Choose the office address.';matches.forEach(match=>{const button=document.createElement('button');button.type='button';button.className='editor-address-choice';button.textContent=match.label;button.addEventListener('click',()=>choose(match));choices.append(button);});}
      else status.textContent='No match. You can save the location with empty coordinates.';
    } catch(error){if(!controller.signal.aborted)status.textContent='Address lookup unavailable. Try again or save with empty coordinates.';}
  }
  async function signIn(event) {
    event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
    try {
      const result=await request('/editor/login',{method:'POST',body:JSON.stringify({password:document.getElementById('editor-password').value})});
      document.getElementById('editor-password').value='';token=result.token;expiresAt=result.expiresAt;rememberSession();
      await loadLive();editor.enabled=true;refreshBanner();render();loginDialog.close();
      if(pendingOpen){const pending=pendingOpen;pendingOpen=null;const provider=providers.find(p=>p.id===pending.providerId);if(provider)openEditor(provider,pending.focusField);}
    } catch(error){document.getElementById('editor-login-error').textContent=error.message;} finally{button.disabled=false;}
  }
  async function initialize() {
    baseProviders=structuredClone(providers);loginDialog=document.getElementById('editor-login');
    dialog=document.createElement('dialog');dialog.className='provider-editor';dialog.setAttribute('aria-labelledby','provider-editor-title');document.body.append(dialog);
    document.getElementById('edit-directory').addEventListener('click',()=>{if(!editor.enabled)openLogin();else showToast('Select a provider to edit.');});
    document.getElementById('directory-add-provider').addEventListener('click',()=>openEditor(doctorProvider({id:'custom-referral-'+crypto.randomUUID(),firstName:'',group:'Physical Therapy',locations:[],isNew:true})));
    document.getElementById('directory-refresh').addEventListener('click',()=>void loadLive().catch(()=>{}));
    document.getElementById('editor-login-form').addEventListener('submit',signIn);
    document.getElementById('editor-login-cancel').addEventListener('click',()=>{pendingOpen=null;loginDialog.close();});
    loginDialog.addEventListener('cancel',()=>{pendingOpen=null;});
    loginDialog.addEventListener('close',()=>{document.getElementById('editor-password').value='';document.getElementById('editor-login-error').textContent='';});
    document.getElementById('directory-lock').addEventListener('click',async()=>{
      if(dialog.open){closeEditor();if(dialog.open)return;}
      try{await request('/editor/logout',{method:'POST'});}catch{}
      token='';expiresAt=0;rememberSession();editor.enabled=false;applyEdits();refreshBanner();
    });
    dialog.addEventListener('invalid',event=>{const section=event.target.closest('details');if(section)section.open=true;},true);
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
    dialog.addEventListener('submit',event=>void submit(event));
    dialog.addEventListener('click',async event=>{
      if(event.target.closest('[data-editor-close]'))closeEditor();
      if(event.target.closest('#editor-activation'))void submit(null,Boolean(active.inactive));
      if(event.target.closest('[data-locate-office]'))void locateOffice(event.target.closest('[data-office-row]'));
      if(event.target.closest('#editor-add-office')){
        const offices=readOffices(), office=officeValue({id:'office-'+crypto.randomUUID()});offices.push(office);
        document.getElementById('editor-offices').innerHTML=officesHtml(offices,office.id);
      }
      const remove=event.target.closest('[data-remove-office]');
      if(remove){geocoding?.abort();const id=remove.closest('[data-office-row]').dataset.officeId;document.getElementById('editor-offices').innerHTML=officesHtml(readOffices().filter(o=>o.id!==id));}
      if(event.target.closest('#editor-reload') && window.confirm('Load the latest version and discard this draft?')){const id=active.id;try{await loadLive();closeEditor(true);openEditor(providers.find(p=>p.id===id));}catch(error){document.getElementById('editor-save-status').textContent=error.message;}}
    });
    dialog.addEventListener('input',event=>{
      if(event.target.id==='editor-office-search'){
        const term=normalized(event.target.value);
        dialog.querySelectorAll('[data-office-row]').forEach(row=>{row.hidden=!normalized(row.querySelector('summary').textContent).includes(term);});
      }
      const row=event.target.closest('[data-office-row]');
      if(row && ['address','city','region','zip'].includes(event.target.dataset.officeField)){
        geocoding?.abort();for(const key of ['lat','lng'])row.querySelector('[data-office-field="'+key+'"]').value='';
        row.querySelector('[data-office-field="geocodeSource"]').value='';row.querySelector('.editor-office-status').textContent='Address changed. Locate it to update the map.';
      }
    });
    window.addEventListener('beforeunload',event=>{if(dirty()||saving||imageUpload?.pending){event.preventDefault();event.returnValue='';}});
    try{const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');if(saved?.expiresAt>Date.now()&&/^[a-f0-9]{64}$/.test(saved.token)){token=saved.token;expiresAt=saved.expiresAt;}}catch{}
    await loadLive().catch(()=>{});
    if(token){try{await request('/editor/session');editor.enabled=true;refreshBanner();render();}catch{token='';expiresAt=0;rememberSession();}}
    if(new URLSearchParams(location.search).get('edit')==='1'&&!editor.enabled)openLogin();
    setInterval(()=>{if(document.visibilityState==='visible'&&!saving)void loadLive().catch(()=>{});},60000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!saving)void loadLive().catch(()=>{});});
  }
})();
