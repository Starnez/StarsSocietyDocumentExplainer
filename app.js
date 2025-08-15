// Minimal, dependency-free glue code. All heavy lifting is via CDN libs.

const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const fileNameEl = document.getElementById('file-name');
const textInput = document.getElementById('text-input');
const explainPlainBtn = document.getElementById('explain-plain-btn');
const explainDetailedBtn = document.getElementById('explain-detailed-btn');
const outputEl = document.getElementById('output');
const progressEl = document.getElementById('progress');
const shortModeEl = document.getElementById('short-mode');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');
const chatCard = document.getElementById('chat-card');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const pasteToggle = document.getElementById('paste-toggle');
const pasteArea = document.getElementById('paste-area');

// No visible model selector; cloud is used if key present, else local fallback
// OpenRouter key is now embedded via config below for simplicity

let isBusy = false;
let selectedModel = 'lamini';
let preprocessedText = '';

function setProgress(text) {
  const progressText = document.getElementById('progress-text');
  if (progressText) progressText.textContent = text;
  else progressEl.textContent = text;
  progressEl.classList.toggle('hidden', !text);
}

function setProgressPercent(percent) {
  const bar = document.getElementById('progressbar');
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  bar.style.width = clamped + '%';
}

function setBusy(state) {
  isBusy = state;
  if (explainPlainBtn) explainPlainBtn.disabled = state;
  if (explainDetailedBtn) explainDetailedBtn.disabled = state;
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e && e.lengthComputable) {
        const pct = Math.min(8, Math.round((e.loaded / e.total) * 8));
        setProgressPercent(pct);
      }
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractTextFromPdf(file) {
  setProgress('Reading PDF…');
  setProgressPercent(5);
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const pdfjsLib = await ensurePdfEngine();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  if (loadingTask && loadingTask.onProgress) {
    loadingTask.onProgress = (p) => {
      if (p && p.total) {
        setProgressPercent(5 + Math.min(30, Math.round((p.loaded / p.total) * 30)));
      }
    };
  }
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(`Extracting text from PDF page ${i}/${pdf.numPages}…`);
    setProgressPercent(35 + Math.round((i - 1) / pdf.numPages * 40));
    const page = await pdf.getPage(i);
    let content = null;
    try {
      content = await page.getTextContent();
    } catch (err) {
      content = { items: [] };
    }
    const strings = (content.items || []).map(item => item.str);
    fullText += strings.join(' ') + '\n\n';
  }
  fullText = fullText.trim();

  // If no selectable text was found, it might be a scanned PDF.
  if (!fullText) {
    // OCR a few pages to keep it reasonably fast
    const maxOcrPages = Math.min(3, pdf.numPages);
    let ocrText = '';
    for (let i = 1; i <= maxOcrPages; i++) {
      setProgress(`OCR on PDF page ${i}/${maxOcrPages}…`);
      setProgressPercent(75 + Math.round((i - 1) / maxOcrPages * 20));
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const { data } = await Tesseract.recognize(dataUrl, 'eng', {
        logger: m => setProgress(`OCR on PDF: ${m.status} ${(m.progress ? Math.round(m.progress * 100) + '%' : '')}`)
      });
      ocrText += (data?.text || '') + '\n\n';
    }
    return ocrText.trim();
  }

  return fullText;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensurePdfEngine() {
  let lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'] || window.pdfjsDistBuildPdf;
  if (!lib) {
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
      lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'] || window.pdfjsDistBuildPdf;
    } catch (e) {
      console.error('Failed to load pdf.js', e);
    }
  }
  if (!lib) throw new Error('PDF engine not loaded');
  try {
    lib.GlobalWorkerOptions.workerSrc = lib.GlobalWorkerOptions.workerSrc || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  } catch {}
  return lib;
}

async function extractTextFromDocx(file) {
  setProgress('Reading DOCX…');
  setProgressPercent(10);
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const result = await window.mammoth.convertToHtml({ arrayBuffer });
  const html = result.value || '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = tmp.textContent || tmp.innerText || '';
  setProgressPercent(65);
  return text.trim();
}

