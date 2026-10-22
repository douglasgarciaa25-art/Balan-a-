'use strict';
(()=>{
 let client=null,config=null,user=null,team=null,teams=[],meta=null,busy=false,timer=null;
 const status=t=>$('#cloudStatus').textContent=t;
 const safe=s=>esc(String(s??''));
 const setup=`<details><summary>Configuração segura da nuvem</summary><p>Use um projeto Supabase destinado a este aplicativo, com o arquivo <b>cloud-setup.sql</b> aplicado pelo administrador. Nunca use chave secreta ou service_role. Os colegas precisam de conta e convite.</p><form id="cloudConfig"><label>URL do projeto<input name="url" type="url" placeholder="https://projeto.supabase.co" required></label><label>Chave pública publishable<input name="key" autocomplete="off" placeholder="sb_publishable_…" required></label><button class="primary">Salvar configuração</button></form></details>`;
 const login=`<form id="cloudLogin"><div class="grid"><label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" minlength="8" required></label></div><button class="primary">Entrar</button> <button type="button" id="cloudSignup">Criar conta</button></form>`;
 function logUI(){return setup+login;}
 async function connect(c){
  config=c;client=supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'balanca-equipe-'+new URL(c.url).hostname}});
  $('#cloudPanel').innerHTML=logUI();wireBase();const session=await client.auth.getSession();if(session.data.session)await loggedIn();else status('Conecte sua conta para entrar no espaço compartilhado da equipe.');
 }
 function ownerKey(){return config.url+'|'+user.id+'|'+team.id;}
 async function setMeta(version,revision){meta={...meta,version,localRevision:revision,at:Core.now()};await Store.setMeta('cloudTeamSync:'+ownerKey(),meta);status(`Equipe ${team.name}: sincronizado em ${new Date(meta.at).toLocaleString('pt-BR')}.`);}
 async function loggedIn(){
  const r=await client.auth.getUser();if(r.error||!r.data.user)throw Error('Faça login novamente.');user=r.data.user;
  const memberships=await client.from('balanca_team_members').select('team_id').eq('user_id',user.id);
  if(memberships.error)throw Error('Confira o arquivo cloud-setup.sql: '+memberships.error.message);
  const ids=(memberships.data||[]).map(m=>m.team_id);
  if(ids.length){const r2=await client.from('balanca_teams').select('id,name,owner_id').in('id',ids);if(r2.error)throw r2.error;teams=r2.data||[];}else teams=[];
  const saved=await Store.getMeta('selectedTeam:'+config.url+'|'+user.id);
  team=teams.find(t=>t.id===saved)||teams[0]||null;
  await selectTeam(team,false);renderTeamUI();
 }
 async function selectTeam(value,save=true){team=value;if(!team){meta=null;status('Conta conectada: '+user.email+'. Crie uma equipe ou entre por convite.');return;}meta=await Store.getMeta('cloudTeamSync:'+ownerKey())||{version:0,localRevision:-1,auto:false};if(save)await Store.setMeta('selectedTeam:'+config.url+'|'+user.id,team.id);status('Equipe '+team.name+' selecionada. '+(meta.at?'Última sincronização: '+new Date(meta.at).toLocaleString('pt-BR'):'Revise os registros na nuvem antes de enviar.'));}
 async function renderTeamUI(){
  const options=teams.map(t=>`<option value="${safe(t.id)}" ${team?.id===t.id?'selected':''}>${safe(t.name)}</option>`).join('');
  const panel=`<p>Conectado como <b>${safe(user.email)}</b> <button id="cloudLogout">Sair</button></p><div class="cloud-mode"><h3>Espaço compartilhado</h3><label>Equipe<select id="teamSelect"><option value="">Selecionar equipe</option>${options}</select></label><div class="cloud-tools"><button id="syncNow" class="primary" ${team?'':'disabled'}>Sincronizar agora</button><button id="pullCloud" ${team?'':'disabled'}>Conferir alterações da equipe</button></div><label class="check"><input type="checkbox" id="autoSync" ${meta?.auto?'checked':''} ${team?'':'disabled'}> Sincronização automática enquanto o app estiver aberto e conectado</label>${team&&team.owner_id===user.id?'<button id="inviteView">Mostrar convite da equipe</button><p id="inviteOutput"></p>':''}</div><details><summary>Criar uma equipe</summary><form id="teamCreate"><label>Nome da equipe<input name="name" required minlength="2" maxlength="100" placeholder="Instrumentação - Unidade Nióbio"></label><button>Criar espaço</button></form></details><details><summary>Entrar em equipe por convite</summary><form id="teamJoin"><label>ID da equipe<input name="id" required placeholder="ID enviado pelo responsável"></label><label>Código de convite<input name="code" required placeholder="Código enviado pelo responsável"></label><button>Entrar na equipe</button></form></details><p class="muted">Somente membros autenticados acessam calibrações e fotos. Use "Conferir alterações" quando colegas já tiverem feito registros. O backup local continua disponível.</p>`;
  $('#cloudPanel').innerHTML=setup+panel;wireBase();wireTeam();
 }
 async function remote(){const res=await client.from('balanca_team_data').select('payload,version').eq('team_id',team.id).maybeSingle();if(res.error)throw Error('Falha ao consultar equipe: '+res.error.message);if(!res.data)throw Error('A equipe ainda não foi inicializada corretamente. Peça ao responsável para conferir o banco.');const payload=Core.migrate(res.data.payload);Core.validate(payload);return {payload,version:res.data.version};}
 async function sync(review=false){
  if(!client||!team){toast('Entre na equipe antes de sincronizar.');return;}if(busy||saving||submitting)return;if(!navigator.onLine){status('Offline: dados mantidos neste aparelho.');return;}
  busy=true;try{
   const startRev=state.revision,r=await remote();if(state.revision!==startRev)throw Error('Dados foram salvos durante a consulta. Sincronize novamente.');
   if(meta.version!==r.version){
    if(!review&&meta.localRevision===state.revision&&!dirty){if(!await commit({...r.payload,revision:state.revision}))return;await setMeta(r.version,state.revision);return;}
    if(!review)throw Error('A equipe possui dados novos. Clique em "Conferir alterações da equipe" para mesclar sem perder seus registros.');
    const pre=Core.merge(state,r.payload,false);
    if(!confirm(`A equipe tem ${r.payload.records.length} calibrações. Serão adicionadas ${pre.added} calibrações. ${pre.conflicts} registros e ${pre.scaleConflicts} balanças possuem diferenças. Conferir e unir os dados?`))return;
    const replace=(pre.conflicts||pre.scaleConflicts)?confirm('Nas diferenças, utilizar os dados mais recentes da nuvem? OK: nuvem; Cancelar: manter dados deste aparelho.'):false;
    const merged=Core.merge(state,r.payload,replace);
    if(JSON.stringify(merged.state.records)!==JSON.stringify(state.records)||JSON.stringify(merged.state.scales)!==JSON.stringify(state.scales)){
      if(!await commit(merged.state))return;
    }
    meta={...meta,version:r.version,localRevision:-1};
   }
   if(meta.localRevision===state.revision){status('Equipe '+team.name+': tudo sincronizado.');return;}
   const snapshot=Core.clone(state),serialized=JSON.stringify(snapshot);
   if(new Blob([serialized]).size>24*1024*1024)throw Error('Fotos e dados passaram de 24 MB. Faça backup e reduza as fotos antes de enviar.');
   const saved=await client.rpc('balanca_team_save',{p_team:team.id,p_payload:snapshot,p_expected:r.version});
   if(saved.error)throw Error(saved.error.message.includes('SYNC_CONFLICT')?'Outro colega salvou primeiro; confira as alterações da equipe.':saved.error.message);
   await setMeta(saved.data,snapshot.revision);
  }catch(e){status('Nuvem: '+e.message+' Os registros deste aparelho foram mantidos.');}finally{busy=false;}
 }
 async function createTeam(name){
  const created=await client.from('balanca_teams').insert({name,owner_id:user.id}).select('id,name,owner_id').single();if(created.error)throw created.error;
  const t=created.data;
  const member=await client.from('balanca_team_members').insert({team_id:t.id,user_id:user.id});if(member.error)throw Error('Espaço criado, mas falta concluir cadastro de membro: '+member.error.message);
  const invite=await client.from('balanca_team_invites').insert({team_id:t.id});if(invite.error)throw Error('Espaço criado, mas convite não iniciado: '+invite.error.message);
  const initial=await client.from('balanca_team_data').insert({team_id:t.id,payload:Core.clone(state),version:1,updated_by:user.id});if(initial.error)throw Error('Espaço criado, mas os dados não foram enviados: '+initial.error.message);
  teams.push(t);await selectTeam(t);await setMeta(1,state.revision);renderTeamUI();
 }
 function schedule(){clearTimeout(timer);if(client&&team&&meta?.auto)timer=setTimeout(()=>sync(),2500);}
 function wireBase(){const form=$('#cloudConfig');if(form)form.onsubmit=async e=>{e.preventDefault();try{const c=Object.fromEntries(new FormData(e.target)),u=new URL(c.url);if(u.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(u.hostname)||u.username||u.password)throw Error('URL HTTPS inválida para Supabase.');if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.key))throw Error('Use somente a chave pública publishable. Nunca uma chave secreta.');c.url=u.origin;await Store.setMeta('cloudConfig',c);await connect(c);}catch(e){toast(e.message);}};
  const lf=$('#cloudLogin');if(lf){lf.onsubmit=async e=>{e.preventDefault();try{const f=Object.fromEntries(new FormData(e.target)),res=await client.auth.signInWithPassword(f);lf.elements.password.value='';if(res.error)throw res.error;await loggedIn();}catch(err){status(err.message);}};$('#cloudSignup').onclick=async()=>{if(!lf.reportValidity())return;try{const f=Object.fromEntries(new FormData(lf)),res=await client.auth.signUp(f);lf.elements.password.value='';if(res.error)throw res.error;status('Cadastro enviado. Confirme o e-mail, caso solicitado, e faça login.');}catch(e){status(e.message);}};}
 }
 function wireTeam(){
  $('#cloudLogout').onclick=async()=>{await client.auth.signOut();user=null;team=null;meta=null;teams=[];$('#cloudPanel').innerHTML=logUI();wireBase();status('Você saiu da nuvem; os registros locais foram preservados.');};
  $('#teamSelect').onchange=async e=>{const t=teams.find(t=>t.id===e.target.value)||null;await selectTeam(t);renderTeamUI();};
  $('#syncNow').onclick=()=>sync(false);$('#pullCloud').onclick=()=>sync(true);
  $('#autoSync').onchange=async e=>{if(!team)return;meta.auto=e.target.checked;await Store.setMeta('cloudTeamSync:'+ownerKey(),meta);schedule();};
  $('#teamCreate').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{if(!confirm('Criar um espaço da equipe com os dados deste aparelho? Os membros convidados terão acesso às calibrações e fotos.'))return;await createTeam(e.target.elements.name.value.trim());toast('Equipe criada. Compartilhe ID e código de convite somente com colegas autorizados.');}catch(err){status(err.message);}finally{busy=false;}};
  $('#teamJoin').onsubmit=async e=>{e.preventDefault();try{const f=Object.fromEntries(new FormData(e.target));for(const k of ['id','code'])if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(f[k].trim()))throw Error('ID ou código de convite inválido.');const r=await client.rpc('balanca_join_team',{p_team:f.id.trim(),p_code:f.code.trim()});if(r.error)throw r.error;if(!r.data)throw Error('Convite inválido ou já substituído.');await loggedIn();toast('Entrada na equipe autorizada. Revise os registros da nuvem antes de enviar.');}catch(err){status('Não foi possível entrar: '+err.message);}};
  const invite=$('#inviteView');if(invite)invite.onclick=async()=>{const r=await client.from('balanca_team_invites').select('code').eq('team_id',team.id).single();if(r.error){status(r.error.message);return;}$('#inviteOutput').textContent=`ID da equipe: ${team.id} | Código: ${r.data.code}. Compartilhe somente com membros autorizados.`;};
 }
 document.addEventListener('statecommitted',schedule);window.addEventListener('online',schedule);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&client&&team&&meta?.auto)schedule();});
 // Busca leve de atualizações da equipe, somente com aplicativo aberto.
 setInterval(()=>{if(client&&team&&meta?.auto&&!document.hidden&&navigator.onLine&&!busy&&!dirty)sync(false);},90000);
 (async()=>{try{config=await Store.getMeta('cloudConfig');if(config&&typeof supabase!=='undefined')await connect(config);else{$('#cloudPanel').innerHTML=setup;wireBase();}}catch(e){status('Configuração pendente: '+e.message);}})();
})();
