'use strict';
let installPrompt=null;const installButton=document.querySelector('#installApp'),installHelp=document.querySelector('#installHelp'),offlineStatus=document.querySelector('#offlineStatus');
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function updateInstall(){installButton.hidden=standalone();document.querySelector('#installState').textContent=standalone()?'Aplicativo instalado':'Instale no celular';}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;updateInstall();});
window.addEventListener('appinstalled',()=>{installPrompt=null;updateInstall();toast('Aplicativo instalado. Abra pelo ícone Balança.');});
installButton.onclick=async()=>{if(installPrompt){await installPrompt.prompt();const result=await installPrompt.userChoice;installPrompt=null;if(result.outcome!=='accepted')toast('Você pode instalar depois pelo menu do navegador.');}else installHelp.showModal();};
document.querySelector('#closeInstallHelp').onclick=()=>installHelp.close();
let offlineReady=false;
function connection(){offlineStatus.textContent=navigator.onLine?(offlineReady?'Pronto para usar offline neste aparelho.':'Preparando acesso offline…'):(offlineReady?'Você está offline. Registros, fotos e PDFs continuam disponíveis.':'Você está offline. Conecte para preparar o primeiro acesso.');}
window.addEventListener('online',connection);window.addEventListener('offline',connection);
if('serviceWorker' in navigator&&window.isSecureContext&&location.protocol!=='file:'){navigator.serviceWorker.register('./sw.js').then(async reg=>{await navigator.serviceWorker.ready;offlineReady=true;connection();if(reg.waiting)toast('Atualização pronta. Salve e feche todas as janelas do aplicativo para atualizar.');reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)toast('Nova versão disponível. Salve e feche todas as janelas para atualizar.');});});}).catch(()=>{offlineStatus.textContent='Não foi possível preparar o modo offline. Conecte à internet e abra novamente.';});}else{offlineStatus.textContent='Para instalar, abra o aplicativo por um endereço HTTPS. Abrir o arquivo ZIP ou HTML não instala o aplicativo.';}
updateInstall();if(location.protocol!=='file:')connection();
