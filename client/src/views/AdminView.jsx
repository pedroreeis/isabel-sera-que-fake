import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, Check, ChevronLeft, ChevronRight, Copy, Download, Edit3, Eye, FileUp, LogOut, Plus, Save, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import Brand from "../components/Brand.jsx";
import Isabel from "../components/Isabel.jsx";
import Toast from "../components/Toast.jsx";
import { API_URL, apiFetch, setCsrfToken } from "../lib/api.js";

const CATEGORIES = [
  "ciencia", "corpo-saude", "natureza-ambiente", "espaco", "historia-politica",
  "geografia-sociedade", "artes-cultura-religiao", "tecnologia-internet",
  "economia-trabalho", "comportamento-sexualidade-cotidiano",
];

const CATEGORY_LABELS = {
  ciencia: "Ciência", "corpo-saude": "Corpo e saúde", "natureza-ambiente": "Natureza e ambiente",
  espaco: "Espaço", "historia-politica": "História e política", "geografia-sociedade": "Geografia e sociedade",
  "artes-cultura-religiao": "Artes, cultura e religião", "tecnologia-internet": "Tecnologia e internet",
  "economia-trabalho": "Economia e trabalho", "comportamento-sexualidade-cotidiano": "Comportamento e cotidiano",
};

function blankFact() {
  return {
    statement: "", verdict: true, explanation: "", correction: "", category: "ciencia",
    difficulty: 1, tags: [], sensitivity: "general", sources: [{ label: "", url: "" }],
    verifiedAt: new Date().toISOString().slice(0, 10), reviewStatus: "pending", active: true,
  };
}

