(() => {
  "use strict";

  const API_BASE = "https://ptdtoday-cosmos.ptdtoday.workers.dev";
  const MAX_STEPS = 5;
  const SESSION_KEY = "ptdtoday_cosmos_question_session_v1";

  const el = id => document.getElementById(id);
  const state = {
    challenge: null,
    current: null,
    step: 1,
    selected: "",
    journey: [],
    counts: null,
    sessionId: getSessionId(),
    loading: false
  };

  function getSessionId(){
    try{
      let id = localStorage.getItem(SESSION_KEY);
      if(!id){
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        id = "cq_" + [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
        localStorage.setItem(SESSION_KEY,id);
      }
      return id;
    }catch{
      return "cq_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function clean(v){ return String(v ?? "").replace(/\s+/g," ").trim(); }
  function optionByKey(node,key){ return (node?.options || []).find(o => o.key === key) || null; }
  function modeLabel(mode){
    return ({fact:"Knowledge",supported:"Best-supported",opinion:"World view",prediction:"Prediction"})[mode] || "Cosmos Question";
  }
  function cosmosLabel(node){
    if(node?.answer_mode === "fact") return "Correct answer";
    if(node?.answer_mode === "supported") return "Cosmos view";
    if(node?.answer_mode === "prediction") return "Cosmos view today";
    return "No single correct answer";
  }
  function resultTone(node,key){
    if(!node || node.cosmos_choice === "NONE" || node.answer_mode === "opinion") return "";
    return key === node.cosmos_choice ? "good" : "bad";
  }
  function safePct(n,total){ return total > 0 ? Math.round((n/total)*100) : 0; }

  async function api(path, options={}){
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers:{"Content-Type":"application/json",...(options.headers || {})}
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  }

  function normalizeNode(raw, fallbackId="root"){
    const options = Array.isArray(raw?.options) ? raw.options
      .filter(o => /^[A-E]$/.test(String(o?.key || "")))
      .slice(0,5)
      .map(o => ({key:String(o.key),label:clean(o.label).slice(0,140)})) : [];
    return {
      question_id: clean(raw?.question_id || raw?.node_id || fallbackId).slice(0,120) || fallbackId,
      question: clean(raw?.question).slice(0,280),
      answer_mode: ["fact","supported","opinion","prediction"].includes(raw?.answer_mode) ? raw.answer_mode : "supported",
      cosmos_choice: /^[A-E]$/.test(String(raw?.cosmos_choice || "")) ? String(raw.cosmos_choice) : "NONE",
      answer_explanation: clean(raw?.answer_explanation || raw?.explanation).slice(0,700),
      confidence: clean(raw?.confidence || "medium").slice(0,20),
      options,
      butterfly_label: clean(raw?.butterfly_label || raw?.subject || "").slice(0,90),
      sources: Array.isArray(raw?.sources) ? raw.sources.slice(0,3) : []
    };
  }

  function setView(name){
    for(const id of ["cqPlayer","cqResults","cqFinal","cqCreate"]){
      el(id)?.classList.remove("is-open");
      if(id === "cqPlayer") el(id)?.classList.add("cq-hidden");
    }
    if(name === "player") el("cqPlayer")?.classList.remove("cq-hidden");
    if(name === "results") el("cqResults")?.classList.add("is-open");
    if(name === "final") el("cqFinal")?.classList.add("is-open");
    if(name === "create") el("cqCreate")?.classList.add("is-open");
  }

  function renderJourney(){
    const box = el("cqJourney");
    if(!box) return;
    box.innerHTML = "";
    state.journey.forEach((j,i) => {
      const node = document.createElement("span");
      node.className = "cq-crumb";
      node.textContent = clean(j.label || j.answer_label || j.question).slice(0,70);
      box.appendChild(node);
      if(i < state.journey.length-1){
        const arrow = document.createElement("span");
        arrow.className = "cq-crumb-arrow";
        arrow.textContent = "→";
        box.appendChild(arrow);
      }
    });
  }

  function renderQuestion(){
    const node = state.current;
    if(!node || node.options.length !== 5){
      showError("This Cosmos Question is unavailable.");
      return;
    }
    setView("player");
    el("cqKicker").textContent = state.challenge?.official ? "Today's Cosmos Question" : "Cosmos Question";
    el("cqStep").textContent = `Question ${state.step} of ${MAX_STEPS}`;
    el("cqQuestion").textContent = node.question;
    el("cqMode").textContent = modeLabel(node.answer_mode);
    const wrap = el("cqOptions");
    wrap.querySelectorAll(".cq-option").forEach(btn => btn.remove());
    const positions = ["a","b","c","d","e"];
    node.options.forEach((opt,i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cq-option cq-option-${positions[i]}`;
      btn.dataset.key = opt.key;
      btn.innerHTML = `<span class="cq-option-key">${opt.key}</span><span class="cq-option-label"></span>`;
      btn.querySelector(".cq-option-label").textContent = opt.label;
      btn.addEventListener("click", () => vote(opt.key));
      wrap.appendChild(btn);
    });
    el("cqPrompt").textContent = "Choose before seeing what everyone else and Cosmos think.";
    renderJourney();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function vote(key){
    if(state.loading) return;
    const node = state.current;
    const selected = optionByKey(node,key);
    if(!selected) return;
    state.loading = true;
    state.selected = key;
    el("cqOptions")?.querySelectorAll("button").forEach(b => b.disabled = true);
    el("cqPrompt").textContent = "Counting the world…";

    try{
      const data = await api("/api/cosmos/challenge/vote",{
        method:"POST",
        body:JSON.stringify({
          challenge_id: state.challenge.challenge_id,
          question_id: node.question_id,
          option:key,
          session_id:state.sessionId
        })
      });
      state.counts = data;
      showResults(selected,data);
    }catch(error){
      // Never trap the visitor because analytics/voting is temporarily unavailable.
      showResults(selected,{counts:{A:0,B:0,C:0,D:0,E:0},total:0,approximate:true,error:error.message});
    }finally{
      state.loading = false;
    }
  }

  function showResults(selected,data){
    const node = state.current;
    setView("results");
    const cosmosOpt = optionByKey(node,node.cosmos_choice);
    el("cqYou").textContent = `${selected.key} · ${selected.label}`;
    el("cqYou").className = `cq-result-main ${resultTone(node,selected.key)}`;

    const counts = data?.counts || {};
    const total = Number(data?.total || 0);
    let leader = null;
    for(const opt of node.options){
      const c = Number(counts[opt.key] || 0);
      if(!leader || c > leader.count) leader = {opt,count:c};
    }
    el("cqCrowd").textContent = total > 0 && leader
      ? `${leader.opt.key} · ${leader.opt.label} (${safePct(leader.count,total)}%)`
      : "You're among the first answers";

    el("cqCosmosLabel").textContent = cosmosLabel(node);
    el("cqCosmos").textContent = cosmosOpt ? `${cosmosOpt.key} · ${cosmosOpt.label}` : "No single answer";
    el("cqCosmos").className = `cq-result-main ${cosmosOpt ? "good" : ""}`;

    const bars = el("cqBars");
    bars.innerHTML = "";
    for(const opt of node.options){
      const count = Number(counts[opt.key] || 0);
      const pct = safePct(count,total);
      const row = document.createElement("div");
      row.className = `cq-bar-row${opt.key === selected.key ? " is-selected" : ""}${opt.key === node.cosmos_choice ? " is-cosmos" : ""}`;
      row.innerHTML = `<div class="cq-bar-key">${opt.key}</div><div class="cq-bar-track"><div class="cq-bar-fill"></div></div><div class="cq-bar-pct"></div>`;
      row.querySelector(".cq-bar-fill").style.width = `${Math.max(total ? pct : 0,2)}%`;
      row.querySelector(".cq-bar-pct").textContent = total ? `${pct}% · ${count}` : "—";
      bars.appendChild(row);
    }

    const explanation = node.answer_explanation || "Cosmos will follow the consequence behind your choice rather than treating one future as inevitable.";
    el("cqExplanation").innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = node.answer_mode === "fact" ? "Why: " : node.answer_mode === "supported" ? "Why Cosmos leans this way: " : "Cosmos context: ";
    el("cqExplanation").append(strong,document.createTextNode(explanation));
    const meta = document.createElement("div");
    meta.style.cssText = "margin-top:10px;font-size:12px;color:#7a8495";
    meta.textContent = `${total.toLocaleString()} answer${total === 1 ? "" : "s"}${data?.approximate ? " · live totals may take a moment to settle" : ""}`;
    el("cqExplanation").appendChild(meta);

    const label = clean(selected.label).slice(0,70);
    state.journey.push({
      question_id:node.question_id,
      question:node.question,
      option:selected.key,
      answer_label:selected.label,
      label
    });
    renderJourney();
    el("cqContinue").textContent = state.step >= MAX_STEPS ? "See your Butterfly →" : "Follow this choice →";
  }

  async function continueButterfly(){
    if(state.loading) return;
    if(state.step >= MAX_STEPS){
      showFinal();
      return;
    }
    const last = state.journey[state.journey.length-1];
    state.loading = true;
    el("cqContinue").disabled = true;
    el("cqContinue").textContent = "Brewing the next station…";
    try{
      const data = await api("/api/cosmos/challenge/next",{
        method:"POST",
        body:JSON.stringify({
          challenge_id:state.challenge.challenge_id,
          root_question:state.challenge.question,
          current_question:state.current.question,
          current_question_id:state.current.question_id,
          selected_option:last.option,
          selected_label:last.answer_label,
          journey:state.journey.slice(-5),
          depth:state.step
        })
      });
      state.step += 1;
      state.current = normalizeNode(data.node || data, `step-${state.step}`);
      state.selected = "";
      state.counts = null;
      renderQuestion();
    }catch(error){
      showFinal(`Cosmos could not generate the next fork right now. Your path is saved locally in this session.`);
    }finally{
      state.loading = false;
      el("cqContinue").disabled = false;
    }
  }

  function buildDeepQuestion(){
    const path = state.journey.map(j => j.answer_label).filter(Boolean).join(" → ");
    return `Continue this butterfly-effect journey from the original question "${state.challenge.question}". I chose this path: ${path}. Explore the strongest supported consequences, alternative branches, uncertainty and evidence from here.`;
  }

  function showFinal(extra=""){
    setView("final");
    const path = el("cqFinalPath");
    path.innerHTML = "";
    const root = document.createElement("span");
    root.className = "cq-final-node";
    root.textContent = clean(state.challenge.short_title || state.challenge.title || state.challenge.question).slice(0,70);
    path.appendChild(root);
    for(const j of state.journey){
      const arrow = document.createElement("span"); arrow.textContent = "→"; arrow.style.color="#98a2b3"; path.appendChild(arrow);
      const n = document.createElement("span"); n.className = "cq-final-node"; n.textContent = clean(j.answer_label).slice(0,70); path.appendChild(n);
    }
    const desc = `You made ${state.journey.length} decisions and built a unique consequence path.${extra ? ` ${extra}` : ""}`;
    el("cqFinalText").textContent = desc;
    const deep = buildDeepQuestion();
    const deepUrl = `https://ptdtoday.com/cosmos.html?focus=question&question=${encodeURIComponent(deep)}&new_topic=1`;
    el("cqDeepLink").href = deepUrl;
  }

  async function shareJourney(){
    const path = state.journey.map(j => j.answer_label).join(" → ");
    const text = `I started with “${state.challenge.question}” and my Cosmos Butterfly went: ${path}. Where will yours end?`;
    const url = location.href.split("#")[0];
    try{
      if(navigator.share){
        await navigator.share({title:"My Cosmos Butterfly",text,url});
      }else{
        await navigator.clipboard.writeText(`${text}\n${url}`);
        alert("Butterfly link copied.");
      }
    }catch(error){
      if(error?.name !== "AbortError") alert("Could not open sharing.");
    }
  }

  async function loadChallenge(){
    const embedded = window.COSMOS_CHALLENGE_BOOTSTRAP;
    if(embedded?.question){
      startChallenge(embedded);
      return;
    }
    const params = new URLSearchParams(location.search);
    const id = clean(params.get("id"));
    if(!id){
      openCreate();
      return;
    }
    try{
      const data = await api(`/api/cosmos/challenge/${encodeURIComponent(id)}`,{method:"GET"});
      startChallenge(data.challenge || data);
    }catch(error){
      showError(error.message || "This Cosmos Question could not be loaded.");
    }
  }

  function startChallenge(raw){
    const root = normalizeNode({...raw,question_id:raw.question_id || "root"},"root");
    if(!raw?.challenge_id || !root.question || root.options.length !== 5){
      showError("This Cosmos Question is incomplete.");
      return;
    }
    state.challenge = {
      ...raw,
      challenge_id:clean(raw.challenge_id).slice(0,120),
      question:root.question,
      official:Boolean(raw.official)
    };
    state.current = root;
    state.step = 1;
    state.journey = [];
    document.title = `${root.question} · Cosmos Question`;
    renderQuestion();
  }

  function openCreate(){
    setView("create");
    el("cqCreateInput")?.focus();
  }

  async function createChallenge(){
    const input = el("cqCreateInput");
    const status = el("cqCreateStatus");
    const topic = clean(input?.value);
    if(topic.length < 3){
      status.textContent = "Type a topic, question or idea first.";
      return;
    }
    const button = el("cqCreateSubmit");
    button.disabled = true;
    status.textContent = "Cosmos is building a question and five choices…";
    try{
      const data = await api("/api/cosmos/challenge/create",{
        method:"POST",
        body:JSON.stringify({topic})
      });
      location.href = data.share_url;
    }catch(error){
      status.textContent = error.message || "Could not create the question.";
      button.disabled = false;
    }
  }

  function showError(message){
    const stage = el("cqStage");
    if(!stage) return;
    stage.innerHTML = `<div class="cq-error"></div>`;
    stage.querySelector(".cq-error").textContent = message;
  }

  function wire(){
    el("cqContinue")?.addEventListener("click",continueButterfly);
    el("cqShare")?.addEventListener("click",shareJourney);
    el("cqCreateTop")?.addEventListener("click",openCreate);
    el("cqCreateFromFinal")?.addEventListener("click",openCreate);
    el("cqCreateSubmit")?.addEventListener("click",createChallenge);
    el("cqCreateInput")?.addEventListener("keydown",event => {
      if((event.metaKey || event.ctrlKey) && event.key === "Enter") createChallenge();
    });
    el("cqBackToQuestion")?.addEventListener("click",() => state.challenge ? renderQuestion() : loadChallenge());
  }

  document.addEventListener("DOMContentLoaded",() => {
    wire();
    loadChallenge();
  });
})();
