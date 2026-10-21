'use strict';
(()=>{
 const box=document.getElementById('constantCalculator');
 const input=id=>document.getElementById(id);
 const read=id=>{const raw=input(id).value.trim();if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(raw))return NaN;return Number(raw.replace(',','.'));};
 function calculate(){const old=read('calcOld'),measured=read('calcMeasured'),reference=read('calcReference'),mode=input('calcMode').value;const out=input('calcResult');if(![old,measured,reference].every(x=>Number.isFinite(x)&&x>0)){out.textContent='Informe valores maiores que zero, sem separador de milhar. Exemplo: 17796 ou 17,796.';return;}if(!['direct','inverse'].includes(mode)){out.textContent='Selecione a relação da constante confirmada no manual do equipamento.';return;}const result=mode==='direct'?old*reference/measured:old*measured/reference;if(!Number.isFinite(result)){out.textContent='Valores fora da faixa de cálculo.';return;}const formula=mode==='direct'?'Constante atual × peso padrão ÷ peso medido':'Constante atual × peso medido ÷ peso padrão';out.textContent=`Constante calculada: ${result.toLocaleString('pt-BR',{maximumFractionDigits:6})}. Erro: ${signed(Core.err({measured,reference}))}%. Fórmula: ${formula}. Resultado de apoio; confirme a resolução e o procedimento do integrador antes de aplicar.`;}
 box.addEventListener('input',calculate);box.addEventListener('change',calculate);
 input('calcUseReading').onclick=()=>{const rows=readRows();if(!rows.length){toast('Preencha uma leitura válida para utilizar nesta calculadora.');return;}const row=rows.at(-1);input('calcMeasured').value=String(row.measured);input('calcReference').value=String(row.reference);const old=document.querySelector('#form').elements.scaleBefore.value;if(old)input('calcOld').value=old;calculate();};
})();
