import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCAcWktRvA6670OhbiewfCMW3MADNU5YmE",
    authDomain: "lucroseguro-app.firebaseapp.com",
    projectId: "lucroseguro-app",
    storageBucket: "lucroseguro-app.firebasestorage.app",
    messagingSenderId: "414461858129",
    appId: "1:414461858129:web:5ccd546015674f8d8b0370",
    measurementId: "G-RP5X05DSHF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxmr0Y-4fq5OigxSxSMaAqnXTDiM7ekaL9EA7j1Bzf-zyQ311qoE7elqAoIYgoFT_EhJg/exec"; 

let chartMotivosInstance = null; let chartFurtosPerfilInstance = null; let chartFurtosLocaisInstance = null;
let sheetsDataRaw = []; let produtosMestre = []; let itemEmAuditoria = null; let produtosFurto =[]; 
let currentUserEmpresa = ""; let currentUserFilial = ""; let currentUserRole = "operacional";

if(window.lucide) lucide.createIcons();

// PREENCHIMENTO AUTOMÁTICO DE DATAS
const autoFillDates = () => {
    const h = new Date(); const dF = h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0');['p-data', 'f-data', 'c-data', 't-prazo', 'r-data'].forEach(id => { const c = document.getElementById(id); if(c) c.value = dF; });
};
autoFillDates();

const parseLocalFloat = (val) => {
    if(typeof val === 'number') return val;
    if(!val) return 0;
    return parseFloat(String(val).replace(/\./g, '').replace(',', '.')) || 0;
};

const extrairAnoMes = (dataRaw) => {
    if (!dataRaw) return ""; let str = String(dataRaw).trim();
    if (str.includes('/')) { let p = str.split(' ')[0].split('/'); if (p.length >= 3) return `${p[2]}-${p[1].padStart(2, '0')}`; } 
    else if (str.includes('-')) { return str.substring(0, 7); }
    return str;
};

