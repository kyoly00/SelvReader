const enabled = document.getElementById('enabled');
const autoOpenPdf = document.getElementById('auto-open-pdf');
const status = document.getElementById('status');
const message = document.getElementById('message');
const openCurrentPdf = document.getElementById('open-current-pdf');
const openReader = document.getElementById('open-reader');

function send(messageValue) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(messageValue, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '설정을 변경하지 못했습니다.'));
        return;
      }
      resolve(response);
    });
  });
}

function render(settings) {
  enabled.checked = Boolean(settings.enabled);
  autoOpenPdf.checked = Boolean(settings.autoOpenPdf);
  autoOpenPdf.disabled = !settings.enabled;
  status.textContent = settings.enabled
    ? `웹 도구가 켜져 있습니다. PDF 자동 열기는 ${settings.autoOpenPdf ? '켜짐' : '꺼짐'} 상태입니다.`
    : '웹 도구가 꺼져 있습니다. PDF 자동 열기와 선택 도구가 동작하지 않습니다.';
  status.classList.toggle('off', !settings.enabled);
}

async function update(next) {
  message.textContent = '';
  enabled.disabled = true;
  autoOpenPdf.disabled = true;
  try {
    const response = await send({ type: 'SET_TOGGLE_SETTINGS', ...next });
    render(response);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    enabled.disabled = false;
    autoOpenPdf.disabled = !enabled.checked;
  }
}

enabled.addEventListener('change', () => void update({ enabled: enabled.checked }));
autoOpenPdf.addEventListener('change', () => void update({ autoOpenPdf: autoOpenPdf.checked }));

openCurrentPdf.addEventListener('click', async () => {
  message.textContent = '';
  try {
    await send({ type: 'OPEN_CURRENT_TAB_PDF' });
    window.close();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  }
});

openReader.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  window.close();
});

void send({ type: 'GET_TOGGLE_SETTINGS' })
  .then(render)
  .catch((error) => { message.textContent = error instanceof Error ? error.message : String(error); });