async function extractTextFromImage(file) {
  setProgress('Running OCR on image…');
  const dataUrl = await readFileAsDataURL(file);
  const { data } = await Tesseract.recognize(dataUrl, 'eng', {
    logger: m => {
      setProgress(`OCR: ${m.status} ${(m.progress ? Math.round(m.progress * 100) + '%' : '')}`);
      if (m.progress) setProgressPercent(10 + Math.round(m.progress * 60));
    }
  });
  return (data && data.text ? data.text.trim() : '');
}

function detectFileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.match(/\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/)) return 'image';
  return 'unknown';
}

async function getInputText() {
  const file = fileInput.files && fileInput.files[0];
  let text = (textInput.value || '').trim();
  if (file) {
    const kind = detectFileKind(file);
    try {
      if (kind === 'pdf') text = await extractTextFromPdf(file);
      else if (kind === 'docx') text = await extractTextFromDocx(file);
      else if (kind === 'image') text = await extractTextFromImage(file);
    } catch (e) {
      console.error(e);
      const name = file?.name || 'file';
      alert(`Failed to read ${name}. ${e?.message || ''}`.trim());
      setProgress('');
    }
  }
  return (text || '').trim();
}

async function preProcessSelectedFile() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  try {
    setProgress('Preparing document…');
    setProgressPercent(8);
    preprocessedText = await getInputText();
    if (preprocessedText) {
      setProgress('Document ready');
      setProgressPercent(90);
      setTimeout(() => setProgress(''), 800);
    } else {
      setProgress('Could not read document');
      setProgressPercent(0);
    }
  } catch (e) {
    console.error(e);
    preprocessedText = '';
    setProgress('Could not read document');
    setProgressPercent(0);
  }
}

// Simplification via Transformers.js using a small instruction-tuned model.
// We use text2text-generation with OSS models.
// - Xenova/LaMini-Flan-T5-77M (fastest)
// - Xenova/Qwen2.5-0.5B-Instruct (higher quality; slower)
let textModel = null;
let textModelId = 'Xenova/LaMini-Flan-T5-77M';

async function loadTextModel() {
  if (textModel && textModel.model_id === textModelId) return textModel;
  setProgress('Loading AI model (first time may take ~20–60s)…');
  const { pipeline, env } = window.transformers;
  try {
    // Encourage caching and faster WASM backend
    env.useBrowserCache = true;
    if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
      env.backends.onnx.wasm.numThreads = Math.min(4, (navigator.hardwareConcurrency || 4));
      env.backends.onnx.wasm.simd = true;
    }
  } catch {}
  const device = (navigator.gpu ? 'webgpu' : 'wasm');
  textModel = await pipeline('text2text-generation', textModelId, { device, quantized: true });
  return textModel;
}