window.exportDataToCSV = (tipo, filename) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === tipo);
    if(dataToExport.length === 0) { alert("Sem dados processados para exportar."); return; }
    const headers = Object.keys(dataToExport[0]).join(";");
    const rows = dataToExport.map(obj => Object.values(obj).map(val => `"${String(val).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + headers + "\n" + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename + "_" + currentUserFilial.replace(/[^a-zA-Z0-9]/g, '') + ".csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
};

const submitToSheets = async (form, btnId, msgSuccessId, msgErrorId, payload, btnOriginalText) => {
    const btn = document.getElementById(btnId); const msgSuccess = document.getElementById(msgSuccessId); const msgError = document.getElementById(msgErrorId);
    if(btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A enviar...'; }
    if(msgSuccess) msgSuccess.classList.add('hidden'); if(msgError) msgError.classList.add('hidden');
    if(window.lucide) lucide.createIcons();
    try {
        const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        const result = await response.json();
        if (result.status === 'success') {
            if(payload.tipo === 'atualizar_validade') {
                const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(payload.gtin) && i.data_validade === payload.data_validade);
                if (idx !== -1) { if (parseFloat(payload.quantidade) <= 0) sheetsDataRaw.splice(idx, 1); else sheetsDataRaw[idx].quantidade = payload.quantidade; }
            } 
            if(form) form.reset();
            if(msgSuccess) { msgSuccess.classList.remove('hidden'); setTimeout(() => msgSuccess.classList.add('hidden'), 5000); }
            window.fetchSheetsDataComHierarquia();
        } else throw new Error(result.message);
    } catch (error) { if(msgError) { msgError.innerText = error.message; msgError.classList.remove('hidden'); } } 
    finally { if(btn) { btn.disabled = false; btn.innerHTML = btnOriginalText; } if(window.lucide) lucide.createIcons(); }
};

window.fetchSheetsDataComHierarquia = async () => {
    const loadingQ = document.getElementById('loading-quebras'); const loadingMain = document.getElementById('loading-data');
    if(loadingQ) loadingQ.classList.remove('hidden'); if(loadingMain) loadingMain.classList.remove('hidden');
    sheetsDataRaw =[]; 
    try {
        const userEmailReq = auth.currentUser ? auth.currentUser.email : 'anonimo';
        const urlSegura = `${GOOGLE_SHEETS_WEBAPP_URL}?empresa=${encodeURIComponent(currentUserEmpresa)}&filial=${encodeURIComponent(currentUserFilial)}&role=${encodeURIComponent(currentUserRole)}&user=${encodeURIComponent(userEmailReq)}&t=${Date.now()}`;
        const res = await fetch(urlSegura); const data = await res.json();
        if(data && Array.isArray(data)) { sheetsDataRaw = data.filter(i => i.tipo !== 'produto'); produtosMestre = data.filter(i => i.tipo === 'produto'); }
    } catch(e) { console.error(e); } 
    finally {
        const hoje = new Date(); const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;['quebra', 'docas', 'validade', 'furtos', 'preco', 'caixa', 'inv', 'tar'].forEach(id => {
            const fM = document.getElementById(`filtro-mes-${id}`); const fF = document.getElementById(`filtro-filial-${id}`);
            if(fM && !fM.value) fM.value = mesAtual;
            const triggerRender = () => {
                if(id==='quebra') window.renderQuebrasDashboard(); if(id==='docas') window.renderDocasDashboard();
                if(id==='validade') window.renderValidadeDashboard(); if(id==='furtos') window.renderFurtosDashboard();
                if(id==='preco') window.renderPrecoDashboard(); if(id==='caixa') window.renderCaixaDashboard();
                if(id==='inv') window.renderListaInventarios(); if(id==='tar') window.renderTarefasDashboard();
            };
            if(fM) fM.onchange = triggerRender; if(fF) fF.onchange = triggerRender;
        });
        try { window.renderQuebrasDashboard(); window.renderPrecoDashboard(); window.renderDocasDashboard(); window.renderValidadeDashboard(); window.renderFurtosDashboard(); window.renderCaixaDashboard(); window.renderTarefasDashboard(); window.renderListaInventarios(); } catch(e) {}
        if(loadingQ) loadingQ.classList.add('hidden'); if(loadingMain) loadingMain.classList.add('hidden');
    }
};

window.renderQuebrasDashboard = () => {
    const fM = document.getElementById('filtro-mes-quebra')?.value; const fF = document.getElementById('filtro-filial-quebra')?.value;
    if(!fM) return;
    let dados = sheetsDataRaw.filter(i => i.tipo === 'quebra' && i.mes && extrairAnoMes(i.mes) === fM);
    if(fF && fF !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(fF).trim());
    if(dados.length === 0) { document.getElementById('quebras-dashboard-content')?.classList.add('hidden'); return; }
    document.getElementById('quebras-dashboard-content')?.classList.remove('hidden');
    
    let tRs = 0; let tQtd = 0; const motivosMap = {}; 
    dados.forEach(i => { 
        const v = parseLocalFloat(i.quantidade) * parseLocalFloat(i.custo); tRs += v; tQtd += parseLocalFloat(i.quantidade); 
        if(!motivosMap[i.motivo || 'Outros']) motivosMap[i.motivo || 'Outros'] = 0; motivosMap[i.motivo || 'Outros'] += v; 
    });
    if(document.getElementById('ui-quebra-total-rs')) document.getElementById('ui-quebra-total-rs').innerText = 'R$ ' + tRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-quebra-total-qtd')) document.getElementById('ui-quebra-total-qtd').innerText = tQtd.toLocaleString('pt-BR');
    
    const divChart = document.querySelector("#chart-motivos"); 
    if(divChart && typeof ApexCharts !== 'undefined') {
        if(chartMotivosInstance) chartMotivosInstance.destroy(); 
        chartMotivosInstance = new ApexCharts(divChart, { series: Object.values(motivosMap), labels: Object.keys(motivosMap), chart: { type: 'donut', height: 280, fontFamily: 'Inter, sans-serif' }, colors:['#0A2540', '#008950', '#f97316', '#eab308', '#ef4444', '#8b5cf6'], dataLabels: { enabled: false }, legend: { position: 'right' }, tooltip: { y: { formatter: function (val) { return "R$ " + val.toLocaleString('pt-BR', {minimumFractionDigits: 2}); } } } });
        chartMotivosInstance.render();
    }
};

window.renderDocasDashboard = () => {
    const fM = document.getElementById('filtro-mes-docas')?.value; const fF = document.getElementById('filtro-filial-docas')?.value;
    let dados = sheetsDataRaw.filter(i => i.tipo === 'recebimento');
    if (fM) dados = dados.filter(i => extrairAnoMes(i.data_entrega) === fM);
    if(fF && fF !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(fF).trim());
    if(dados.length === 0) { document.getElementById('docas-dashboard-content')?.classList.add('hidden'); return; }
    document.getElementById('docas-dashboard-content')?.classList.remove('hidden');

    let totalDiv = 0; let custoDiv = 0;
    dados.forEach(i => { totalDiv += parseLocalFloat(i.quantidade); custoDiv += (parseLocalFloat(i.quantidade) * parseLocalFloat(i.custo)); });
    if(document.getElementById('ui-docas-total')) document.getElementById('ui-docas-total').innerText = totalDiv.toLocaleString('pt-BR');
    if(document.getElementById('ui-docas-custo')) document.getElementById('ui-docas-custo').innerText = 'R$ ' + custoDiv.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    
    const divLista = document.getElementById('docas-lista-divergencias'); 
    if(divLista) {
        divLista.innerHTML = '';
        dados.slice(-5).reverse().forEach(i => { divLista.innerHTML += `<div class="p-3 border-b border-slate-100 last:border-0"><p class="font-bold text-navy">${i.fornecedor || 'Fornecedor'}</p><p class="text-sm text-slate-600">NF: ${i.nf || 'S/N'} | Divergência: <span class="font-bold text-red-600">${i.quantidade} un</span></p></div>`; });
    }
};

window.renderValidadeDashboard = () => {
    const fF = document.getElementById('filtro-filial-validade')?.value;
    let dados = sheetsDataRaw.filter(i => i.tipo === 'validade');
    if(fF && fF !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(fF).trim());
    if(dados.length === 0) { document.getElementById('validade-dashboard-content')?.classList.add('hidden'); return; }
    document.getElementById('validade-dashboard-content')?.classList.remove('hidden');

    let total = 0; let custo = 0;
    dados.forEach(i => { total += parseLocalFloat(i.quantidade); custo += (parseLocalFloat(i.quantidade) * parseLocalFloat(i.custo)); });
    if(document.getElementById('ui-validade-total')) document.getElementById('ui-validade-total').innerText = total.toLocaleString('pt-BR');
    if(document.getElementById('ui-validade-custo')) document.getElementById('ui-validade-custo').innerText = 'R$ ' + custo.toLocaleString('pt-BR', {minimumFractionDigits: 2});

    const divLista = document.getElementById('validade-lista-radar'); 
    if(divLista) {
        divLista.innerHTML = '';
        
        const dadosOrdenados = [...dados].sort((a, b) => {
            const dataA = String(a.data_validade).split('/').reverse().join('');
            const dataB = String(b.data_validade).split('/').reverse().join('');
            return dataA.localeCompare(dataB);
        });

        dadosOrdenados.forEach(i => { 
            const r = parseLocalFloat(i.quantidade) * parseLocalFloat(i.custo);
            const enc = encodeURIComponent(JSON.stringify(i));
            
            let dataVencimento;
            let partesData = String(i.data_validade).split('/');
            if (partesData.length === 3) { dataVencimento = new Date(partesData[2], partesData[1] - 1, partesData[0]); } 
            else { dataVencimento = new Date(i.data_validade + 'T00:00:00'); }
            
            let hoje = new Date(); hoje.setHours(0,0,0,0);
            let diffTempo = dataVencimento.getTime() - hoje.getTime();
            let diasRestantes = Math.ceil(diffTempo / (1000 * 3600 * 24));

            let corSinalizacao = "bg-emerald"; 
            if (diasRestantes < 0) corSinalizacao = "bg-red-600 animate-pulse"; 
            else if (diasRestantes <= 15) corSinalizacao = "bg-yellow-500"; 

            const isRebaixado = i.rebaixado === 'SIM';
            const corCard = isRebaixado ? 'border-gold/50 bg-gold/5' : 'border-slate-200 bg-white';
            const corTextoCheck = isRebaixado ? 'text-gold' : 'text-slate-400';

            divLista.innerHTML += `
                <div class="p-3 mb-2 ${corCard} border rounded-lg flex flex-col md:flex-row md:items-center gap-3 shadow-sm min-w-0 transition-all">
                    <div class="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <div class="w-3 h-3 rounded-full shrink-0 ${corSinalizacao}"></div>
                        <div class="flex-1 min-w-0">
                            <p class="font-bold text-navy text-sm mb-1 truncate">${i.descricao || 'Produto'}</p>
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                <span>Vence: <strong class="text-slate-700">${i.data_validade}</strong></span>
                                <span class="text-slate-300">|</span>
                                <span>Qtd: <strong class="text-slate-700">${i.quantidade} un</strong></span>
                                <span class="text-slate-300">|</span>
                                <span>Risco: <strong class="text-red-600">R$ ${r.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center justify-end gap-3 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-3 mt-2 md:mt-0">
                        <label class="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold ${corTextoCheck} hover:text-gold transition-colors uppercase tracking-wider">
                            <input type="checkbox" onchange="window.marcarRebaixaValidade('${enc}', this)" class="w-4 h-4 rounded border-slate-300 text-gold focus:ring-gold cursor-pointer" ${isRebaixado ? 'checked' : ''}>
                            Rebaixado
                        </label>
                        <button onclick="window.abrirModalAuditoria('${enc}')" class="bg-slate-50 hover:bg-slate-200 border border-slate-200 text-navy text-xs font-bold px-4 py-2 rounded-lg transition-colors whitespace-nowrap shadow-sm">
                            Auditar
                        </button>
                    </div>
                </div>
            `;
        });
    }
};

window.marcarRebaixaValidade = async (itemEncoded, checkboxEl) => {
    const item = JSON.parse(decodeURIComponent(itemEncoded));
    const statusRebaixa = checkboxEl.checked ? "SIM" : "NÃO";

    checkboxEl.disabled = true;
    const parentDiv = checkboxEl.closest('.p-3.mb-2');
    if (parentDiv) parentDiv.style.opacity = '0.5';

    const payload = { tipo: "atualizar_rebaixa_validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: item.filial, gtin: item.gtin, data_validade: item.data_validade, rebaixado: statusRebaixa };

    try {
        await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(item.gtin) && i.data_validade === item.data_validade && i.filial === item.filial);
        if(idx > -1) sheetsDataRaw[idx].rebaixado = statusRebaixa;
        window.renderValidadeDashboard();
    } catch(e) {
        alert("Erro ao rebaixar validade.");
        checkboxEl.checked = !checkboxEl.checked; 
    } finally {
        checkboxEl.disabled = false;
        if (parentDiv) parentDiv.style.opacity = '1';
    }
};

window.abrirModalAuditoria = (json) => {
    itemEmAuditoria = JSON.parse(decodeURIComponent(json)); 
    document.getElementById('modal-produto').innerText = itemEmAuditoria.descricao; 
    document.getElementById('modal-vencimento').innerText = itemEmAuditoria.data_validade; 
    document.getElementById('modal-qtd-anterior').innerText = itemEmAuditoria.quantidade; 
    document.getElementById('modal-nova-qtd').value = ''; 
    document.getElementById('modal-auditoria').classList.remove('hidden');
};

document.getElementById('btn-close-modal')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('modal-auditoria').classList.add('hidden'); });

document.getElementById('form-auditoria')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth.currentUser || !itemEmAuditoria) return;
    const payload = { tipo: "atualizar_validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: currentUserFilial, gtin: itemEmAuditoria.gtin, descricao: itemEmAuditoria.descricao, data_validade: itemEmAuditoria.data_validade, quantidade: document.getElementById('modal-nova-qtd').value.replace(',', '.') };
    await submitToSheets(null, 'btn-save-auditoria', '', '', payload, 'Atualizar Posição');
    document.getElementById('modal-auditoria').classList.add('hidden');
});

window.renderFurtosDashboard = () => {
    const fM = document.getElementById('filtro-mes-furtos')?.value; const fF = document.getElementById('filtro-filial-furtos')?.value;
    let dados = sheetsDataRaw.filter(i => i.tipo === 'furto');
    if(fM) dados = dados.filter(i => i.data_ocorrencia && extrairAnoMes(i.data_ocorrencia) === fM);
    if(fF && fF !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(fF).trim());
    
    let tRs = 0; let oMap = {}; let prev = 0; let gMap = { 'Homem': 0, 'Mulher': 0, 'Outro': 0 }; let lMap = {};
    dados.forEach(i => {
        tRs += parseLocalFloat(i.subtotal);
        const k = i.data_hora_registro + "_" + i.filial;
        if(!oMap[k]) oMap[k] = { abordagem: i.abordagem, genero: i.genero, local: i.local };
    });
    
    const ocorr = Object.values(oMap);
    ocorr.forEach(o => {
        if(String(o.abordagem).toLowerCase() === 'preventiva') prev++;
        if(gMap[o.genero] !== undefined) gMap[o.genero]++; else gMap['Outro']++;
        const loc = String(o.local).trim().toUpperCase();
        if(!lMap[loc]) lMap[loc] = 0; lMap[loc]++;
    });

    if(document.getElementById('ui-furto-total-rs')) document.getElementById('ui-furto-total-rs').innerText = 'R$ ' + tRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-furto-total-ocorrencias')) document.getElementById('ui-furto-total-ocorrencias').innerText = ocorr.length;
    if(document.getElementById('ui-furto-preventivo')) document.getElementById('ui-furto-preventivo').innerText = (ocorr.length > 0 ? Math.round((prev / ocorr.length) * 100) : 0) + '%';

    if(document.querySelector("#chart-furtos-perfil") && typeof ApexCharts !== 'undefined') {
        if(chartFurtosPerfilInstance) chartFurtosPerfilInstance.destroy();
        document.querySelector("#chart-furtos-perfil").innerHTML = '';
        chartFurtosPerfilInstance = new ApexCharts(document.querySelector("#chart-furtos-perfil"), { series: Object.values(gMap), labels: Object.keys(gMap), chart: { type: 'donut', height: 260, fontFamily: 'Inter, sans-serif' }, colors:['#0A2540', '#008950', '#eab308'], dataLabels: { enabled: false }, legend: { position: 'bottom' } });
        chartFurtosPerfilInstance.render();
    }
    
    if(document.querySelector("#chart-furtos-locais") && typeof ApexCharts !== 'undefined') {
        if(chartFurtosLocaisInstance) chartFurtosLocaisInstance.destroy();
        document.querySelector("#chart-furtos-locais").innerHTML = '';
        const lArr = Object.keys(lMap).map(k => ({ local: k, qtd: lMap[k] })).sort((a,b) => b.qtd - a.qtd).slice(0, 5);
        chartFurtosLocaisInstance = new ApexCharts(document.querySelector("#chart-furtos-locais"), { series:[{ name: 'Ocorrências', data: lArr.map(l => l.qtd) }], chart: { type: 'bar', height: 260, fontFamily: 'Inter, sans-serif', toolbar: { show: false } }, plotOptions: { bar: { borderRadius: 4, horizontal: true } }, dataLabels: { enabled: false }, xaxis: { categories: lArr.map(l => l.local) }, colors:['#dc2626'] });
        chartFurtosLocaisInstance.render();
    }
};

window.renderPrecoDashboard = () => {
    const fM = document.getElementById('filtro-mes-preco')?.value; const fF = document.getElementById('filtro-filial-preco')?.value;
    let dados = sheetsDataRaw.filter(i => i.tipo === 'auditoria_preco');
    if(fM) dados = dados.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === fM);
    if(fF && fF !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(fF).trim());

    let div = 0; let sp = 0;
    dados.forEach(i => { if (i.sem_preco === 'SIM') sp++; else if (parseLocalFloat(i.preco_sistema) !== parseLocalFloat(i.preco_gondola)) div++; });
    if(document.getElementById('ui-preco-total')) document.getElementById('ui-preco-total').innerText = dados.length;
    if(document.getElementById('ui-preco-divergente')) document.getElementById('ui-preco-divergente').innerText = div;
    if(document.getElementById('ui-preco-sempreco')) document.getElementById('ui-preco-sempreco').innerText = sp;
};

window.renderCaixaDashboard = () => {
    const fM = document.getElementById('filtro-mes-caixa')?.value; const fF = document.getElementById('filtro-filial-caixa')?.value;
    let dados = sheetsDataRaw.filter(i => i.tipo === 'caixa_central');
    if(fM) dados = dados.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === fM);
    if(fF && fF !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(fF).trim());
    let tRs = 0; dados.forEach(i => { tRs += parseLocalFloat(i.valor_falta); });
    if(document.getElementById('ui-caixa-total-ocorrencias')) document.getElementById('ui-caixa-total-ocorrencias').innerText = dados.length;
    if(document.getElementById('ui-caixa-total-rs')) document.getElementById('ui-caixa-total-rs').innerText = 'R$ ' + tRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
};

window.renderTarefasDashboard = () => {
    const divSis = document.getElementById('lista-tarefas-sistema'); const divMan = document.getElementById('lista-tarefas-manuais');
    if(!divSis || !divMan) return;
    const fF = document.getElementById('filtro-filial-tar')?.value;
    let hS = ''; let hM = ''; const h = new Date(); h.setHours(0,0,0,0);
    
    let vals = sheetsDataRaw.filter(i => i.tipo === 'validade' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (fF && fF !== 'todas') vals = vals.filter(i => String(i.filial).trim() === String(fF).trim());
    vals.forEach(v => {
        let pD = String(v.data_validade).split('/'); let dV = pD.length === 3 ? new Date(pD[2], pD[1] - 1, pD[0]) : new Date(v.data_validade + 'T00:00:00');
        let d = Math.ceil((dV.getTime() - h.getTime()) / (1000 * 3600 * 24));
        if(d <= 15 && d >= 0) hS += `<div class="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between"><div class="flex items-center gap-3"><i class="w-5 h-5 text-red-600" data-lucide="alert-triangle"></i><div><p class="text-sm font-bold text-red-800">Risco: ${v.descricao}</p><p class="text-xs text-red-600">Vence em ${d} dias | ${v.filial}</p></div></div><button onclick="window.abrirModalAuditoria('${encodeURIComponent(JSON.stringify(v))}')" class="bg-red-600 text-white text-xs px-3 py-1.5 rounded">Auditar</button></div>`;
    });

    let tars = sheetsDataRaw.filter(i => i.tipo === 'tarefa' && i.status === 'PENDENTE' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (fF && fF !== 'todas') tars = tars.filter(i => String(i.filial).trim() === String(fF).trim());
    tars.forEach(t => { hM += `<div class="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-3"><input type="checkbox" onchange="window.concluirTarefa('${encodeURIComponent(t.titulo)}', '${t.filial}', this)" class="w-5 h-5 rounded cursor-pointer"><div><p class="text-sm font-bold text-navy">${t.titulo}</p><p class="text-xs text-slate-500">Prazo: ${t.prazo} | ${t.filial}</p></div></div>`; });

    divSis.innerHTML = hS || '<p class="text-sm text-slate-400 text-center py-4">Nenhum risco sistêmico.</p>';
    divMan.innerHTML = hM || '<p class="text-sm text-slate-400 text-center py-4">Nenhuma demanda pendente.</p>';
    if(window.lucide) lucide.createIcons();
};

window.concluirTarefa = async (titEnc, fil, chk) => {
    chk.disabled = true; const p = { tipo: "concluir_tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, titulo: decodeURIComponent(titEnc) };
    try {
        await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(p), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        const i = sheetsDataRaw.findIndex(x => x.tipo === 'tarefa' && x.titulo === decodeURIComponent(titEnc) && x.filial === fil && x.status === 'PENDENTE');
        if(i > -1) sheetsDataRaw[i].status = 'CONCLUÍDA'; window.renderTarefasDashboard(); 
    } catch(e) { chk.disabled = false; chk.checked = false; }
};

window.renderListaInventarios = () => {
    const tb = document.getElementById('inv-tbody-consulta'); if(!tb) return;
    const fF = document.getElementById('filtro-filial-inv')?.value;
    let invs = sheetsDataRaw.filter(i => i.tipo === 'inventario' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (fF && fF !== 'todas') invs = invs.filter(i => String(i.filial).trim() === String(fF).trim());
    
    const map = {};
    invs.forEach(i => {
        if(!i.id_inventario) return;
        if(!map[i.id_inventario]) map[i.id_inventario] = { id: i.id_inventario, filial: i.filial, qtdL: 0, fechado: false };
        if(i.status === 'FECHADO' || i.gtin === 'FECHAMENTO') map[i.id_inventario].fechado = true;
        else if (i.gtin !== 'LISTA_DIRIGIDA') map[i.id_inventario].qtdL++;
    });

    const arr = Object.values(map).sort((a,b) => a.fechado !== b.fechado ? (a.fechado ? 1 : -1) : b.id.localeCompare(a.id));
    if(arr.length === 0) { tb.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">Nenhum inventário.</td></tr>'; return; }

    let h = '';
    arr.forEach(i => {
        const badge = i.fechado ? `<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-bold uppercase">Fechado</span>` : `<span class="bg-emerald/10 text-emerald px-2 py-1 rounded text-[10px] font-bold uppercase">Aberto</span>`;
        const btnC = !i.fechado ? `<button onclick="window.abrirTelaBipagem('${i.id}', '${i.filial}')" class="text-xs bg-navy text-white px-3 py-1.5 rounded">Contar</button>` : '';
        h += `<tr class="border-b"><td class="px-6 py-4 font-bold">${i.id}</td><td class="px-6 py-4">${i.filial}</td><td class="px-6 py-4">${badge}</td><td class="px-6 py-4 text-center">${i.qtdL}</td><td class="px-6 py-4 text-right space-x-2">${btnC}</td></tr>`;
    });
    tb.innerHTML = h;
};

