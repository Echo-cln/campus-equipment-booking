/* Real shared workflow records. No reservations, conversations or reports are
   written to browser storage; all access is checked by Supabase RLS. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let identity=null, devices=[];
  const labels={pending:"待管理员确认",confirmed:"已确认",cancel_requested:"申请取消",completed:"已完成",cancelled:"已取消"};
  const category={"设备维护":"maintenance","设备故障":"fault","使用提醒":"notice","项目更新":"update"};
  function setContext(user){ identity=user; $("#adminService").hidden=user?.role!=="admin"; }
  function deviceOptions(){
    for(const id of ["issueDevice","maintenanceDevice","waitlistDevice","equipmentEditDevice"]){
      const select=$("#"+id); if(!select) continue;
      const old=select.value;
      select.innerHTML='<option value="">选择设备</option>'+devices.map(d=>'<option value="'+esc(d.No)+'">'+esc(d.Name+' · '+d.No)+'</option>').join("");
      if(devices.some(d=>d.No===old)) select.value=old;
    }
    const edit=$("#equipmentEditDevice"); if(edit) edit.onchange=()=>{
      const d=devices.find(x=>x.No===edit.value);if(!d)return;
      $("#equipmentCategory").value=d.category||"";$("#equipmentLocation").value=d.location||"";$("#equipmentModel").value=d.model||"";$("#equipmentHours").value=d.availableTime||"";$("#equipmentDuration").value=d.maxDurationMinutes||"";$("#equipmentStatusNote").value=d.statusNote||"";$("#equipmentDescription").value=d.description||"";
    };
  }
  async function rows(table,query={}){return window.AuthService.rest(table,{query:{select:"*",order:"created_at.desc",...query}});}
  function dateTime(value){return new Date(value).toLocaleString("zh-CN",{hour12:false});}
  function feedback(message,error=false){const n=$("#workflowFeedback");if(n){n.textContent=message;n.classList.toggle("is-error",error);n.classList.toggle("is-visible",Boolean(message));}}
  async function loadReservations(){
    const node=$("#workflowReservations"); if(!node||!identity)return;
    try{
      const data=await rows("reservations",{select:"id,owner_id,device_no,starts_at,ends_at,purpose,status,allow_coordination,created_at",order:"starts_at.desc"});
      $("#reservationCount").textContent=data.length+" 条";
      node.innerHTML=data.length?data.map(r=>{
        const d=devices.find(x=>x.No===r.device_no); const own=r.owner_id===identity.id;
        const device=d?d.Name:r.device_no;
        const buttons=(identity.role==="admin"&&r.status==="pending"?'<button type="button" class="text-button" data-reservation-state="confirmed" data-reservation="'+r.id+'">确认预约</button>':'')+(own&&["pending","confirmed"].includes(r.status)?'<button type="button" class="text-button" data-reservation-state="cancelled" data-reservation="'+r.id+'">取消预约</button>':'');
        return '<article class="workflow-reservation"><div class="workflow-reservation-top"><span class="workflow-status">'+esc(labels[r.status]||r.status)+'</span><time>'+esc(dateTime(r.created_at))+'</time></div><div class="workflow-reservation-main"><h4>'+esc(device)+'</h4><span>'+esc(r.device_no)+'</span></div><div class="workflow-reservation-meta"><span>'+esc(dateTime(r.starts_at))+' — '+esc(dateTime(r.ends_at))+'</span><strong>'+esc(own?"我的预约":"校园预约")+'</strong></div><p class="reservation-purpose">用途：'+esc(r.purpose)+'</p><div class="reservation-actions">'+buttons+'</div></article>';
      }).join(""):'<p class="workflow-empty">还没有云端预约记录。提交预约后，状态会显示在这里。</p>';
      $$('[data-reservation-state]').forEach(b=>b.addEventListener("click",()=>updateReservation(b.dataset.reservation,b.dataset.reservationState)));
    }catch(e){node.innerHTML='<p class="workflow-empty">读取预约失败：'+esc(e.message)+'</p>';}
  }
  async function updateReservation(id,status){
    try{await window.AuthService.rest("reservations",{method:"PATCH",query:{id:"eq."+id},body:{status},prefer:"return=representation"}); await refresh();}
    catch(e){feedback("更新失败："+e.message,true);}
  }
  async function loadIssues(){
    const mine=$("#myIssueList"), admin=$("#adminIssueList"); if(!identity)return;
    try{
      const data=await rows("issues",{select:"id,device_no,reported_by,description,status,created_at",order:"created_at.desc"});
      const html=data.map(r=>'<article class="compact-record"><div><strong>'+esc(devices.find(d=>d.No===r.device_no)?.Name||r.device_no)+'</strong><span>'+esc(({open:"待处理",in_progress:"处理中",resolved:"已解决"})[r.status]||r.status)+'</span></div><p>'+esc(r.description)+'</p><small>'+esc(dateTime(r.created_at))+'</small>'+(identity.role==="admin"&&r.status!=="resolved"?'<button type="button" class="text-button" data-issue="'+r.id+'" data-status="'+(r.status==="open"?"in_progress":"resolved")+'">'+(r.status==="open"?"接手处理":"标记解决")+'</button>':"")+'</article>').join("")||'<p class="workflow-empty">暂无问题记录。</p>';
      if(mine) mine.innerHTML=html; if(admin) admin.innerHTML=identity.role==="admin"?html:'<p class="workflow-empty">管理员可在此查看并处理全站报修。</p>';
      $$('[data-issue]').forEach(b=>b.addEventListener("click",async()=>{try{await window.AuthService.rest("issues",{method:"PATCH",query:{id:"eq."+b.dataset.issue},body:{status:b.dataset.status},prefer:"return=representation"});await refresh();}catch(e){feedback("处理失败："+e.message,true);}}));
    }catch(e){if(mine)mine.innerHTML='<p class="workflow-empty">报修记录暂不可用：'+esc(e.message)+'</p>';}
  }
  async function loadMaintenance(){
    const mine=$("#maintenanceList"),pub=$("#publicMaintenanceList");if(!identity)return;
    try{const data=await rows("maintenance_windows",{select:"id,device_no,starts_at,ends_at,note,created_at",starts_at:"gte."+new Date().toISOString(),order:"starts_at.asc"});
      const html=data.map(r=>'<article class="compact-record"><div><strong>'+esc(devices.find(d=>d.No===r.device_no)?.Name||r.device_no)+'</strong><span>'+esc(dateTime(r.starts_at))+'</span></div><p>'+esc(r.note)+'</p></article>').join("")||'<p class="workflow-empty">近期没有维护安排。</p>';
      if(mine)mine.innerHTML=identity.role==="admin"?html:"<p class=\"workflow-empty\">维护安排由管理员发布。</p>";if(pub)pub.innerHTML=html;
    }catch(e){if(pub)pub.innerHTML='<p class="workflow-empty">维护安排暂不可用：'+esc(e.message)+'</p>';}
  }
  async function loadAnnouncements(){
    if(!identity)return;
    try{const data=await rows("announcements",{select:"id,title,body,category,device_no,published_at",order:"published_at.desc",limit:"20"});
      const label={maintenance:"设备维护",fault:"设备故障",notice:"使用提醒",update:"项目更新"};
      const html=data.map(r=>'<article class="notice-card"><span class="notice-tag">'+esc(label[r.category]||r.category)+' · '+esc(new Date(r.published_at).toLocaleDateString("zh-CN"))+'</span><h3>'+esc(r.title)+'</h3><p>'+esc(r.body)+'</p>'+(r.device_no?'<small>'+esc(r.device_no)+'</small>':"")+'</article>').join("")||'<p class="workflow-empty">暂无已发布公告。</p>';
      for(const id of ["publicNoticeList","adminNoticeList"]){const n=$("#"+id);if(n)n.innerHTML=html;}
      const section=$("#noticeGrid");if(section)section.innerHTML=html;
    }catch(e){const node=$("#publicNoticeList");if(node)node.innerHTML='<p class="workflow-empty">公告暂不可用：'+esc(e.message)+'</p>';}
  }
  async function loadWaitlist(){
    const node=$("#myWaitlist");if(!node||!identity)return;
    try{const data=await rows("waitlist",{select:"id,device_no,preferred_date,status,created_at",owner_id:"eq."+identity.id,order:"preferred_date.asc"});
      node.innerHTML=data.map(r=>'<article class="compact-record"><div><strong>候补 · '+esc(devices.find(d=>d.No===r.device_no)?.Name||r.device_no)+'</strong><span>'+esc(r.status==="waiting"?"等待空档":"已更新")+'</span></div><small>'+esc(r.preferred_date)+'</small><button type="button" class="text-button" data-waitlist-cancel="'+r.id+'">取消候补</button></article>').join("")||"";
      $$('[data-waitlist-cancel]').forEach(b=>b.addEventListener("click",async()=>{try{await window.AuthService.rest("waitlist",{method:"DELETE",query:{id:"eq."+b.dataset.waitlistCancel}});await loadWaitlist();feedback("已取消候补登记。");}catch(e){feedback("取消失败："+e.message,true);}}));
    }catch(e){node.innerHTML='<p class="workflow-empty">候补暂不可用：'+esc(e.message)+'</p>';}
  }
  async function loadCoordination(){
    const node=$("#openCoordinationList");if(!node||!identity)return;
    try{const from=new Date().toISOString(),to=new Date(Date.now()+14*86400000).toISOString();const data=await window.AuthService.rest("rpc/reservation_slots",{method:"POST",body:{p_from:from,p_to:to}});
      const rows=(data||[]).filter(r=>r.allow_coordination&&!r.is_mine);
      node.innerHTML=rows.slice(0,8).map(r=>'<article class="open-slot-card"><div><span class="workflow-status status-confirmed">可沟通</span><h4>'+esc(devices.find(d=>d.No===r.device_no)?.Name||r.device_no)+'</h4><p>'+esc(dateTime(r.starts_at))+' · '+esc(new Date(r.starts_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false})+'—'+new Date(r.ends_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}))+'</p><small>'+esc(r.owner_name||"校园用户")+'</small></div><button type="button" class="secondary-button" data-open-chat="'+esc(r.reservation_id)+'">联系预约者</button></article>').join("")||'<p class="workflow-empty">未来两周没有开放沟通的预约。</p>';
      $$('[data-open-chat]').forEach(b=>b.addEventListener("click",()=>{const dlg=$("#contactDialog");$("#contactTitle").textContent="预约沟通";$("#contactStatusText").textContent="正在打开安全会话…";$("#chatThread").innerHTML='<p class="chat-empty">正在读取消息…</p>';dlg.showModal();window.AuthService.startChat(b.dataset.openChat).then(()=>{ $("#contactStatusText").textContent="此对话仅对该预约的参与者开放。";clearInterval(window.chatRefreshTimer);window.chatRefreshTimer=setInterval(()=>window.AuthService.refreshChat(window.currentConversationId),4000);}).catch(e=>$("#chatThread").innerHTML='<p class="chat-empty">'+esc(e.message)+'</p>');}));
    }catch(e){node.innerHTML='<p class="workflow-empty">预约沟通暂不可用：'+esc(e.message)+'</p>';}
  }
  async function refresh(){if(!identity)return; await Promise.all([loadReservations(),loadIssues(),loadMaintenance(),loadAnnouncements(),loadWaitlist(),loadCoordination()]);}
  function bind(){
    $("#issueForm")?.addEventListener("submit",async e=>{e.preventDefault();const button=e.currentTarget.querySelector("button[type=submit]");button.disabled=true;try{await window.AuthService.rest("issues",{method:"POST",body:{device_no:$("#issueDevice").value,reported_by:identity.id,description:"["+$("#issueType").value+"] "+$("#issueDescription").value.trim()},prefer:"return=representation"});$("#issueDescription").value="";await refresh();feedback("报修已提交，管理员可以查看并跟进。");}catch(err){feedback("提交失败："+err.message,true);}finally{button.disabled=false;}});
    $("#equipmentEditForm")?.addEventListener("submit",async e=>{e.preventDefault();if(identity?.role!=="admin")return;const id=$("#equipmentEditDevice").value;const duration=$("#equipmentDuration").value;try{await window.AuthService.rest("equipment",{method:"PATCH",query:{device_no:"eq."+id},body:{category:$("#equipmentCategory").value.trim()||null,location:$("#equipmentLocation").value.trim()||null,model:$("#equipmentModel").value.trim()||null,open_hours:$("#equipmentHours").value.trim()||null,max_duration_minutes:duration?Number(duration):null,status_note:$("#equipmentStatusNote").value.trim()||null,description:$("#equipmentDescription").value.trim()||null},prefer:"return=representation"});feedback("设备档案已保存。");await refresh();}catch(err){feedback("保存失败："+err.message,true);}});
    $("#maintenanceForm")?.addEventListener("submit",async e=>{e.preventDefault();if(identity?.role!=="admin")return;const day=$("#maintenanceDate").value;const start=new Date(day+"T00:00:00");const end=new Date(day+"T23:59:59");try{await window.AuthService.rest("maintenance_windows",{method:"POST",body:{device_no:$("#maintenanceDevice").value,starts_at:start.toISOString(),ends_at:end.toISOString(),note:$("#maintenanceNote").value.trim(),created_by:identity.id}});$("#maintenanceNote").value="";await refresh();feedback("维护安排已发布。");}catch(err){feedback("发布失败："+err.message,true);}});
    $("#noticeForm")?.addEventListener("submit",async e=>{e.preventDefault();if(identity?.role!=="admin")return;const select=$("#noticeCategory");const type=category[select.value]||select.value;try{await window.AuthService.rest("announcements",{method:"POST",body:{title:$("#noticeTitle").value.trim(),body:$("#noticeBody").value.trim(),category:type,created_by:identity.id}});e.currentTarget.reset();await refresh();feedback("公告已发布。");}catch(err){feedback("发布失败："+err.message,true);}});
    $("#joinWaitlist")?.addEventListener("click",async()=>{const device=$("#waitlistDevice").value,day=$("#waitlistDate").value;if(!device||!day){feedback("请选择设备和日期。",true);return;}try{await window.AuthService.rest("waitlist",{method:"POST",body:{owner_id:identity.id,device_no:device,preferred_date:day},prefer:"return=representation"});await loadWaitlist();feedback("已加入云端候补名单。");}catch(e){feedback(e.message.includes("duplicate")?"该设备和日期已经在候补名单中。":"加入失败："+e.message,true);}});
    $$("[data-reservation-filter]").forEach(b=>b.addEventListener("click",()=>{ $$("[data-reservation-filter]").forEach(x=>x.classList.toggle("is-active",x===b)); const active=b.dataset.reservationFilter; $$("#workflowReservations .workflow-reservation").forEach(card=>{const done=card.querySelector(".workflow-status")?.textContent==="已完成";card.hidden=active==="active"?done:active==="done"?!done:false;});}));
  }
  document.addEventListener("DOMContentLoaded",bind);
  window.CloudWorkflow=Object.freeze({setContext(user){setContext(user);},setDevices(value){devices=value||[];deviceOptions();},refresh});
})();
