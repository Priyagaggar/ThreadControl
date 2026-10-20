// users.js — Users page (list, create, toggle, delete, reset password).
// Aug 6 2026 — Phase 1, Step 3 of the module-split plan. Extracted byte-for-
// byte from pages.js. Inventory verified two independent ways (real AST call
// graph + every onclick/onchange string embedded in generated HTML + static
// buttons in index.html) before extraction, and independently cross-checked
// by Antigravity against the real file — same result both times.

import { State, WORKER_URL, _getHeaders, apiPost, closeModal, openModal, showAlert, showConfirm, showToast } from './core.js';

export let _adminUsersCache=[];

export async function renderUsers(){const isAdminRole=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';document.getElementById('users-tbody').innerHTML='<tr><td colspan="6" class="empty-text" style="padding:14px">Loading...</td></tr>';
try{const res=await fetch(WORKER_URL+'/api/users/list',{headers:_getHeaders()});const data=await res.json();_adminUsersCache=data.users||[];}catch(e){console.error('[Users] Failed to load:',e);document.getElementById('users-tbody').innerHTML='<tr><td colspan="6" class="empty-text" style="padding:14px">✕ Failed to load users</td></tr>';return;}
const usersToShow=_adminUsersCache;document.getElementById('users-tbody').innerHTML=usersToShow.map(u=>{return`<tr><td>${u.name}</td><td class="mono">${u.username}</td><td><span class="rbadge ${u.role==='manager'?'rm':u.role==='supervisor'?'rs':'rw'}">${u.role}</span></td><td style="font-size:0.75rem;color:var(--mu)">${u.role==='worker'?u.stage:'All'}</td><td><span class="badge ${u.active!==false?'b-approved':'b-rejected'}">${u.active!==false?'Active':'Disabled'}</span></td><td style="display:flex;gap:4px;flex-wrap:wrap;">
      ${isAdminRole?`<button class="btn bg bxs"onclick="openChangePwModal('${u.id}','${u.name}')">🔑</button>`:''}
      ${isAdminRole?`<button class="btn btn-ghost btn-xs" onclick="toggleUser('${u.id}')">${u.active!==false?'Disable':'Enable'}</button>`:''}
      ${isAdminRole&&u.username!=='admin'?`<button class="btn btn-danger btn-xs"onclick="deleteUser('${u.id}')">Delete</button>`:''}
    </td></tr>`;}).join('')||'<tr><td colspan="6" class="empty-text" style="padding:14px">✕ No users</td></tr>';}

export async function addUser(){const name=document.getElementById('nu-name').value.trim();const username=document.getElementById('nu-user').value.trim().toLowerCase();const password=document.getElementById('nu-pass').value;const role=document.getElementById('nu-role').value;const stage=document.getElementById('nu-stage').value;if(!name||!username||password.length<8){await showAlert('Fill all fields. Password must be at least 8 characters.','Missing Fields');return;}
try{const {ok,data,error,networkError}=await apiPost('/api/users/create',{name,username,password,role,stage});
  if(networkError)throw new Error(error);
  if(!ok){await showAlert(error||'Could not create user','Create User Failed');return;}
['nu-name','nu-user','nu-pass'].forEach(id=>document.getElementById(id).value='');renderUsers();}catch(e){console.error('[Users] Create failed:',e);alert('Could not reach server');}}

export async function toggleUser(id){try{const {ok,data,error,networkError}=await apiPost('/api/users/toggle',{id});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not update user','err');return;}
renderUsers();}catch(e){console.error('[Users] Toggle failed:',e);showToast('Could not reach server','err');}}

export async function deleteUser(id){const u=_adminUsersCache.find(x=>x.id===id);if(!u)return;if(!await showConfirm(`Delete user ${u.name}? This cannot be undone.`,'Delete User','Delete',true))return;
// Sep 10 2026 — real, genuine gap found via Priyam's own requested
// holistic app-wide audit: deleting a user account had no password
// confirmation at all, unlike every comparable destructive action in
// the app. Per Priyam's own direct decision, this one specifically
// now requires it.
const pwd=prompt('Enter your password to confirm:');if(!pwd){showToast('Cancelled — password required','err');return;}
try{const {ok,data,error,networkError}=await apiPost('/api/users/delete',{id,password:pwd,username:State.currentUser?.username});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not delete user','err');return;}
renderUsers();}catch(e){console.error('[Users] Delete failed:',e);showToast('Could not reach server','err');}}

export function openChangePwModal(uid,name){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('cpw-uid').value=uid;document.getElementById('cpw-name').textContent=name;document.getElementById('cpw-input').value='';document.getElementById('cpw-alert').innerHTML='';openModal('change-pw-modal');}

export async function changeUserPasswordAdmin(uid,newPassword){if(!uid||!newPassword){showToast('Missing uid or password','err');return;}
if(newPassword.length<6){showToast('Password min 6 characters','err');return;}
try{const {ok,data,error,networkError}=await apiPost('/api/users/reset-password',{id:uid,newPassword});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not change password','err');return;}
if(State.currentUser&&State.currentUser.id===uid){State.currentUser=data.user;window.currentUser=State.currentUser;sessionStorage.setItem('tcv2_session',JSON.stringify(State.currentUser));}
showToast('Password changed ✓');closeModal('change-pw-modal');}catch(e){console.error('[Users] Password reset failed:',e);showToast('Could not reach server','err');}}

window.addUser = addUser;
window.toggleUser = toggleUser;
window.deleteUser = deleteUser;
window.openChangePwModal = openChangePwModal;
window.changeUserPasswordAdmin = changeUserPasswordAdmin;