window.abrirTelaBipagem = (id, fil) => {
    document.getElementById('inv-tela-selecao').classList.add('hidden'); document.getElementById('inv-tela-bipagem').classList.remove('hidden');
    document.getElementById('ui-inv-id').innerText = id; document.getElementById('ui-inv-filial').innerText = fil;
    document.getElementById('inv-id-oculto').value = id; document.getElementById('inv-filial-oculto').value = fil;
    window.renderHistoricoBipagem(id);
};

window.voltarTelaInventario = () => { document.getElementById('inv-tela-bipagem').classList.add('hidden'); document.getElementById('inv-tela-selecao').classList.remove('hidden'); window.renderListaInventarios(); };

window.iniciarNovoInventario = (e) => {
    const fil = document.getElementById('inv-nova-filial').value; if(!fil) return;
    const nId = 'INV-' + Math.floor(100000 + Math.random() * 900000);
    window.abrirTelaBipagem(nId, fil);
};

window.consultarInventario = () => {
    let b = document.getElementById('inv-id-busca').value.trim().toUpperCase(); if(!b) return;
    if(!b.startsWith('INV-')) b = 'INV-' + b;
    const i = sheetsDataRaw.filter(x => x.tipo === 'inventario' && x.id_inventario === b);
    if(i.length === 0) { alert('Inventário não encontrado.'); return; }
    if(i.some(x => x.status === 'FECHADO')) { alert('Inventário encerrado.'); return; }
    window.abrirTelaBipagem(b, i[0].filial);
};