function chunkText(text, maxChars) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // try to break at sentence end
    const slice = text.slice(start, end);
    const lastDot = slice.lastIndexOf('.');
    if (lastDot > 300 && end < text.length) {
      end = start + lastDot + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function simplify(text, shortMode) {
  // If OpenRouter API key is set in config, use cloud model for instant speed
  const key = (window.OPENROUTER_API_KEY || '').trim();
  if (key) {
    setProgress('Calling cloud model…');
    const result = await cloudExplain(text, shortMode, key);
    return result;
  }

  const model = await loadTextModel();
  const chunks = chunkText(text, 1600);
  const outputs = [];
  let index = 0;
  for (const chunk of chunks) {
    index += 1;
    setProgress(`Explaining part ${index}/${chunks.length}…`);
    setProgressPercent(90 + Math.round((index - 1) / Math.max(1, chunks.length) * 9));
    const prompt = `Explain the following text in plain, simple English.\n- Use short sentences.\n- Keep meaning accurate and neutral.\n- Use bullet points when listing.\n- ${shortMode ? 'Keep it concise.' : 'Be thorough but clear.'}\n\nText:\n${chunk}\n\nExplanation:`;
    const out = await model(prompt, {
      max_new_tokens: shortMode ? 220 : 360,
      temperature: 0.2,
      top_p: 0.9,
      repetition_penalty: 1.05,
    });
    const textOut = Array.isArray(out) ? out[0].generated_text : String(out);
    // LaMini returns only the generation, not echoing the prompt.
    outputs.push(textOut.trim());
  }
  return outputs.join('\n\n');
}

function normalizeWhitespace(text) {
  return text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Convert LLM markdown-ish output into simple, friendly HTML with headings and pills
function renderFriendly(text) {
  const safe = (text || '').trim();
  // Basic markdown replacements
  let html = safe
    .replace(/^#{2,}\s*(.*)$/gm, '<h3>$1</h3>')
    .replace(/^\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\*\s+/gm, '<li>')
    .replace(/\n<li>/g, '<ul><li>')
    .replace(/(<li>.*?)(?=\n[^*]|$)/gs, (m)=> m + '</li>')
    .replace(/<ul><li>/g, '<ul><li>')
    .replace(/<li><\/li>/g, '')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
  // Quick tokens: highlight dollar amounts and dates as pills
  html = html.replace(/\$\d[\d,]*/g, (m) => `<span class="pill">${m}</span>`);
  html = html.replace(/\b(Sept|Oct|Nov|Dec|Jan|Feb|Mar)\b[^<\s]*/g, (m) => `<span class="pill">${m}</span>`);
  return html;
}

async function runExplain(shortMode) {
  if (isBusy) return;
  setBusy(true);
  outputEl.textContent = '';
  try {
    const inputText = preprocessedText || await getInputText();
    if (!inputText) {
      alert('Please upload a document or paste text.');
      setBusy(false);
      return;
    }
    setProgress('Preparing text…');
    setProgressPercent(95);
    const cleaned = normalizeWhitespace(inputText);
    const result = await simplifyWithQuickTake(cleaned, shortMode);
    outputEl.innerHTML = renderFriendly(result);
    setProgress('Done');
    setProgressPercent(100);
    setTimeout(() => setProgress(''), 1000);
    setTimeout(() => setProgressPercent(0), 800);
    if (chatCard) chatCard.classList.remove('hidden');
  } catch (e) {
    console.error(e);
    alert(`AI failed while explaining: ${e?.message || e}`);
  } finally {
    setBusy(false);
  }
}

if (explainPlainBtn) explainPlainBtn.addEventListener('click', () => runExplain(true));
if (explainDetailedBtn) explainDetailedBtn.addEventListener('click', () => runExplain(false));

copyBtn.addEventListener('click', async () => {
  const text = outputEl.textContent || '';
  if (!text) return;
  await navigator.clipboard.writeText(text);
});

downloadBtn.addEventListener('click', () => {
  const text = outputEl.textContent || '';
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'explanation.txt';
  a.click();
  URL.revokeObjectURL(url);
});

resetBtn.addEventListener('click', () => {
  textInput.value = '';
  fileInput.value = '';
  outputEl.textContent = '';
  setProgress('');
  setProgressPercent(0);
  preprocessedText = '';
});

// Drag and drop behavior
if (dropzone) {
  const onDragOver = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
  const onDragLeave = () => dropzone.classList.remove('dragover');
  const onDrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      fileInput.files = files;
      fileNameEl.textContent = files[0].name;
      preprocessedText = '';
      // Start pre-processing right away
      preProcessSelectedFile();
    }
  };
  dropzone.addEventListener('dragover', onDragOver);
  dropzone.addEventListener('dragleave', onDragLeave);
  dropzone.addEventListener('drop', onDrop);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileNameEl.textContent = file ? file.name : '';
    preprocessedText = '';
    // Start pre-processing immediately
    preProcessSelectedFile();
    if (chatCard) chatCard.classList.add('hidden');
    if (chatLog) chatLog.innerHTML = '';
    if (pasteArea && !pasteArea.classList.contains('hidden')) pasteArea.classList.add('hidden');
  });
}

// Warm-start: only load local model if no OpenRouter key is configured
window.addEventListener('load', () => {
  const hasCloud = (window.OPENROUTER_API_KEY || '').trim().length > 0;
  if (!hasCloud) {
    setTimeout(() => {
      loadTextModel().catch(() => {});
    }, 400);
  }
});

// No model selector logic (simplified UX)

// Save OpenRouter key locally (never sent anywhere except API call from your browser)
// No manual key UI; use config below instead.

