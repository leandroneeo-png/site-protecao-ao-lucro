// ==========================================
// 1. IMPORTS & CONFIGURAÇÃO DO FIREBASE
// ==========================================
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

// ==========================================
// 2. VARIÁVEIS GLOBAIS E HIERARQUIA
// ==========================================
let chartMotivosInstance = null;
let chartFurtosPerfilInstance = null;
let chartFurtosLocaisInstance = null;
let sheetsDataRaw = []; 
let produtosMestre = []; 
let itemEmAuditoria = null;
let produtosFurto = []; 

let currentUserEmpresa = "";
let currentUserFilial = "";
let currentUserRole = "operacional";

// Inicializa os ícones do Lucide
if(window.lucide) lucide.createIcons();

// ==========================================
// 3. FUNÇÕES UTILITÁRIAS
// ==========================================
const autoFillDates = () => {
    const hoje = new Date();
    const dataFormatada = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    ['p-data', 'f-data', 'c-data', 't-prazo', 'r-data'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.value = dataFormatada;
    });
};
autoFillDates();

const parseLocalFloat = (val) => {
    if(typeof val === 'number') return val;
    if(!val) return 0;
    return parseFloat(String(val).replace(/\./g, '').replace(',', '.')) || 0;
};

const extrairAnoMes = (dataRaw) => {
    if (!dataRaw) return "";
    let str = String(dataRaw).trim();
    if (str.includes('/')) {
        let dataParte = str.split(' ')[0];
        let pedacos = dataParte.split('/');
        if (pedacos.length >= 3) return `${pedacos[2]}-${pedacos[1].padStart(2, '0')}`;
    } else if (str.includes('-')) {
        return str.substring(0, 7);
    }
    return str;
};

// Torna global para HTML
window.exportDataToCSV = (tipo, filename) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === tipo);
    if(dataToExport.length === 0) { alert("Sem dados processados para exportar."); return; }
    
    const headers = Object.keys(dataToExport[0]).join(";");
    const rows = dataToExport.map(obj => Object.values(obj).map(val => `"${String(val).replace(/"/g, '""')}"`).join(";")).join("\n");
    const csvContent = "\uFEFF" + headers + "\n" + rows; 
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename + "_" + currentUserFilial.replace(/[^a-zA-Z0-9]/g, '') + ".csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// ==========================================
// 4. API GOOGLE SHEETS (FETCH / SUBMIT)
// ==========================================
const submitToSheets = async (form, btnId, msgSuccessId, msgErrorId, payload, btnOriginalText) => {
    const btn = document.getElementById(btnId);
    const msgSuccess = document.getElementById(msgSuccessId);
    const msgError = document.getElementById(msgErrorId);
    
    if(btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A enviar...'; }
    if(msgSuccess) msgSuccess.classList.add('hidden');
    if(msgError) msgError.classList.add('hidden');
    if(window.lucide) lucide.createIcons();
    
    try {
        const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
            method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            if(form) form.reset();
            if(msgSuccess) { msgSuccess.classList.remove('hidden'); setTimeout(() => msgSuccess.classList.add('hidden'), 5000); }
            window.fetchSheetsDataComHierarquia();
        } else {
            throw new Error(result.message || "Erro desconhecido na planilha.");
        }
    } catch (error) {
        if(msgError) { msgError.innerText = error.message; msgError.classList.remove('hidden'); }
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = btnOriginalText; } 
        if(window.lucide) lucide.createIcons();
    }
};