window.encerrarInventarioAtual = async (e) => {
    const id = document.getElementById('inv-id-oculto').value; const fil = document.getElementById('inv-filial-oculto').value;
    if(!confirm(`Encerrar inventário ${id}?`)) return;
    const p = { tipo: "fechar_inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, id_inventario: id, nao_encontrados:[] };
    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(p) }); sheetsDataRaw.push({ tipo: 'inventario', id_inventario: id, status: 'FECHADO', gtin: 'FECHAMENTO' }); window.voltarTelaInventario(); } catch(err) { alert('Erro ao encerrar.'); }
};

document.getElementById('form-inventario')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const id = document.getElementById('inv-id-oculto').value; const fil = document.getElementById('inv-filial-oculto').value; const l = document.getElementById('inv-lote').value.trim().toUpperCase(); const g = document.getElementById('inv-gtin').value; const d = document.getElementById('inv-desc')?.value||""; const q = document.getElementById('inv-qtd').value;
    const p = { tipo: "inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, lote: l, gtin: g, descricao: d, quantidade: q, id_inventario: id, status: "ABERTO" };
    await submitToSheets(null, 'btn-save-inv', '', '', p, 'Salvar Bipagem');
    sheetsDataRaw.push({ tipo: "inventario", lote: l, gtin: g, descricao: d, quantidade: q, id_inventario: id, status: "ABERTO", filial: fil });
    document.getElementById('inv-gtin').value = ''; setTimeout(() => document.getElementById('inv-gtin').focus(), 100); window.renderHistoricoBipagem(id);
});