export default function AdminView() {
  const [session, setSession] = useState({ loading: true, authenticated: false });
  const [password, setPassword] = useState("");
  const [facts, setFacts] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ search: "", category: "", difficulty: "", verdict: "", reviewStatus: "", page: 1 });
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const fileInput = useRef(null);

  const showToast = useCallback((next) => {
    setToast(next);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const loadData = useCallback(async (nextFilters = filters) => {
    const query = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value !== "" && value != null));
    const [factsPayload, dashboard] = await Promise.all([
      apiFetch(`/api/admin/facts?${query}`),
      apiFetch("/api/admin/dashboard"),
    ]);
    setFacts(factsPayload.items || factsPayload.facts || []);
    setPagination(factsPayload.pagination || { page: nextFilters.page || 1, pages: 1, total: factsPayload.total || 0 });
    setStats(dashboard);
  }, [filters]);

  useEffect(() => {
    apiFetch("/api/admin/session")
      .then((payload) => {
        setCsrfToken(payload.csrfToken);
        setSession({ loading: false, authenticated: true });
        return loadData();
      })
      .catch(() => setSession({ loading: false, authenticated: false }));
  }, []);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await apiFetch("/api/admin/session", { method: "POST", body: JSON.stringify({ password }) });
      setCsrfToken(payload.csrfToken);
      setSession({ loading: false, authenticated: true });
      setPassword("");
      await loadData();
    } catch (error) {
      showToast({ type: "error", message: error.message });
    } finally { setBusy(false); }
  }

  async function logout() {
    try { await apiFetch("/api/admin/session", { method: "DELETE" }); } catch { /* session is local too */ }
    setCsrfToken("");
    setSession({ loading: false, authenticated: false });
  }

  async function applyFilters(patch) {
    const next = { ...filters, ...patch, page: patch.page || 1 };
    setFilters(next);
    try { await loadData(next); } catch (error) { showToast({ type: "error", message: error.message }); }
  }

  async function saveFact(fact) {
    setBusy(true);
    try {
      const body = {
        ...fact,
        difficulty: Number(fact.difficulty),
        correction: fact.verdict ? null : fact.correction,
        tags: Array.isArray(fact.tags) ? fact.tags : String(fact.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        sources: fact.sources.filter((source) => source.label && source.url),
      };
      await apiFetch(fact.id ? `/api/admin/facts/${fact.id}` : "/api/admin/facts", { method: fact.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      setEditing(null);
      showToast({ type: "success", message: fact.id ? "Fato atualizado." : "Novo fato adicionado ao catálogo." });
      await loadData();
    } catch (error) { showToast({ type: "error", message: error.message }); }
    finally { setBusy(false); }
  }

  async function duplicate(fact) {
    try {
      const copy = await apiFetch(`/api/admin/facts/${fact.id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setEditing(copy);
      showToast({ type: "success", message: "Cópia criada como pendente e inativa." });
      await loadData();
    } catch (error) {
      showToast({ type: "error", message: error.message });
    }
  }

  async function archive(fact) {
    if (!window.confirm(`Arquivar “${fact.statement}”?`)) return;
    try {
      await apiFetch(`/api/admin/facts/${fact.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
      showToast({ type: "success", message: "Fato arquivado." });
      await loadData();
    } catch (error) { showToast({ type: "error", message: error.message }); }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "json";
      const result = await apiFetch("/api/admin/facts/import/validate", { method: "POST", body: JSON.stringify({ format, content }) });
      setImportPreview({ ...result, format, content, filename: file.name });
    } catch (error) { showToast({ type: "error", message: error.message }); }
    finally { event.target.value = ""; }
  }

  async function confirmImport() {
    setBusy(true);
    try {
      await apiFetch("/api/admin/facts/import", { method: "POST", body: JSON.stringify({ format: importPreview.format, content: importPreview.content }) });
      setImportPreview(null);
      showToast({ type: "success", message: "Importação concluída." });
      await loadData();
    } catch (error) { showToast({ type: "error", message: error.message }); }
    finally { setBusy(false); }
  }

  async function exportCatalog() {
    try {
      const response = await fetch(`${API_URL}/api/admin/facts/export?format=json`, { credentials: "include" });
      if (!response.ok) throw new Error("Não foi possível exportar o catálogo.");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `isabel-catalogo-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) { showToast({ type: "error", message: error.message }); }
  }

  if (session.loading) return <main className="admin-login"><div className="loading-seal"><Sparkles /><span>Isabel está conferindo a chave…</span></div></main>;
  if (!session.authenticated) return (
    <main className="admin-login">
      <section className="admin-login-card">
        <div className="admin-login-art"><Isabel pose="alerta" priority /></div>
        <div className="admin-login-form">
          <Brand compact />
          <span className="eyebrow"><ShieldCheck size={15} /> Área protegida</span>
          <h1>Superadmin</h1>
          <p>Use a senha compartilhada para cuidar do catálogo da Isabel.</p>
          <form onSubmit={login}><label htmlFor="admin-password">Senha do painel</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /><button className="primary-button" disabled={busy}>{busy ? "Conferindo…" : "Abrir o catálogo"}</button></form>
          <a href="/">← Voltar para o jogo</a>
        </div>
      </section>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </main>
  );

  return (
    <main className="admin-page">
      <header className="admin-topbar"><Brand compact /><div className="admin-title"><ShieldCheck size={18} /><span>Superadmin</span></div><a href="/">Ver jogo</a><button className="ghost-button" onClick={logout}><LogOut size={16} /> Sair</button></header>
      <div className="admin-content">
        <section className="admin-heading"><div><span className="eyebrow">Catálogo editorial</span><h1>Os fatos da Isabel</h1><p>Pesquise, audite e publique novas afirmações sem tocar no código.</p></div><div className="admin-actions"><input ref={fileInput} type="file" accept=".json,.csv" hidden onChange={handleImport} /><button className="secondary-button" onClick={() => fileInput.current?.click()}><FileUp size={17} /> Importar</button><button className="secondary-button" onClick={exportCatalog}><Download size={17} /> Exportar</button><button className="primary-button" onClick={() => setEditing(blankFact())}><Plus size={18} /> Novo fato</button></div></section>

        {stats?.pendingReview > 0 && <div className="audit-banner"><AlertTriangle size={21} /><div><strong>{stats.pendingReview} fatos aguardam sua auditoria</strong><span>Eles estão ativos, como solicitado, mas precisam ser conferidos antes da expansão do catálogo.</span></div></div>}

        <section className="stats-grid">
          <article><span>Ativos</span><strong>{stats?.active ?? "—"}</strong><small>no jogo</small></article>
          <article><span>Auditados</span><strong>{stats?.verified ?? "—"}</strong><small>confirmados</small></article>
          <article><span>Verdadeiros</span><strong>{stats?.trueCount ?? "—"}</strong><small>equilíbrio</small></article>
          <article><span>Falsos</span><strong>{stats?.falseCount ?? "—"}</strong><small>equilíbrio</small></article>
          <article><span>Fontes</span><strong>{stats?.sourceCount ?? "—"}</strong><small>referências</small></article>
          <article><span>Fontes vencidas</span><strong>{stats?.staleSourceCount ?? "—"}</strong><small>há mais de {stats?.sourceReviewDays || 365} dias</small></article>
        </section>

        {stats?.matrix && (
          <section className="matrix-panel panel-card">
            <div className="section-heading"><div><span className="eyebrow">Cobertura editorial</span><h2>Categoria × dificuldade</h2></div><span className="count-badge">Meta: 2 por célula</span></div>
            <div className="matrix-table">
              <div className="matrix-head"><span>Categoria</span>{[1,2,3,4,5].map((level) => <strong key={level}>N{level}</strong>)}</div>
              {CATEGORIES.map((category) => (
                <div className="matrix-row" key={category}>
                  <span>{CATEGORY_LABELS[category]}</span>
                  {[1,2,3,4,5].map((difficulty) => {
                    const count = stats.matrix.find((cell) => cell.category === category && Number(cell.difficulty) === difficulty)?.count || 0;
                    return <strong className={count >= 2 ? "complete" : "missing"} key={difficulty}>{count}</strong>;
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="catalog-panel panel-card">
          <div className="catalog-toolbar">
            <label className="search-field"><Search size={17} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && applyFilters({ search: event.currentTarget.value })} placeholder="Buscar no catálogo" /></label>
            <select value={filters.category} onChange={(event) => applyFilters({ category: event.target.value })}><option value="">Todas as categorias</option>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select>
            <select value={filters.difficulty} onChange={(event) => applyFilters({ difficulty: event.target.value })}><option value="">Toda dificuldade</option>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Nível {level}</option>)}</select>
            <select value={filters.verdict} onChange={(event) => applyFilters({ verdict: event.target.value })}><option value="">Fato e fake</option><option value="true">Verdadeiro</option><option value="false">Falso</option></select>
            <select value={filters.reviewStatus} onChange={(event) => applyFilters({ reviewStatus: event.target.value })}><option value="">Toda auditoria</option><option value="pending">Pendente</option><option value="verified">Auditado</option></select>
          </div>

          <div className="catalog-table">
            <div className="catalog-table-head"><span>Afirmação</span><span>Categoria</span><span>Nível</span><span>Resposta</span><span>Auditoria</span><span /></div>
            {facts.map((fact) => (
              <div className={`catalog-row ${!fact.active ? "archived" : ""}`} key={fact.id}>
                <div className="catalog-statement"><strong>{fact.statement}</strong><small>{fact.sources?.[0]?.label || "Sem fonte"}</small></div>
                <span>{CATEGORY_LABELS[fact.category] || fact.category}</span><span className="difficulty-dots" aria-label={`Dificuldade ${fact.difficulty}`}>{[1,2,3,4,5].map((level) => <i className={level <= fact.difficulty ? "filled" : ""} key={level} />)}</span>
                <span className={`verdict-badge ${fact.verdict ? "truth" : "fake"}`}>{fact.verdict ? "Fato" : "Fake"}</span>
                <span className={`review-badge ${fact.reviewStatus}`}>{fact.reviewStatus === "verified" ? <><Check size={13} /> Auditado</> : "Pendente"}</span>
                <div className="row-actions"><button onClick={() => setPreviewing(fact)} title="Visualizar"><Eye size={16} /></button><button onClick={() => setEditing(fact)} title="Editar"><Edit3 size={16} /></button><button onClick={() => duplicate(fact)} title="Duplicar"><Copy size={16} /></button>{fact.active && <button onClick={() => archive(fact)} title="Arquivar"><Archive size={16} /></button>}</div>
              </div>
            ))}
            {!facts.length && <div className="empty-catalog">Nenhum fato encontrado com esses filtros.</div>}
          </div>

          <div className="pagination"><span>{pagination.total || facts.length} fatos</span><div><button disabled={(pagination.page || 1) <= 1} onClick={() => applyFilters({ page: (pagination.page || 1) - 1 })}><ChevronLeft size={17} /></button><span>Página {pagination.page || 1} de {pagination.pages || 1}</span><button disabled={(pagination.page || 1) >= (pagination.pages || 1)} onClick={() => applyFilters({ page: (pagination.page || 1) + 1 })}><ChevronRight size={17} /></button></div></div>
        </section>
      </div>

      {editing && <FactEditor fact={editing} busy={busy} onSave={saveFact} onClose={() => setEditing(null)} />}
      {previewing && <FactPreview fact={previewing} onClose={() => setPreviewing(null)} />}
      {importPreview && <ImportPreview data={importPreview} busy={busy} onConfirm={confirmImport} onClose={() => setImportPreview(null)} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </main>
  );
}

function FactEditor({ fact: initial, busy, onSave, onClose }) {
  const [fact, setFact] = useState(() => ({ ...blankFact(), ...initial, tags: Array.isArray(initial.tags) ? initial.tags.join(", ") : initial.tags, sources: initial.sources?.length ? initial.sources : [{ label: "", url: "" }] }));
  const patch = (next) => setFact((current) => ({ ...current, ...next }));
  const updateSource = (index, next) => patch({ sources: fact.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...next } : source) });
  return <div className="modal-backdrop"><section className="admin-modal editor-modal"><header><div><span className="eyebrow">{fact.id ? "Editar catálogo" : "Adicionar ao catálogo"}</span><h2>{fact.id ? "Revisar fato" : "Novo fato"}</h2></div><button onClick={onClose}><X /></button></header><form onSubmit={(event) => { event.preventDefault(); onSave(fact); }}>
    <label className="full-field">Afirmação<textarea rows={3} maxLength={220} value={fact.statement} onChange={(event) => patch({ statement: event.target.value })} required /><small>{fact.statement.length}/220</small></label>
    <div className="form-grid"><label>Categoria<select value={fact.category} onChange={(event) => patch({ category: event.target.value })}>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label><label>Dificuldade<select value={fact.difficulty} onChange={(event) => patch({ difficulty: Number(event.target.value) })}>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Nível {level}</option>)}</select></label><fieldset><legend>Gabarito</legend><div className="truth-toggle"><button type="button" className={fact.verdict ? "selected true" : ""} onClick={() => patch({ verdict: true })}>É fato</button><button type="button" className={!fact.verdict ? "selected false" : ""} onClick={() => patch({ verdict: false })}>É fake</button></div></fieldset><label>Sensibilidade<select value={fact.sensitivity} onChange={(event) => patch({ sensitivity: event.target.value })}><option value="general">Geral</option><option value="mature_non_graphic">Adulto não gráfico</option></select></label></div>
    <label className="full-field">Explicação<textarea rows={4} maxLength={520} value={fact.explanation} onChange={(event) => patch({ explanation: event.target.value })} required /></label>
    {!fact.verdict && <label className="full-field">Correção objetiva<textarea rows={2} maxLength={240} value={fact.correction || ""} onChange={(event) => patch({ correction: event.target.value })} required /></label>}
    <div className="form-grid"><label>Tags<input value={fact.tags} onChange={(event) => patch({ tags: event.target.value })} placeholder="ciência, curiosidade" /></label><label>Verificado em<input type="date" value={fact.verifiedAt?.slice(0, 10) || ""} onChange={(event) => patch({ verifiedAt: event.target.value })} /></label><label>Status<select value={fact.reviewStatus} onChange={(event) => patch({ reviewStatus: event.target.value })}><option value="pending">Pendente</option><option value="verified">Auditado</option></select></label><label className="switch-label"><input type="checkbox" checked={fact.active} onChange={(event) => patch({ active: event.target.checked })} /><span /> Ativo no jogo</label></div>
    <div className="sources-editor"><div className="sources-heading"><strong>Fontes</strong><button type="button" onClick={() => patch({ sources: [...fact.sources, { label: "", url: "" }] })}><Plus size={15} /> Adicionar</button></div>{fact.sources.map((source, index) => <div className="source-editor-row" key={index}><input value={source.label} onChange={(event) => updateSource(index, { label: event.target.value })} placeholder="Instituição ou título" required /><input type="url" value={source.url} onChange={(event) => updateSource(index, { url: event.target.value })} placeholder="https://…" required /><button type="button" onClick={() => patch({ sources: fact.sources.filter((_, sourceIndex) => sourceIndex !== index) })} disabled={fact.sources.length === 1}><X size={16} /></button></div>)}</div>
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}><Save size={18} /> {busy ? "Salvando…" : "Salvar fato"}</button></footer>
  </form></section></div>;
}

function FactPreview({ fact, onClose }) {
  return <div className="modal-backdrop"><section className="admin-modal preview-modal"><header><div><span className="eyebrow">Prévia no jogo</span><h2>Como a afirmação aparece</h2></div><button onClick={onClose}><X /></button></header><div className="preview-stage"><div className="question-card"><span className="question-kicker"><Sparkles size={15} /> Isabel ouviu dizer que…</span><h3>{fact.statement}</h3><span className="category-pill">{CATEGORY_LABELS[fact.category]}</span></div><Isabel pose="fala" /></div><div className="preview-reveal"><strong className={fact.verdict ? "truth" : "fake"}>{fact.verdict ? "É FATO" : "É FAKE"}</strong><p>{fact.explanation}</p>{fact.correction && <small>O correto: {fact.correction}</small>}</div></section></div>;
}

function ImportPreview({ data, busy, onConfirm, onClose }) {
  const errors = data.errors || [];
  return <div className="modal-backdrop"><section className="admin-modal import-modal"><header><div><span className="eyebrow">Simulação da importação</span><h2>{data.filename}</h2></div><button onClick={onClose}><X /></button></header><div className={`import-summary ${errors.length ? "has-errors" : ""}`}>{errors.length ? <AlertTriangle /> : <Check />}<div><strong>{data.validCount ?? data.items?.length ?? 0} fatos válidos</strong><span>{errors.length ? `${errors.length} problemas precisam ser corrigidos.` : "Tudo pronto para entrar no catálogo."}</span></div></div>{errors.length > 0 && <ul className="import-errors">{errors.slice(0, 12).map((error, index) => <li key={index}>Linha {error.row || index + 1}: {error.message || error}</li>)}</ul>}<footer><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || errors.length > 0} onClick={onConfirm}><FileUp size={17} /> Importar agora</button></footer></section></div>;
}