// Cloud inference via OpenRouter (DeepSeek or GPT-OSS-20b free route)
async function cloudExplain(text, shortMode, apiKey) {
  const system = 'You rewrite legal text into plain, simple English. Keep meaning accurate and neutral. Use short sentences and bullet points.';
  const user = `${shortMode ? 'Summarize briefly' : 'Explain thoroughly but clearly'} in plain English:\n\n${text}`;
  const body = {
    model: (window.OPENROUTER_MODEL || 'deepseek/deepseek-chat'),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.2,
    max_tokens: shortMode ? 600 : 1200
  };
  const proxyUrl = '/.netlify/functions/openrouter-proxy';
  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errText = await resp.text();
    // Fallback: if gpt-oss fails, try deepseek quickly once
    if ((window.OPENROUTER_MODEL || '').includes('gpt-oss')) {
      try {
        window.OPENROUTER_MODEL = 'deepseek/deepseek-chat';
        return await cloudExplain(text, shortMode, apiKey);
      } catch {}
    }
    throw new Error(`Cloud error ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return content.trim();
}

// Add a quick-take section before the explanation
async function simplifyWithQuickTake(text, shortMode) {
  const key = (window.OPENROUTER_API_KEY || '').trim();
  const system = 'You analyze legal documents and explain them in plain English.';
  const quickPrompt = `Provide a very short Quick take:\n- What type of document is this?\n- What is it about?\n- Most pressing issue(s) or risks to watch\n- Any deadlines/obligations\nUse 3-6 bullet points.\n\nDOCUMENT:\n${text}`;
  let quick = '';
  try {
    if (key) {
      quick = await cloudExplainRaw(system, quickPrompt, key, 300);
    }
  } catch {}
  const body = await simplify(text, shortMode);
  if (quick) {
    return `Quick take:\n${quick}\n\n${body}`;
  }
  return body;
}

async function cloudExplainRaw(system, user, apiKey, maxTokens) {
  const body = {
    model: (window.OPENROUTER_MODEL || 'deepseek/deepseek-chat'),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.2,
    max_tokens: maxTokens || 600
  };
  const proxyUrl = '/.netlify/functions/openrouter-proxy';
  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err);
  }
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

// Chat about the current document
async function askChat(question) {
  const key = (window.OPENROUTER_API_KEY || '').trim();
  const base = preprocessedText || outputEl.textContent || textInput.value || '';
  const context = normalizeWhitespace(base);
  if (!key || !context) throw new Error('No document context or API key');
  const system = 'You are a helpful legal explainer. Answer questions about the provided document only. If unsure, say you are unsure. Keep it plain English and concise.';
  const user = `Document:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;
  return await cloudExplainRaw(system, user, key, 600);
}

function appendChat(role, text) {
  if (!chatLog) return;
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg';
  const r = document.createElement('div');
  r.className = 'chat-role';
  r.textContent = role;
  const b = document.createElement('div');
  b.className = 'chat-bubble';
  b.textContent = text;
  wrap.appendChild(r);
  wrap.appendChild(b);
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

if (chatSend && chatInput) {
  const send = async () => {
    const q = (chatInput.value || '').trim();
    if (!q) return;
    appendChat('You', q);
    chatInput.value = '';
    // add placeholder
    appendChat('AI', '…thinking');
    try {
      const a = await askChat(q);
      const nodes = chatLog.querySelectorAll('.chat-msg');
      const last = nodes[nodes.length - 1];
      if (last) {
        last.querySelector('.chat-bubble').textContent = a;
      }
    } catch (e) {
      const nodes = chatLog.querySelectorAll('.chat-msg');
      const last = nodes[nodes.length - 1];
      if (last) {
        last.querySelector('.chat-bubble').textContent = 'Sorry, I could not answer that right now.';
      }
    }
  };
  chatSend.addEventListener('click', send);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

// Paste toggle
if (pasteToggle) {
  pasteToggle.addEventListener('click', () => {
    if (!pasteArea) return;
    pasteArea.classList.toggle('hidden');
    if (!pasteArea.classList.contains('hidden')) {
      textInput.focus();
    }
  });
}