window.renderHistoricoBipagem = (id) => {
    const dH = document.getElementById('inv-historico-bipagem'); if(!dH) return;
    const bips = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === id && i.gtin !== 'FECHAMENTO' && i.gtin !== 'LISTA_DIRIGIDA').reverse();
    if(bips.length === 0) { dH.innerHTML = '<p class="text-xs text-slate-400">Nenhum item bipado.</p>'; } 
    else { let h = ''; bips.slice(0, 15).forEach(i => { h += `<div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded mb-1"><div class="flex flex-col"><span class="text-xs font-bold text-navy">${i.gtin}</span></div><span class="text-sm font-black text-emerald">${i.quantidade} un</span></div>`; }); dH.innerHTML = h; }
};

// LISTENERS DE FORMULÁRIOS RESTANTES
document.getElementById('form-quebras')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const fil = document.getElementById('q-filial-lancamento')?.value || currentUserFilial; const h = new Date(); const mF = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    submitToSheets(e.target, 'btn-save-quebra', '', '', { tipo: "quebra", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, mes: mF, gtin: document.getElementById('q-gtin')?.value||"", descricao: document.getElementById('q-desc')?.value||"", quantidade: document.getElementById('q-qtd')?.value||"", custo: document.getElementById('q-custo')?.value||"", motivo: document.getElementById('q-motivo')?.value||"" }, 'Enviar');
});
document.getElementById('form-recebimento')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return; const fil = document.getElementById('r-filial-lancamento')?.value || currentUserFilial;
    submitToSheets(e.target, 'btn-save-recebimento', '', '', { tipo: "recebimento", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, data_entrega: document.getElementById('r-data')?.value||"", quantidade: document.getElementById('r-qtd')?.value||"", custo: document.getElementById('r-custo')?.value||"" }, 'Enviar Registo');
});
document.getElementById('form-validade')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return; const fil = document.getElementById('v-filial-lancamento')?.value || currentUserFilial;
    submitToSheets(e.target, 'btn-save-validade', '', '', { tipo: "validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, gtin: document.getElementById('v-gtin')?.value||"", quantidade: document.getElementById('v-qtd')?.value||"", data_validade: document.getElementById('v-data')?.value||"" }, 'Inserir Radar');
});
document.getElementById('form-auditoria-preco')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return; const fil = document.getElementById('p-filial-lancamento')?.value || currentUserFilial;
    const inpD = document.getElementById('p-data'); const dS = inpD ? inpD.value : "";
    await submitToSheets(e.target, 'btn-save-preco', '', '', { tipo: "auditoria_preco", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, data_auditoria: dS, gtin: document.getElementById('p-gtin')?.value||"", sem_preco: document.getElementById('p-sem-preco')?.value||"NÃO" }, 'Enviar');
    if(inpD) inpD.value = dS; const inG = document.getElementById('p-gtin'); if(inG) setTimeout(() => inG.focus(), 100);
});
document.getElementById('form-caixa-central')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return; const fil = document.getElementById('c-filial-lancamento')?.value || currentUserFilial;
    submitToSheets(e.target, 'btn-save-caixa', '', '', { tipo: "caixa_central", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, valor_falta: document.getElementById('c-valor')?.value||"" }, 'Registrar Falta');
});

