/* global chrome */
async function render(){const {connection,status}=await chrome.storage.local.get(["connection","status"]);document.querySelector('#sender').textContent=connection?`회사 계정: @${connection.sender}`:"ERUTY에서 회사 계정을 연결해 주세요.";const labels={ready:"회사 계정 확인 완료",login_required:"Instagram 로그인 필요",sender_mismatch:"로그인 계정 불일치",browser_unavailable:"Instagram 화면 확인 필요",captcha:"본인 확인 필요",platform_restricted:"Instagram 제한 확인 필요"};document.querySelector('#status').textContent=labels[status]??status??"연결 대기";}
document.querySelector('#check').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:"ERUTY_CHECK"});await render();});
document.querySelector('#disconnect').addEventListener('click',async()=>{const response=await chrome.runtime.sendMessage({type:"ERUTY_DISCONNECT"});if(!response.ok)document.querySelector('#status').textContent="진행 중인 연락 결과를 먼저 확인해 주세요.";else await render();});
void render();
