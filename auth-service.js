/* Supabase Auth + narrowly scoped PostgREST client. This browser may contain only
   the project's publishable/anon key; row-level security protects all records. */
(function () {
  "use strict";
  const config = window.SITE_CONFIG || {};
  const base = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const key = String(config.supabaseAnonKey || "");
  const storageKey = "wu-jin-qi-yong:auth-session:v1";
  const ready = Boolean(base && key);
  let session = null;
  let mode = "login";
  let identity = null;
  const $ = (selector) => document.querySelector(selector);
  const parse = async (response) => {
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!response.ok) {
      const error = new Error(body.msg || body.message || body.error_description || body.error || "请求失败（" + response.status + "）");
      error.status = response.status;
      error.code = body.code || body.error_code || "";
      error.details = body.details || "";
      throw error;
    }
    return body;
  };
  const authHeaders = (token) => ({ apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) });
  async function authRequest(path, body, token, method) {
    const response = await fetch(base + "/auth/v1/" + path, { method: method || "POST", headers: authHeaders(token), body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    return parse(response);
  }
  function readSession() {
    try { session = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { session = null; }
    return session;
  }
  function writeSession(value) {
    session = value && value.access_token ? value : null;
    try { if (session) localStorage.setItem(storageKey, JSON.stringify(session)); else localStorage.removeItem(storageKey); } catch { /* private browsing can disable storage */ }
  }
  async function refreshIfNeeded() {
    if (!session) readSession();
    if (!session) return null;
    if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return session;
    if (!session.refresh_token) { writeSession(null); return null; }
    try {
      const next = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      next.expires_at = Math.floor(Date.now() / 1000) + Number(next.expires_in || 3600);
      writeSession(next);
      return next;
    } catch { writeSession(null); return null; }
  }
  async function rest(path, options = {}) {
    const active = await refreshIfNeeded();
    if (!active) throw new Error("请先登录并验证邮箱。");
    const url = new URL(base + "/rest/v1/" + path);
    Object.entries(options.query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: { ...authHeaders(active.access_token), ...(options.prefer ? { Prefer: options.prefer } : {}), ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store"
    });
    return parse(response);
  }
  const currentToken = async () => (await refreshIfNeeded())?.access_token || "";
  const cleanCallbackUrl = () => history.replaceState(null, "", location.pathname + location.search);
  async function handleAuthCallback() {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const tokenHash = query.get("token_hash");
    const verifyType = query.get("type");
    if (tokenHash && ["signup", "recovery", "email"].includes(verifyType)) {
      const result = await authRequest("verify", { token_hash: tokenHash, type: verifyType });
      if (result.access_token) {
        result.expires_at = Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600);
        writeSession(result);
      }
      cleanCallbackUrl();
      mode = verifyType === "recovery" ? "reset" : "login";
      return verifyType === "recovery" ? "邮箱验证完成，请设置新密码。" : "邮箱验证完成，请登录。";
    }
    const type = hash.get("type");
    const accessToken = hash.get("access_token");
    if (accessToken && ["recovery", "signup", "magiclink"].includes(type)) {
      writeSession({ access_token: accessToken, refresh_token: hash.get("refresh_token"), expires_at: Number(hash.get("expires_at") || (Date.now() / 1000 + Number(hash.get("expires_in") || 3600))), token_type: hash.get("token_type") || "bearer" });
      cleanCallbackUrl();
      if (type === "recovery") { mode = "reset"; return "验证通过。请设置新密码。"; }
      return "邮箱验证完成，请登录。";
    }
    return "";
  }
  async function profileFor(user) {
    const rows = await rest("profiles", { query: { select: "id,display_name,role", id: "eq." + user.id, limit: "1" } });
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile) throw new Error("账号资料尚未初始化，请稍后重试或联系管理员。");
    return { id: user.id, email: user.email, displayName: profile.display_name || user.email, role: profile.role === "admin" ? "admin" : "user" };
  }
  async function getIdentity() {
    const active = await refreshIfNeeded();
    if (!active) return null;
    try {
      const user = await authRequest("user", undefined, active.access_token, "GET");
      identity = await profileFor(user);
      return identity;
    } catch (error) {
      if (error.status === 401) writeSession(null);
      throw error;
    }
  }
  const redirectUrl = () => location.origin + location.pathname;
  async function signIn(email, password) {
    const result = await authRequest("token?grant_type=password", { email, password });
    result.expires_at = Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600);
    writeSession(result);
    identity = await profileFor(result.user);
    return identity;
  }
  async function signUp(email, password, displayName) {
    const result = await authRequest("signup?redirect_to=" + encodeURIComponent(redirectUrl()), { email, password, data: { display_name: displayName } });
    if (result.access_token) {
      result.expires_at = Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600);
      writeSession(result);
      identity = await profileFor(result.user);
      return { identity, confirmationRequired: false };
    }
    return { identity: null, confirmationRequired: true };
  }
  async function signOut() {
    const active = await refreshIfNeeded();
    try { if (active) await authRequest("logout", {}, active.access_token); } catch { /* local session must still be cleared */ }
    identity = null;
    writeSession(null);
  }
  async function loadChat(reservationId) {
    window.currentConversationId = "";
    const rows = await rest("rpc/start_reservation_conversation", { method: "POST", body: { target_reservation: reservationId } });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async function sendMessage(conversationId, body) {
    return rest("messages", { method: "POST", body: { conversation_id: conversationId, sender_id: identity?.id, body }, prefer: "return=representation" });
  }
  async function listMessages(conversationId) {
    return rest("messages", { query: { select: "id,conversation_id,sender_id,body,created_at", conversation_id: "eq." + conversationId, order: "created_at.asc", limit: "100" } });
  }
  async function renderMessages(conversationId) {
    const thread = $("#chatThread");
    if (!thread) return;
    try {
      const rows = await listMessages(conversationId);
      const mine = identity?.id;
      thread.innerHTML = rows.length ? rows.map((message) => '<article class="chat-message ' + (message.sender_id === mine ? "mine" : "") + '"><p>' + escapeHtml(message.body) + '</p><time>' + escapeHtml(new Date(message.created_at).toLocaleString("zh-CN", { hour12: false })) + '</time></article>').join("") : '<p class="chat-empty">还没有消息，可以发送第一条。</p>';
      thread.scrollTop = thread.scrollHeight;
    } catch (error) { thread.innerHTML = '<p class="chat-empty">' + escapeHtml(error.message) + "</p>"; }
  }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function setMode(next) {
    mode = next;
    const signup = next === "signup";
    const forgot = next === "forgot";
    const reset = next === "reset";
    const resend = next === "resend";
    $("#authDisplayName").hidden = !signup;
    $("#authDisplayNameLabel").hidden = !signup;
    $("#loginAccount").hidden = reset;
    $("label[for='loginAccount']").hidden = reset;
    $("#loginAccount").required = !reset;
    $("#authRepeatPassword").hidden = !(signup || reset);
    $("#authRepeatPasswordLabel").hidden = !(signup || reset);
    $("#loginPassword").hidden = forgot || resend;
    $("label[for='loginPassword']").hidden = forgot || resend;
    $("#loginPassword").required = !(forgot || resend);
    $("#loginPassword").autocomplete = signup || reset ? "new-password" : "current-password";
    $("#authRepeatPassword").required = signup || reset;
    $("#authDisplayName").required = signup;
    $("#authSubmit").innerHTML = (signup ? "创建账号" : forgot ? "发送重置邮件" : reset ? "保存新密码" : resend ? "重新发送验证邮件" : "登录") + " <span>→</span>";
    $("#authIntro").textContent = signup ? "创建账号后，打开邮箱中的验证链接即可登录。" : forgot ? "输入注册邮箱，我们会发送密码重置链接。" : reset ? "为账号设置一个至少 8 位的新密码。" : resend ? "重新发送验证邮件。" : "使用邮箱登录，或注册新账号开始预约。";
    $("#authLinks").hidden = signup || forgot || reset || resend;
    $("#authSecondaryLinks").hidden = !(signup || forgot || reset || resend);
    $("#loginError").textContent = "";
  }
  async function submitForm(event) {
    event.preventDefault();
    if (!ready) { setMessage("认证服务尚未配置，暂时不能登录或注册。", true); return; }
    const email = $("#loginAccount").value.trim().toLowerCase();
    const password = $("#loginPassword").value;
    const repeated = $("#authRepeatPassword").value;
    const message = $("#loginError");
    message.textContent = "正在处理…";
    try {
      if (mode === "signup") {
        if (password !== repeated) throw new Error("两次输入的密码不一致。");
        if (password.length < 8) throw new Error("密码至少需要 8 位。");
        const result = await signUp(email, password, $("#authDisplayName").value.trim());
        if (result.confirmationRequired) { setMode("login"); setMessage("注册信息已提交。请到邮箱打开验证链接，再返回此页面登录。", false); }
        else { dispatchIdentity(result.identity); }
      } else if (mode === "forgot" || mode === "resend") {
        if (!email) throw new Error("请先填写邮箱地址。");
        const path = mode === "forgot" ? "recover" : "resend";
        const body = mode === "forgot" ? { email } : { type: "signup", email };
        await authRequest(path + "?redirect_to=" + encodeURIComponent(redirectUrl()), body);
        setMessage(mode === "forgot" ? "如果该邮箱已注册，系统会发送密码重置邮件。" : "验证邮件已重新发送，请查收邮箱。", false);
      } else if (mode === "reset") {
        if (password.length < 8) throw new Error("密码至少需要 8 位。");
        if (password !== repeated) throw new Error("两次输入的密码不一致。");
        const active = await refreshIfNeeded();
        if (!active) throw new Error("重置链接无效或已过期，请重新申请密码重置邮件。");
        await authRequest("user", { password }, active.access_token, "PUT");
        await signOut();
        setMode("login");
        setMessage("密码已更新，请使用新密码登录。", false);
      } else {
        dispatchIdentity(await signIn(email, password));
      }
    } catch (error) { setMessage(error.message || "操作失败，请稍后重试。", true); }
  }
  function setMessage(text, error) { const node = $("#loginError"); if (node) { node.textContent = text; node.classList.toggle("is-error", Boolean(error)); node.classList.toggle("is-success", !error); } }
  function dispatchIdentity(value) { identity = value; document.dispatchEvent(new CustomEvent("auth:session", { detail: value })); }
  async function init() {
    if (!ready) { $("#authSetupNote").hidden = false; $("#authSubmit").disabled = true; $("#loginAccount").disabled = true; $("#loginPassword").disabled = true; setMessage("请先配置 Supabase 项目地址和 publishable key。", true); return null; }
    $("#authSetupNote").hidden = true;
    const callbackMessage = await handleAuthCallback().catch((error) => "验证链接无效或已过期：" + error.message);
    if (mode === "reset") setMode("reset");
    if (callbackMessage) setMessage(callbackMessage, false);
    readSession();
    if (mode === "reset") return null;
    return getIdentity();
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#loginForm")?.addEventListener("submit", submitForm);
    document.querySelectorAll("[data-auth-action]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.authAction)));
    $("#loginPassword")?.addEventListener("input", () => { $("#authRepeatPassword").setCustomValidity(""); });
    $("#authRepeatPassword")?.addEventListener("input", () => $("#authRepeatPassword").setCustomValidity($("#authRepeatPassword").value === $("#loginPassword").value ? "" : "两次输入的密码不一致"));
    $("#contactDialog")?.addEventListener("close", () => clearInterval(window.chatRefreshTimer));
    $("#chatForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const conversationId = window.currentConversationId;
      const textarea = $("#chatMessage");
      const body = textarea.value.trim();
      if (!conversationId || !body) return;
      const button = $("#chatForm button"); button.disabled = true;
      try { await sendMessage(conversationId, body); textarea.value = ""; await renderMessages(conversationId); }
      catch (error) { const note = $("#chatPrivacyNote"); note.textContent = error.message; note.classList.add("is-error"); }
      finally { button.disabled = false; }
    });
  });
  window.AuthService = Object.freeze({ configured: ready, init, getIdentity, signOut, rest, get token() { return currentToken(); }, async startChat(reservationId) { const conversation = await loadChat(reservationId); window.currentConversationId = conversation.conversation_id || conversation.id; await renderMessages(window.currentConversationId); return conversation; }, refreshChat: renderMessages, sendMessage, setMode });
})();