document.getElementById('btn-add-prod')?.addEventListener('click', () => {
    const n = document.getElementById('f-prod-nome').value.trim(); const q = parseInt(document.getElementById('f-prod-qtd').value)||0; const p = parseFloat(document.getElementById('f-prod-preco').value.replace(',','.'))||0;
    if(!n || q <= 0 || p < 0) return; produtosFurto.push({ nome: n, qtd: q, preco: p }); document.getElementById('f-prod-nome').value = ''; document.getElementById('f-prod-qtd').value = ''; document.getElementById('f-prod-preco').value = '';
    const lP = document.getElementById('f-lista-produtos'); if(lP) lP.innerHTML += `<li class="text-xs p-1 border mb-1">${n} - ${q}x R$${p}</li>`;
});

document.getElementById('form-furtos')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser || produtosFurto.length === 0) return; const fil = document.getElementById('f-filial')?.value || currentUserFilial;
    await submitToSheets(e.target, 'btn-save-furto', '', '', { tipo: "furto", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: fil, data_ocorrencia: document.getElementById('f-data')?.value||"", genero: document.getElementById('f-genero')?.value||"", abordagem: document.getElementById('f-abordagem')?.value||"", local: document.getElementById('f-local')?.value||"", produtos: produtosFurto }, 'Registrar Sinistro');
    produtosFurto =[]; const lP = document.getElementById('f-lista-produtos'); if(lP) lP.innerHTML = '';
});