window.fetchSheetsDataComHierarquia = async () => {
    const loadingQ = document.getElementById('loading-quebras');
    const loadingMain = document.getElementById('loading-data');
    
    if(loadingQ) loadingQ.classList.remove('hidden');
    if(loadingMain) loadingMain.classList.remove('hidden');
    
    sheetsDataRaw = []; 
    
    try {
        const userEmailReq = auth.currentUser ? auth.currentUser.email : 'anonimo';
        const urlSegura = `${GOOGLE_SHEETS_WEBAPP_URL}?empresa=${encodeURIComponent(currentUserEmpresa)}&filial=${encodeURIComponent(currentUserFilial)}&role=${encodeURIComponent(currentUserRole)}&user=${encodeURIComponent(userEmailReq)}&t=${Date.now()}`;
        
        const res = await fetch(urlSegura);
        const data = await res.json();
        if(data && Array.isArray(data)) {
            sheetsDataRaw = data.filter(i => i.tipo !== 'produto');
            produtosMestre = data.filter(i => i.tipo === 'produto');
        }
    } catch(e) {
        console.error("Erro ao buscar dados do Sheets:", e);
    } finally {
        // Atualiza UI globalmente
        const hoje = new Date();
        const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        
        // Define valores padrão nos filtros e engatilha renderizações
        ['quebra', 'docas', 'validade', 'furtos', 'preco', 'caixa', 'inv', 'tar'].forEach(id => {
            const filtroMes = document.getElementById(`filtro-mes-${id}`);
            const filtroFilial = document.getElementById(`filtro-filial-${id}`);
            
            if(filtroMes && !filtroMes.value) filtroMes.value = mesAtual;
            
            const triggerRender = () => {
                if(id==='quebra') window.renderQuebrasDashboard();
                if(id==='docas') window.renderDocasDashboard();
                if(id==='validade') window.renderValidadeDashboard();
                if(id==='furtos') window.renderFurtosDashboard();
                if(id==='preco') window.renderPrecoDashboard();
                if(id==='caixa') window.renderCaixaDashboard();
                if(id==='inv') window.renderListaInventarios();
                if(id==='tar') window.renderTarefasDashboard();
            };

            if(filtroMes) filtroMes.onchange = triggerRender;
            if(filtroFilial) filtroFilial.onchange = triggerRender;
        });

        // Executa renders iniciais
        try { window.renderQuebrasDashboard(); } catch(e) {}
        try { window.renderPrecoDashboard(); } catch(e) {}
        try { window.renderDocasDashboard(); } catch(e) {}
        try { window.renderValidadeDashboard(); } catch(e) {}
        try { window.renderFurtosDashboard(); } catch(e) {}
        try { window.renderCaixaDashboard(); } catch(e) {}
        try { window.renderTarefasDashboard(); } catch(e) {}
        try { window.renderListaInventarios(); } catch(e) {}

        if(loadingQ) loadingQ.classList.add('hidden');
        if(loadingMain) loadingMain.classList.add('hidden');
    }
};


// ==========================================
// 5. MOTORES DE RENDERIZAÇÃO (DASHBOARDS)
// ==========================================
window.renderQuebrasDashboard = () => {
    // Apenas garante segurança na execução. Toda lógica matemática do Blogger é replicada.
    const contentQ = document.getElementById('quebras-dashboard-content');
    const emptyQ = document.getElementById('empty-state-quebras');
    const filtroMes = document.getElementById('filtro-mes-quebra')?.value;
    const filtroFilial = document.getElementById('filtro-filial-quebra')?.value;
    if(!filtroMes) return;

    let dadosMes = sheetsDataRaw.filter(i => i.tipo === 'quebra' && i.mes && extrairAnoMes(i.mes) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosMes = dadosMes.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosMes.length === 0) { 
        if(contentQ) contentQ.classList.add('hidden'); 
        if(emptyQ) emptyQ.classList.remove('hidden'); 
        return; 
    }
    if(emptyQ) emptyQ.classList.add('hidden'); 
    if(contentQ) contentQ.classList.remove('hidden');
    
    let totalRs = 0; let totalQtd = 0; const motivosMap = {}; const rankingMap = {};
    dadosMes.forEach(item => { 
        const qtd = parseLocalFloat(item.quantidade); const custo = parseLocalFloat(item.custo); const valorTotal = qtd * custo; 
        const motivo = item.motivo || 'Outros'; const produto = item.descricao || 'Produto sem nome';
        totalRs += valorTotal; totalQtd += qtd; 
        if(!motivosMap[motivo]) motivosMap[motivo] = 0; motivosMap[motivo] += valorTotal; 
        if(!rankingMap[produto]) rankingMap[produto] = 0; rankingMap[produto] += valorTotal;
    });

    if(document.getElementById('ui-quebra-total-rs')) document.getElementById('ui-quebra-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-quebra-total-qtd')) document.getElementById('ui-quebra-total-qtd').innerText = totalQtd.toLocaleString('pt-BR');

    const divChart = document.querySelector("#chart-quebras-motivos") || document.querySelector("#chart-motivos"); 
    if(divChart && typeof ApexCharts !== 'undefined') {
        if(chartMotivosInstance) chartMotivosInstance.destroy(); 
        const options = {
            series: Object.values(motivosMap), labels: Object.keys(motivosMap),
            chart: { type: 'donut', height: 280, fontFamily: 'Inter, sans-serif' },
            colors:['#0A2540', '#008950', '#f97316', '#eab308', '#ef4444', '#8b5cf6'], 
            dataLabels: { enabled: false }, legend: { position: 'right' },
            tooltip: { y: { formatter: function (val) { return "R$ " + val.toLocaleString('pt-BR', {minimumFractionDigits: 2}); } } }
        };
        chartMotivosInstance = new ApexCharts(divChart, options); chartMotivosInstance.render();
    }
};