document.getElementById('form-tarefas')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    await submitToSheets(e.target, 'btn-save-tar', '', '', { tipo: "tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('t-filial').value, titulo: document.getElementById('t-titulo').value, prazo: document.getElementById('t-prazo').value, status: 'PENDENTE' }, 'Criar Demanda');
});

// ==========================================
// MASTER DATA (AUTOCOMPLETAR GTIN)
// ==========================================
const autocompletarPorGtin = (gtin, inputsAlvo) => {
    const busca = String(gtin).replace(/[^0-9]/g, ''); if(busca.length === 0) return; 
    const produto = produtosMestre.find(p => p.gtin === busca);
    if(produto) {
        if(inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) document.getElementById(inputsAlvo.desc).value = produto.descricao || '';
        if(inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) document.getElementById(inputsAlvo.custo).value = produto.custo || '';
        if(inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) document.getElementById(inputsAlvo.preco).value = produto.preco || '';
    }
};

const mapeamentoGtin =[
    { gtinId: 'inv-gtin', alvos: { desc: 'inv-desc' } },
    { gtinId: 'q-gtin', alvos: { desc: 'q-desc', custo: 'q-custo' } },
    { gtinId: 'p-gtin', alvos: { desc: 'p-desc', preco: 'p-sistema' } },
    { gtinId: 'v-gtin', alvos: { desc: 'v-desc', custo: 'v-custo' } }
];

mapeamentoGtin.forEach(mapa => {
    const inputEan = document.getElementById(mapa.gtinId);
    if(inputEan) {
        inputEan.addEventListener('change', (e) => autocompletarPorGtin(e.target.value, mapa.alvos));
        inputEan.addEventListener('blur', (e) => autocompletarPorGtin(e.target.value, mapa.alvos));
    }
});


// ==========================================
// VIEWS E NAVEGAÇÃO GERAL E ADMIN
// ==========================================
window.showView = (vN) => {['portal-cliente', 'site-principal', 'auth-view', 'view-admin', 'view-client'].forEach(id => { const el = document.getElementById(id); if(el) { el.classList.add('hidden'); el.classList.remove('flex'); } });
    if(vN === 'site-principal') { document.getElementById('site-principal')?.classList.remove('hidden'); } 
    else {
        document.getElementById('portal-cliente')?.classList.remove('hidden'); document.getElementById('portal-cliente')?.classList.add('flex');
        if(vN === 'login') document.getElementById('auth-view')?.classList.remove('hidden');
        if(vN === 'admin') document.getElementById('view-admin')?.classList.remove('hidden');
        if(vN === 'client') { document.getElementById('view-client')?.classList.remove('hidden'); if(window.mudarEstadoSegmento) window.mudarEstadoSegmento('hub'); }
    }
    window.scrollTo(0, 0);
};

window.mudarEstadoSegmento = (est) => {
    const vc = document.getElementById('view-client'); if(vc) { vc.classList.remove('estado-hub', 'estado-varejo', 'estado-industria'); vc.classList.add('estado-' + est); }
    const cS = document.getElementById('container-segmentos'); const mV = document.getElementById('menu-abas'); const mI = document.getElementById('menu-abas-industria');
    if (est === 'hub') { if(mV) mV.classList.add('hidden'); if(mI) mI.classList.add('hidden'); if(cS) cS.classList.remove('hidden'); window.unselectAllTabs(); } 
    else if (est === 'varejo') { if(cS) cS.classList.add('hidden'); if(mI) mI.classList.add('hidden'); if(mV) mV.classList.remove('hidden'); document.getElementById('btn-tab-dash')?.click(); } 
};

window.unselectAllTabs = () => {['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => { 
        const el = document.getElementById(id); if(el) { el.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-white text-slate-500 border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm"; }
    });['wrapper-tab-dash', 'wrapper-tab-form', 'wrapper-tab-recebimento', 'wrapper-tab-validade', 'wrapper-tab-furtos', 'wrapper-tab-preco', 'wrapper-tab-caixa', 'wrapper-tab-inv', 'wrapper-tab-tar'].forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
};['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => {
    const b = document.getElementById(id);
    if(b) {
        b.addEventListener('click', () => {
            window.unselectAllTabs(); b.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center shadow-md";
            const map = {'btn-tab-dash':'wrapper-tab-dash', 'btn-tab-form':'wrapper-tab-form', 'btn-tab-rec':'wrapper-tab-recebimento', 'btn-tab-val':'wrapper-tab-validade', 'btn-tab-furtos':'wrapper-tab-furtos', 'btn-tab-preco':'wrapper-tab-preco', 'btn-tab-caixa':'wrapper-tab-caixa', 'btn-tab-inv':'wrapper-tab-inv', 'btn-tab-tar':'wrapper-tab-tar'};
            document.getElementById(map[id])?.classList.remove('hidden');
        });
    }
});

// ABAS DO ADMIN
const btnUsers = document.getElementById('btn-admin-tab-users');
const btnKpi = document.getElementById('btn-admin-tab-kpi');
if(btnUsers && btnKpi) {
    btnUsers.addEventListener('click', () => { document.getElementById('admin-wrapper-tab-users').classList.remove('hidden'); document.getElementById('admin-wrapper-tab-kpi').classList.add('hidden'); });
    btnKpi.addEventListener('click', () => { document.getElementById('admin-wrapper-tab-kpi').classList.remove('hidden'); document.getElementById('admin-wrapper-tab-users').classList.add('hidden'); });
}

document.getElementById('btn-switch-client')?.addEventListener('click', async () => {
    const emailCli = document.getElementById('input-client-email')?.value.trim().toLowerCase();
    if(!emailCli) { alert("Digite o e-mail do cliente na aba KPI."); return; }
    try {
        const dS = await getDoc(doc(db, 'users_permissions', emailCli));
        if(!dS.exists()) { alert("Cliente não encontrado."); return; }
        const p = dS.data(); currentUserEmpresa = p.company_name; currentUserRole = 'admin'; currentUserFilial = p.unit_name || 'Matriz';
        const qS = await getDocs(collection(db, 'users_permissions'));
        const lF = new Set(); qS.forEach(d => { const dta = d.data(); if(dta.company_name === currentUserEmpresa && dta.unit_name) lF.add(dta.unit_name); });['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial'].forEach(id => {
            const el = document.getElementById(id); if(el) { el.innerHTML=''; Array.from(lF).sort().forEach(f => el.innerHTML+=`<option value="${f}">${f}</option>`); el.value = currentUserFilial; el.disabled = false; }
        });['filtro-filial-quebra', 'filtro-filial-docas', 'filtro-filial-validade', 'filtro-filial-furtos', 'filtro-filial-preco', 'filtro-filial-caixa', 'filtro-filial-inv', 'filtro-filial-tar'].forEach(id => {
            const el = document.getElementById(id); if(el) { el.innerHTML='<option value="todas">Todas</option>'; Array.from(lF).sort().forEach(f => el.innerHTML+=`<option value="${f}">${f}</option>`); el.classList.remove('hidden'); }
        });
        if(document.getElementById('separator-admin')) document.getElementById('separator-admin').innerText = `${currentUserEmpresa} | Visão Consultor`;
        window.showView('client'); window.fetchSheetsDataComHierarquia();
    } catch(e) { alert("Erro ao carregar cliente."); }
});

document.getElementById('btn-switch-admin')?.addEventListener('click', () => window.showView('admin'));

const lF = document.getElementById('login-form');
if(lF) { lF.addEventListener('submit', async (e) => { e.preventDefault(); try { await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (er) { alert("Credenciais inválidas."); } }); }
document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', () => signOut(auth)));

window.loadEmpresasAdmin = async () => {
    const sel = document.getElementById('gc-empresa'); if(!sel) return; sel.innerHTML = '<option value="">A carregar...</option>';
    try { const snap = await getDocs(query(collection(db, 'empresas'))); let opt = '<option value="">Selecione...</option>'; const emp =[]; snap.forEach(d => emp.push(d.data().nome)); emp.sort().forEach(e => opt += `<option value="${e}">${e}</option>`); sel.innerHTML = opt; } catch(e) {}
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (document.getElementById('top-user-email')) document.getElementById('top-user-email').innerText = user.email;
        if (user.email === 'leandro@lucroseguro.com.br' || user.email.includes('leandro')) { 
            window.showView('admin'); window.loadEmpresasAdmin(); 
            if(document.getElementById('btn-switch-admin')) document.getElementById('btn-switch-admin').style.display = 'flex';
        } 
        else {
            if(document.getElementById('btn-switch-admin')) document.getElementById('btn-switch-admin').style.display = 'none';
            try {
                const docSnap = await getDoc(doc(db, 'users_permissions', user.email));
                if (docSnap.exists()) {
                    const p = docSnap.data(); currentUserEmpresa = p.company_name; currentUserFilial = p.unit_name; currentUserRole = p.role || 'operacional';
                    
                    const selectsLançamento =['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial'];
                    const selectsDashboard =['filtro-filial-quebra', 'filtro-filial-docas', 'filtro-filial-validade', 'filtro-filial-furtos', 'filtro-filial-preco', 'filtro-filial-caixa', 'filtro-filial-inv', 'filtro-filial-tar'];
                    
                    if(currentUserRole === 'admin') {
                        const qS = await getDocs(collection(db, 'users_permissions')); const lF = new Set();
                        qS.forEach(d => { const dta = d.data(); if(dta.company_name === currentUserEmpresa && dta.unit_name) lF.add(dta.unit_name); });
                        
                        selectsLançamento.forEach(id => { const el = document.getElementById(id); if(el) { el.innerHTML=''; Array.from(lF).sort().forEach(f => el.innerHTML+=`<option value="${f}">${f}</option>`); el.value = currentUserFilial; el.disabled = false; } });
                        selectsDashboard.forEach(id => { const el = document.getElementById(id); if(el) { el.innerHTML='<option value="todas">Todas</option>'; Array.from(lF).sort().forEach(f => el.innerHTML+=`<option value="${f}">${f}</option>`); el.classList.remove('hidden'); } });
                    } else {
                        selectsLançamento.forEach(id => { const el = document.getElementById(id); if(el) { el.innerHTML = `<option value="${currentUserFilial}">${currentUserFilial}</option>`; el.value = currentUserFilial; el.disabled = true; } });
                        selectsDashboard.forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
                    }

                    if(document.getElementById('separator-admin')) document.getElementById('separator-admin').innerText = currentUserEmpresa + (currentUserRole === 'admin' ? ' | Visão Geral' : ' | ' + currentUserFilial);
                    
                    window.showView('client'); window.fetchSheetsDataComHierarquia(); 
                } else { alert("Acesso Negado."); signOut(auth); }
            } catch(e) { alert("Erro de hierarquia."); signOut(auth); }
        }
    } else { window.showView('site-principal'); }
});

if(window.location.hash === '#login') window.showView('login'); else window.showView('site-principal');