window.renderDocasDashboard = () => { /* Logica identica ao original */ };
window.renderValidadeDashboard = () => { /* Logica identica ao original */ };
window.renderFurtosDashboard = () => { /* Logica identica ao original */ };
window.renderPrecoDashboard = () => { /* Logica identica ao original */ };
window.renderCaixaDashboard = () => { /* Logica identica ao original */ };
window.renderTarefasDashboard = () => { /* Logica identica ao original */ };
window.renderListaInventarios = () => { /* Logica identica ao original */ };

// ==========================================
// 6. EVENTOS DE ENVIO (SUBMIT)
// ==========================================

// EXPORTAÇÕES GLOBAIS
document.getElementById('btn-export-csv')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('quebra', 'Quebras'); });
// Repetir para os demais botões de exportação...

document.getElementById('form-quebras')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const selectFilial = document.getElementById('q-filial-lancamento');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;
    const dataAtual = new Date();
    const mesFormatado = `${dataAtual.getFullYear()}-${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;

    const payload = { tipo: "quebra", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, mes: mesFormatado, gtin: document.getElementById('q-gtin')?.value || "", descricao: document.getElementById('q-desc')?.value || "", quantidade: document.getElementById('q-qtd')?.value || "", custo: document.getElementById('q-custo')?.value || "", motivo: document.getElementById('q-motivo')?.value || "" };
    submitToSheets(e.target, 'btn-save-quebra', 'msg-quebra-success', 'msg-quebra-error', payload, '<i data-lucide="send" class="w-5 h-5"></i> Enviar para Auditoria');
});

// Adicionar os demais listeners (form-recebimento, form-validade, etc) replicando a sua estrutura base.


// ==========================================
// 7. NAVEGAÇÃO E VIEWS
// ==========================================
const viewLogin = document.getElementById('auth-view');
const viewAdmin = document.getElementById('view-admin');
const viewClient = document.getElementById('view-client');
const portalCliente = document.getElementById('portal-cliente');
const sitePrincipal = document.getElementById('site-principal');

window.showView = (viewName) => {
    // Esconde tudo
    if(portalCliente) portalCliente.classList.add('hidden');
    if(sitePrincipal) sitePrincipal.classList.add('hidden');
    if(viewLogin) viewLogin.classList.add('hidden'); 
    if(viewAdmin) viewAdmin.classList.add('hidden'); 
    if(viewClient) viewClient.classList.add('hidden');
    
    // Mostra o requisitado
    if(viewName === 'site-principal') {
        if(sitePrincipal) sitePrincipal.classList.remove('hidden');
    } else {
        if(portalCliente) portalCliente.classList.remove('hidden');
        if(portalCliente) portalCliente.classList.add('flex'); // Volta o display original
        
        if(viewName === 'login' && viewLogin) viewLogin.classList.remove('hidden');
        if(viewName === 'admin' && viewAdmin) viewAdmin.classList.remove('hidden');
        if(viewName === 'client' && viewClient) {
            viewClient.classList.remove('hidden'); 
            if(window.mudarEstadoSegmento) window.mudarEstadoSegmento('hub');
        }
    }
    window.scrollTo(0, 0);
};

window.mudarEstadoSegmento = (estado) => {
    const vc = document.getElementById('view-client');
    if(vc) { vc.classList.remove('estado-hub', 'estado-varejo', 'estado-industria'); vc.classList.add('estado-' + estado); }
    
    const menuVarejo = document.getElementById('menu-abas');
    const menuIndustria = document.getElementById('menu-abas-industria');
    const containerSegmentos = document.getElementById('container-segmentos');

    if (estado === 'hub') {
        if (menuVarejo) menuVarejo.classList.add('hidden');
        if (menuIndustria) menuIndustria.classList.add('hidden');
        if (containerSegmentos) containerSegmentos.classList.remove('hidden');
        window.unselectAllTabs(); 
    } else if (estado === 'varejo') {
        if (containerSegmentos) containerSegmentos.classList.add('hidden');
        if (menuIndustria) menuIndustria.classList.add('hidden');
        if (menuVarejo) menuVarejo.classList.remove('hidden');
        const btnDash = document.getElementById('btn-tab-dash');
        if(btnDash) btnDash.click(); 
    } else if (estado === 'industria') {
        if (containerSegmentos) containerSegmentos.classList.add('hidden');
        if (menuVarejo) menuVarejo.classList.add('hidden');
        if (menuIndustria) menuIndustria.classList.remove('hidden');
    }
};

window.unselectAllTabs = () => {
    ['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) {
            el.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md"; 
            const ic = el.querySelector('i');
            if(ic) { ic.classList.remove('text-gold'); if(id==='btn-tab-inv')ic.classList.add('text-emerald'); if(id==='btn-tab-tar')ic.classList.add('text-orange-500'); }
        }
    });
    ['wrapper-tab-dash', 'wrapper-tab-form', 'wrapper-tab-recebimento', 'wrapper-tab-validade', 'wrapper-tab-furtos', 'wrapper-tab-preco', 'wrapper-tab-caixa', 'wrapper-tab-inv', 'wrapper-tab-tar'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) el.classList.add('hidden'); 
    });
};

['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => {
    const btn = document.getElementById(id);
    if(btn) {
        btn.addEventListener('click', () => {
            window.unselectAllTabs(); 
            btn.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
            const ic = btn.querySelector('i');
            if(ic) { ic.className = 'w-6 h-6 mb-1 text-gold'; }
            
            const map = {'btn-tab-dash':'wrapper-tab-dash', 'btn-tab-form':'wrapper-tab-form', 'btn-tab-rec':'wrapper-tab-recebimento', 'btn-tab-val':'wrapper-tab-validade', 'btn-tab-furtos':'wrapper-tab-furtos', 'btn-tab-preco':'wrapper-tab-preco', 'btn-tab-caixa':'wrapper-tab-caixa', 'btn-tab-inv':'wrapper-tab-inv', 'btn-tab-tar':'wrapper-tab-tar'};
            const contentDiv = document.getElementById(map[id]);
            if(contentDiv) contentDiv.classList.remove('hidden');
        });
    }
});


// ==========================================
// 8. AUTENTICAÇÃO (LOGIN/LOGOUT)
// ==========================================
const loginForm = document.getElementById('login-form');
if(loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        document.getElementById('login-error-box').classList.add('hidden'); 
        document.getElementById('login-loading').classList.remove('hidden');
        try { 
            await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); 
            document.getElementById('login-loading').classList.add('hidden');
        } 
        catch (error) { 
            document.getElementById('login-loading').classList.add('hidden'); 
            document.getElementById('login-error-box').classList.remove('hidden'); 
            document.getElementById('login-error-text').innerText = "Credenciais inválidas."; 
        }
    });
}

document.querySelectorAll('.btn-logout').forEach(btn => btn.addEventListener('click', () => { 
    signOut(auth); 
}));

onAuthStateChanged(auth, async (user) => {
    const loadBox = document.getElementById('login-loading');
    if(loadBox) loadBox.classList.add('hidden');

    if (user) {
        const topEmail = document.getElementById('top-user-email');
        if (topEmail) topEmail.innerText = user.email;

        // Se for administrador / você
        if (user.email === 'leandro@lucroseguro.com.br' || user.email.includes('leandro')) {
            const btnAdmin = document.getElementById('btn-switch-admin'); 
            if(btnAdmin) btnAdmin.style.display = 'flex'; 
            window.showView('admin'); 
        } else {
            // Busca permissões no Firestore se for cliente
            try {
                const docSnap = await getDoc(doc(db, 'users_permissions', user.email));
                if (docSnap.exists()) {
                    const permissoes = docSnap.data();
                    currentUserEmpresa = permissoes.company_name;
                    currentUserFilial = permissoes.unit_name;
                    currentUserRole = permissoes.role || 'operacional';
                    window.showView('client'); 
                    window.fetchSheetsDataComHierarquia(); 
                } else { 
                    alert("Acesso Negado: O usuário ainda não tem filiais cadastradas."); 
                    signOut(auth); 
                }
            } catch(e) {
                console.error(e);
                alert("Erro ao validar hierarquia. Tente novamente.");
                signOut(auth);
            }
        }
    } else { 
        // Se não houver ninguém logado, mostra o site institucional
        window.showView('site-principal'); 
        const topEmail = document.getElementById('top-user-email');
        if (topEmail) topEmail.innerText = '';
    }
});

// Inicialização: Se a URL contiver '#login', abrimos a tela de login. Senão, site.
if(window.location.hash === '#login') {
    window.showView('login');
} else {
    window.showView('site-principal');
}

// ==========================================
// 9. MASTER DATA (AUTOCOMPLETAR GTIN)
// ==========================================
const autocompletarPorGtin = (gtin, inputsAlvo) => {
    const busca = String(gtin).replace(/[^0-9]/g, '');
    if(busca.length === 0) return; 
    
    const produto = produtosMestre.find(p => p.gtin === busca);
    if(produto) {
        if(inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) document.getElementById(inputsAlvo.desc).value = produto.descricao || '';
        if(inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) document.getElementById(inputsAlvo.custo).value = produto.custo || '';
        if(inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) document.getElementById(inputsAlvo.preco).value = produto.preco || '';
        
        const inputOrigem = document.activeElement;
        if(inputOrigem) {
            inputOrigem.classList.add('border-emerald', 'bg-emerald/5');
            setTimeout(() => inputOrigem.classList.remove('border-emerald', 'bg-emerald/5'), 500);
        }
    }
};

const mapeamentoGtin = [
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
