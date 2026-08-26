const APP_VERSION = '0.7.0';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_PLATFORM = 12;
const RECONCILIATION_TOLERANCE = 10;
const CATEGORY_SCHEMA_VERSION = 2;

const DEFAULT_CATEGORY_TREE = [
  { name: '吃', children: ['外卖简餐', '外食', '生鲜采购', '咖啡奶茶', '零食', '其他'] },
  { name: '穿', children: ['衣服', '饰品', '鞋', '其他'] },
  { name: '住', children: ['水', '电', '网', '燃气', '物业', '阿姨', '其他'] },
  { name: '行', children: ['地铁公交', '打车', '高铁飞机', '其他'] },
  { name: '用', children: ['日用百货', '数码电器', '其他'] },
  { name: '美', children: ['护肤', '化妆', '医美', '美发', '其他'] },
  { name: '宝', children: ['鞋衣', '食物', '用品', '玩具', '其他'] },
  { name: '健康', children: ['运动', '看病', '买药', '疫苗', '保险', '其他'] },
  { name: '成长', children: ['英语', '读书', '其他'] },
  { name: '娱乐', children: ['旅行', '影音', '其他'] },
  { name: '人情', children: ['其他'] },
  { name: '房租', children: ['其他'] },
  { name: '房贷', children: ['其他'] },
  { name: '父母', children: ['其他'] },
  { name: '其他', children: ['宠物', '其他'] }
];
const LEGACY_PRIMARY_MAP = {
  餐饮: '吃', 居住缴费: '住', 交通出行: '行', 衣物与护理: '穿', 日用与数码: '用',
  休闲娱乐: '娱乐', 育儿与教育: '宝', 医疗健康: '健康', 宠物: '其他', 人情与代付: '人情', 其他: '其他'
};

const platformName = (platform) => platform === 'wechat' ? '微信' : '支付宝';
const monthKeyNow = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const emptySources = () => [
  { id: 'wechat', name: '微信', total: 0, entries: [] },
  { id: 'alipay', name: '支付宝', total: 0, entries: [] }
];
const createEmptyState = (month = monthKeyNow()) => ({
  schemaVersion: 1,
  appVersion: APP_VERSION,
  month,
  step: 1,
  income: { salary: 0, side: 0, investment: 0, other: 0 },
  customIncome: [],
  extraExpenses: [],
  sources: emptySources(),
  uploads: { wechat: [], alipay: [] },
  recognized: false,
  completed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

let state = createEmptyState();
let HISTORY = [];
let PREVIOUS_MONTH = null;
let YEAR_AGO = { income: 0, expense: 0, categories: {}, subcategories: {} };
let allReviews = [];
let imagesByPlatform = { wechat: [], alipay: [] };
let categoryTree = DEFAULT_CATEGORY_TREE.map((group) => ({ name: group.name, children: [...group.children] }));
let ocrCategoryMappings = {};
const imageObjectUrls = new Map();
let saveTimer;
let applicationReady = false;
let ocrRunning = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const yuan = (number) => `¥ ${Number(number || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (values) => values.reduce((total, value) => total + Number(value || 0), 0);
const formatFileSize = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const monthLabel = (month) => {
  const [year, monthNumber] = month.split('-');
  return `${year} 年 ${Number(monthNumber)} 月`;
};
const monthShortLabel = (month) => `${Number(month.split('-')[1])}月`;
const safeClone = (value) => structuredClone(value);

function normalizeCategoryTree(value) {
  const source = Array.isArray(value) ? value : DEFAULT_CATEGORY_TREE;
  const groups = [];
  source.forEach((group) => {
    const name = String(group?.name || '').trim().slice(0, 12);
    if (!name || groups.some((item) => item.name === name)) return;
    const children = [...new Set((Array.isArray(group.children) ? group.children : []).map((child) => String(child || '').trim().slice(0, 16)).filter(Boolean))];
    groups.push({ name, children: children.length ? children : ['其他'] });
  });
  return groups.length ? groups : DEFAULT_CATEGORY_TREE.map((group) => ({ name: group.name, children: [...group.children] }));
}

function suggestCategory(sourceName) {
  const value = String(sourceName || '');
  const rules = [
    [/房租/, '房租', '其他'], [/房贷/, '房贷', '其他'], [/父母|爸|妈/, '父母', '其他'],
    [/咖啡|奶茶/, '吃', '咖啡奶茶'], [/外卖|简餐/, '吃', '外卖简餐'], [/生鲜|买菜|菜场/, '吃', '生鲜采购'], [/餐|美食|正餐|外食/, '吃', '外食'],
    [/饰品/, '穿', '饰品'], [/鞋/, '穿', '鞋'], [/衣|服饰|装扮/, '穿', '衣服'],
    [/水费|用水/, '住', '水'], [/电费|用电/, '住', '电'], [/网费|宽带/, '住', '网'], [/燃气|煤气/, '住', '燃气'], [/物业/, '住', '物业'], [/阿姨|家政/, '住', '阿姨'], [/生活缴费|充值缴费|家居家装/, '住', '其他'],
    [/地铁|公交/, '行', '地铁公交'], [/打车|租车|网约车/, '行', '打车'], [/高铁|飞机|机票|火车/, '行', '高铁飞机'], [/交通|出行/, '行', '其他'],
    [/数码|电器/, '用', '数码电器'], [/日用|百货|购物/, '用', '日用百货'],
    [/护肤/, '美', '护肤'], [/化妆/, '美', '化妆'], [/医美/, '美', '医美'], [/美容|美发/, '美', '美发'],
    [/玩具/, '宝', '玩具'], [/母婴|亲子|育儿|宝宝|婴儿/, '宝', '其他'],
    [/运动/, '健康', '运动'], [/药/, '健康', '买药'], [/疫苗/, '健康', '疫苗'], [/保险/, '健康', '保险'], [/医疗|健康|看病/, '健康', '看病'],
    [/英语/, '成长', '英语'], [/读书|图书/, '成长', '读书'], [/教育|培训|学习/, '成长', '其他'],
    [/旅行|旅游/, '娱乐', '旅行'], [/影音|电影|娱乐|文化|休闲/, '娱乐', '影音'],
    [/转账|代付|人情/, '人情', '其他'], [/宠物/, '其他', '宠物']
  ];
  const matched = rules.find(([pattern]) => pattern.test(value));
  return matched ? { category: matched[1], subcategory: matched[2] } : { category: '其他', subcategory: '其他' };
}

function secondaryOptionsFor(category, currentValue = '') {
  const group = categoryTree.find((item) => item.name === category);
  return [...new Set([...(group?.children || ['其他']), currentValue].filter(Boolean))];
}

function normalizeClassification(record = {}) {
  const suggested = suggestCategory(record.source || record.note || '');
  const original = String(record.category || '').trim();
  let category = original;
  let subcategory = String(record.subcategory || '').trim();
  if (!category) category = suggested.category;
  if (LEGACY_PRIMARY_MAP[category] && !record.subcategory) {
    const legacyCategory = LEGACY_PRIMARY_MAP[category];
    category = suggested.category !== '其他' || legacyCategory === '其他' ? suggested.category : legacyCategory;
  }
  if (!subcategory) subcategory = suggested.category === category ? suggested.subcategory : secondaryOptionsFor(category)[0] || '其他';
  return { ...record, category, subcategory, note: String(record.note || '') };
}

const persistReview = async () => {
  state.updatedAt = new Date().toISOString();
  await FinanceDB.putReview(safeClone(state));
};
const save = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistReview().catch(handleFatalError), 120);
};

function normalizeReview(review, month) {
  const blank = createEmptyState(month);
  const normalized = { ...blank, ...(review || {}), month };
  normalized.appVersion = APP_VERSION;
  normalized.income = { ...blank.income, ...(review?.income || {}) };
  normalized.customIncome = Array.isArray(review?.customIncome) ? review.customIncome : [];
  normalized.extraExpenses = Array.isArray(review?.extraExpenses) ? review.extraExpenses.map(normalizeClassification) : [];
  normalized.sources = (Array.isArray(review?.sources) && review.sources.length === 2 ? review.sources : emptySources()).map((source) => ({
    ...source,
    entries: Array.isArray(source.entries) ? source.entries.map((entry) => normalizeClassification({
      confirmed: entry.needsConfirm ? Boolean(entry.confirmed) : true,
      inputMethod: entry.inputMethod || 'manual',
      ...entry
    })) : [],
    totalConfirmed: source.totalConfirmed ?? Number(source.total || 0) > 0,
    monthConfirmed: source.monthConfirmed ?? true,
    warnings: Array.isArray(source.warnings) ? source.warnings : []
  }));
  normalized.uploads = { wechat: [], alipay: [], ...(review?.uploads || {}) };
  normalized.step = Math.min(5, Math.max(1, Number(normalized.step || 1)));
  return normalized;
}

async function loadImagesForMonth(month) {
  imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  imageObjectUrls.clear();
  const [wechat, alipay] = await Promise.all([
    FinanceDB.listImages(month, 'wechat'), FinanceDB.listImages(month, 'alipay')
  ]);
  imagesByPlatform = { wechat, alipay };
}

function clearCustomIncomeRows() {
  $$('[data-custom-income-name]').forEach((element) => element.closest('label')?.remove());
}

function updateMonthUI() {
  $('#reviewMonth').value = state.month;
  $('#reportMonth').value = state.month;
  const label = monthLabel(state.month);
  const short = monthShortLabel(state.month);
  $('#page-review .page-header .eyebrow').textContent = label;
  $('#page-report .page-header h1').textContent = label;
  $('.finish-card .eyebrow').textContent = label;
  $('#page-home .hero-copy .eyebrow').textContent = `${label} · ${state.completed ? '已完成' : '待完成'}`;
  renderProgress();
  $('.history-ledger-head small').textContent = `当前：${short}`;
}

function renderProgress() {
  const incomeEntered = sum([...Object.values(state.income || {}), ...(state.customIncome || []).map((item) => item.amount)]) > 0;
  const uploaded = imagesByPlatform.wechat.length + imagesByPlatform.alipay.length > 0;
  const reconciliation = reconciliationResults();
  const confirmed = reconciliation.length > 0 && reconciliation.every((item) => item.ok) && state.step >= 4;
  const milestones = {
    created: true,
    income: state.completed || incomeEntered,
    upload: state.completed || uploaded,
    confirm: state.completed || confirmed,
    complete: state.completed
  };
  const completedCount = Object.values(milestones).filter(Boolean).length;
  const progress = completedCount * 20;
  const remaining = 5 - completedCount;
  $('.progress-card .section-heading h2').textContent = state.completed ? '本月已完成' : `还有 ${remaining} 步`;
  const ring = $('.progress-ring');
  ring.textContent = `${progress}%`;
  ring.style.setProperty('--progress', progress);
  $$('[data-progress-key]').forEach((item, index) => {
    const done = Boolean(milestones[item.dataset.progressKey]);
    item.classList.toggle('done', done);
    item.querySelector(':scope > span').textContent = done ? '✓' : String(index + 1);
  });
  const createdTitle = $('[data-progress-key="created"] b');
  if (createdTitle) createdTitle.textContent = `创建 ${monthShortLabel(state.month)}复盘`;
}

async function switchMonth(month, { openReview = true } = {}) {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  window.clearTimeout(saveTimer);
  await persistReview();
  const existing = await FinanceDB.getReview(month);
  state = normalizeReview(existing, month);
  if (!existing) await persistReview();
  await loadImagesForMonth(month);
  clearCustomIncomeRows();
  restoreCustomIncomeRows();
  updateMonthUI();
  renderIncome();
  renderUpload('wechat');
  renderUpload('alipay');
  renderExtraExpenses();
  renderRecognition();
  await refreshHistoryData();
  renderReports();
  goStep(state.step);
  if (openReview) showPage(state.completed ? 'report' : 'review');
}

function handleFatalError(error) {
  console.error(error);
  const shell = $('.app-shell');
  if (shell) shell.innerHTML = `<div class="app-error"><h1>本地数据暂时无法打开</h1><p>${escapeHtml(error?.message || '请刷新页面后重试。')}</p><p>没有任何数据被上传到服务器。</p></div>`;
}

function showPage(name) {
  $$('.page').forEach((page) => page.classList.toggle('active', page.dataset.page === name));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.nav === name));
  const titles = {
    home: ['本月复盘', '晚上好，开始看看这个月的钱去了哪里'],
    review: ['月度复盘', '五步完成，不需要逐笔记账'],
    report: ['月度报告', '统一查看微信与支付宝支出'],
    settings: ['设置与数据', '你的数据，由你决定']
  };
  $('#topbarEyebrow').textContent = titles[name][0];
  $('#topbarTitle').textContent = titles[name][1];
  if (name === 'report') renderReports();
  if (name === 'settings') updateStorageStatus().catch(() => {});
  $('.sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function sourceIsActive(source) {
  return (imagesByPlatform[source.id]?.length || 0) > 0 || source.entries.length > 0 || Number(source.total || 0) > 0;
}

function reconciliationResults() {
  return state.sources.filter(sourceIsActive).map((source) => {
    const calculated = sum(source.entries.map((entry) => entry.amount));
    const difference = Number(source.total || 0) - calculated;
    const amountOk = source.total > 0 && source.entries.length > 0 && Math.abs(difference) < RECONCILIATION_TOLERANCE;
    const pendingEntries = source.entries.filter((entry) => entry.needsConfirm && !entry.confirmed).length;
    const totalOk = source.totalConfirmed !== false;
    const monthOk = source.monthConfirmed !== false;
    return { source, calculated, difference, amountOk, pendingEntries, totalOk, monthOk, ok: amountOk && pendingEntries === 0 && totalOk && monthOk };
  });
}

function goStep(step) {
  const requestedStep = Number(step);
  const hasAnyPlatform = state.sources.some(sourceIsActive);
  if (requestedStep >= 3 && !hasAnyPlatform && !state.completed) {
    showMessage('请先上传至少一张截图', '微信或支付宝任选一个平台，至少保存一张汇总截图后即可继续。');
    state.step = 2;
  } else if (requestedStep >= 4 && reconciliationResults().some((item) => !item.ok) && !state.completed) {
    showMessage('还有金额没有核对完成', `每个平台差额小于 ${yuan(RECONCILIATION_TOLERANCE)} 即可作为统计误差通过；更大的差额请补充漏识别分类。`);
    state.step = 3;
  } else if (requestedStep === 5 && !state.completed) {
    showMessage('本月复盘尚未完成', '请先完成截图确认和其他支出补充。');
    state.step = 4;
  } else state.step = requestedStep;
  $$('.step-panel').forEach((panel) => panel.classList.toggle('active', Number(panel.dataset.stepPanel) === state.step));
  $$('[data-step-indicator]').forEach((item) => {
    const itemStep = Number(item.dataset.stepIndicator);
    item.classList.toggle('active', itemStep === state.step);
    item.classList.toggle('complete', itemStep < state.step || (itemStep === 5 && state.completed));
  });
  if (state.step === 3) renderRecognition();
  if (state.step === 4) renderExtraExpenses();
  if (state.step === 5) renderCompletionSummary();
  updateMonthUI();
  save();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function showMessage(title, text) {
  $('#messageTitle').textContent = title;
  $('#messageText').textContent = text;
  openDialog('messageDialog');
}

function renderIncome() {
  $$('.income-input').forEach((input) => {
    const key = input.dataset.income;
    if (key?.startsWith('custom-')) {
      const index = Number(key.split('-')[1]);
      input.value = state.customIncome[index]?.amount || 0;
    } else if (key) input.value = state.income[key] || 0;
  });
  const total = sum([...Object.values(state.income), ...state.customIncome.map((item) => item.amount)]);
  $('#incomeTotal').textContent = yuan(total);
  renderProgress();
  if ($('#overviewHistoryBars')) renderOverviewHistory();
}

function addCustomIncomeRow() {
  const index = state.customIncome.length;
  state.customIncome.push({ name: `自定义收入 ${index + 1}`, amount: 0 });
  const label = document.createElement('label');
  label.innerHTML = `<span><b contenteditable="true" data-custom-income-name="${index}">自定义收入 ${index + 1}</b><small>点击名称可以修改</small></span><div class="money-input"><i>¥</i><input class="income-input" data-income="custom-${index}" type="number" min="0" step="0.01" value="0" /></div>`;
  $('.income-form').append(label);
  bindIncomeInput(label.querySelector('input'));
  label.querySelector('[contenteditable]').addEventListener('blur', (event) => {
    state.customIncome[index].name = event.target.textContent.trim() || `自定义收入 ${index + 1}`;
    save();
  });
  save();
}

function bindIncomeInput(input) {
  input.addEventListener('input', () => {
    const key = input.dataset.income;
    if (key.startsWith('custom-')) state.customIncome[Number(key.split('-')[1])].amount = Number(input.value || 0);
    else state.income[key] = Number(input.value || 0);
    renderIncome();
    save();
  });
}

function restoreCustomIncomeRows() {
  state.customIncome.forEach((item, index) => {
    const label = document.createElement('label');
    label.innerHTML = `<span><b contenteditable="true" data-custom-income-name="${index}">${escapeHtml(item.name)}</b><small>点击名称可以修改</small></span><div class="money-input"><i>¥</i><input class="income-input" data-income="custom-${index}" type="number" min="0" step="0.01" value="${Number(item.amount || 0)}" /></div>`;
    $('.income-form').append(label);
    bindIncomeInput(label.querySelector('input'));
    label.querySelector('[contenteditable]').addEventListener('blur', (event) => {
      state.customIncome[index].name = event.target.textContent.trim() || `自定义收入 ${index + 1}`;
      save();
    });
  });
}

function imageUrl(record) {
  if (!imageObjectUrls.has(record.id)) imageObjectUrls.set(record.id, URL.createObjectURL(record.blob));
  return imageObjectUrls.get(record.id);
}

function revokeImageUrl(id) {
  const url = imageObjectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  imageObjectUrls.delete(id);
}

function renderUpload(platform) {
  const records = imagesByPlatform[platform] || [];
  const preview = $(`#${platform}Preview`);
  const status = $(`#${platform}State`);
  preview.innerHTML = records.map((record) => `<div class="upload-preview-card"><img src="${imageUrl(record)}" alt="${platformName(platform)}截图缩略图" data-preview-image="${record.id}" /><span><b title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</b><small>${record.width} × ${record.height}</small><small>${formatFileSize(record.size)} · 本地已保存</small></span><button type="button" data-delete-image="${record.id}" data-image-platform="${platform}" aria-label="删除这张截图">×</button></div>`).join('');
  status.textContent = records.length ? `本地已存 ${records.length} 张` : '本月可不上传';
  status.classList.toggle('ready', records.length > 0);
  state.uploads[platform] = records.map(({ id, name, type, size, width, height, hash, createdAt }) => ({ id, name, type, size, width, height, hash, createdAt }));
  updateRecognitionButton();
  renderProgress();
}

function updateRecognitionButton() {
  const uploaded = ['wechat', 'alipay'].filter((platform) => imagesByPlatform[platform].length > 0);
  const dirty = uploaded.filter((platform) => {
    const source = state.sources.find((item) => item.id === platform);
    const parserUpgrade = source?.parserVersion !== FinanceOCR.version;
    return source?.needsRecognition === true || !source?.recognizedAt || parserUpgrade;
  });
  const button = $('#recognizeButton');
  button.disabled = uploaded.length === 0;
  button.innerHTML = dirty.length ? `重新识别${dirty.map(platformName).join('、')}截图 <span>→</span>` : '查看已确认结果 <span>→</span>';
}

async function imageDimensions(file) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

async function fileHash(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function handleImageFiles(platform, fileList) {
  const startedAt = performance.now();
  const files = [...fileList];
  if (!files.length) return;
  const existing = imagesByPlatform[platform] || [];
  if (existing.length + files.length > MAX_IMAGES_PER_PLATFORM) {
    showMessage('截图数量过多', `每个平台每月最多保存 ${MAX_IMAGES_PER_PLATFORM} 张截图。`);
    return;
  }
  const invalid = files.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES);
  if (invalid) {
    FinanceDB.addEvent('image_import_rejected', { month: state.month, platform, reason: invalid.size > MAX_IMAGE_BYTES ? 'file_too_large' : 'unsupported_type' }).catch(() => {});
    showMessage('有一张图片无法导入', '仅支持 JPG、PNG、WebP，且单张不超过 15 MB。');
    return;
  }
  const button = $('#recognizeButton');
  button.disabled = true;
  button.textContent = '正在写入本地数据库…';
  try {
    const records = [];
    for (const file of files) {
      const [dimensions, hash] = await Promise.all([imageDimensions(file), fileHash(file)]);
      if ([...existing, ...records].some((record) => record.hash === hash)) continue;
      records.push({
        id: crypto.randomUUID(), month: state.month, platform, name: file.name,
        type: file.type, size: file.size, width: dimensions.width, height: dimensions.height,
        hash, createdAt: new Date().toISOString(), blob: file
      });
    }
    if (!records.length) {
      showMessage('没有新增截图', '这些图片已经保存在当前月份中，无需重复导入。');
      return;
    }
    await FinanceDB.putImages(records);
    imagesByPlatform[platform] = [...existing, ...records];
    const source = state.sources.find((item) => item.id === platform);
    source.needsRecognition = true;
    state.completed = false;
    renderUpload(platform);
    await persistReview();
    await FinanceDB.addEvent('images_added', {
      month: state.month, platform, count: records.length,
      totalBytes: sum(records.map((record) => record.size)), durationMs: Math.round(performance.now() - startedAt)
    });
  } catch (error) {
    FinanceDB.addEvent('image_import_failed', { month: state.month, platform, reason: error?.name || 'unknown_error' }).catch(() => {});
    showMessage('截图保存失败', error.message || '浏览器没有成功保存图片，请重试。');
  } finally {
    button.innerHTML = '整理截图数据 <span>→</span>';
    updateRecognitionButton();
  }
}

async function deleteStoredImage(platform, id) {
  await FinanceDB.deleteImage(id);
  revokeImageUrl(id);
  imagesByPlatform[platform] = imagesByPlatform[platform].filter((record) => record.id !== id);
  const source = state.sources.find((item) => item.id === platform);
  if (imagesByPlatform[platform].length) source.needsRecognition = true;
  else {
    source.entries = source.entries.filter((entry) => entry.inputMethod === 'manual');
    source.total = 0;
    source.recognizedAt = null;
    source.needsRecognition = false;
  }
  renderUpload(platform);
  await persistReview();
  renderReviewImages();
}

function updateOcrProgress({ platform, fileIndex = 0, fileCount = 1, progress = 0, label = '准备本地识别', platformIndex = 0, platformCount = 1 }) {
  const platformProgress = (fileIndex + progress) / Math.max(fileCount, 1);
  const overall = Math.min(1, (platformIndex + platformProgress) / Math.max(platformCount, 1));
  $('#ocrProgressTitle').textContent = `${platformName(platform)} · ${label}`;
  $('#ocrProgressDetail').textContent = `第 ${Math.min(fileIndex + 1, fileCount)} / ${fileCount} 个本地图像处理任务 · 图片不会上传`;
  $('#ocrProgressPercent').textContent = `${Math.round(overall * 100)}%`;
  $('#ocrProgressBar').style.width = `${Math.max(2, overall * 100)}%`;
}

async function startRecognition() {
  if (ocrRunning) return;
  const uploadedPlatforms = ['wechat', 'alipay'].filter((platform) => imagesByPlatform[platform].length > 0);
  if (!uploadedPlatforms.length) return showMessage('请先上传截图', '微信或支付宝至少上传一张汇总截图后才能开始识别。');
  const platforms = uploadedPlatforms.filter((platform) => {
    const source = state.sources.find((item) => item.id === platform);
    const parserUpgrade = source.parserVersion !== FinanceOCR.version;
    return source.needsRecognition === true || !source.recognizedAt || parserUpgrade;
  });
  if (!platforms.length) {
    goStep(3);
    return;
  }
  const button = $('#recognizeButton');
  ocrRunning = true;
  button.disabled = true;
  button.textContent = '正在本地识别…';
  $('#ocrProgress').hidden = false;
  $('#ocrProgressBar').style.width = '2%';
  let successCount = 0;
  const failures = [];
  try {
    for (let platformIndex = 0; platformIndex < platforms.length; platformIndex += 1) {
      const platform = platforms[platformIndex];
      const currentSource = state.sources.find((source) => source.id === platform);
      const manualEntries = currentSource.entries.filter((entry) => entry.inputMethod === 'manual');
      const previousEntries = new Map(currentSource.entries.map((entry) => [`${entry.source}|${Number(entry.amount).toFixed(2)}`, entry]));
      try {
        const recognizedSource = await FinanceOCR.recognizePlatform(platform, imagesByPlatform[platform], state.month, (progress) => updateOcrProgress({ ...progress, platformIndex, platformCount: platforms.length }));
        const manualKeys = new Set(manualEntries.map((entry) => `${entry.source}|${Number(entry.amount).toFixed(2)}`));
        recognizedSource.entries = recognizedSource.entries
          .filter((entry) => !manualKeys.has(`${entry.source}|${Number(entry.amount).toFixed(2)}`))
          .map((entry) => {
            const key = `${entry.source}|${Number(entry.amount).toFixed(2)}`;
            const previous = previousEntries.get(key);
            const remembered = ocrCategoryMappings[`${platform}|${entry.source}`];
            return normalizeClassification({
              ...entry,
              id: previous?.id || crypto.randomUUID(),
              category: previous?.category || remembered?.category || entry.category,
              subcategory: previous?.subcategory || remembered?.subcategory || entry.subcategory,
              include: previous?.include ?? remembered?.include ?? entry.include,
              confirmed: previous ? Boolean(previous.confirmed) : remembered ? true : entry.confirmed,
              note: previous?.note || ''
            });
          });
        recognizedSource.entries.push(...manualEntries);
        recognizedSource.needsRecognition = false;
        state.sources[state.sources.findIndex((source) => source.id === platform)] = recognizedSource;
        successCount += 1;
        await FinanceDB.addEvent('ocr_platform_completed', {
          month: state.month,
          platform,
          durationMs: recognizedSource.durationMs,
          imageCount: recognizedSource.ocrFileCount,
          segmentCount: recognizedSource.ocrSegmentCount,
          entryCount: recognizedSource.entries.length,
          ocrConfidence: recognizedSource.ocrConfidence,
          warningCount: recognizedSource.warnings.length,
          parserVersion: recognizedSource.parserVersion
        });
      } catch (error) {
        failures.push(platformName(platform));
        currentSource.warnings = [`自动识别失败：${error.message || '未知错误'}`];
        currentSource.monthConfirmed = true;
        currentSource.needsRecognition = true;
        await FinanceDB.addEvent('ocr_platform_failed', { month: state.month, platform, reason: error.code || error.name || 'unknown_error' });
      }
    }
    state.recognized = state.sources.some((source) => Boolean(source.recognizedAt));
    state.completed = false;
    await persistReview();
    updateOcrProgress({ platform: platforms.at(-1), fileIndex: 1, fileCount: 1, progress: 1, label: '识别完成', platformIndex: platforms.length - 1, platformCount: platforms.length });
    if (failures.length) showMessage('部分截图未能自动识别', `${failures.join('、')}需要在确认页人工补录；已经成功识别的平台不会受影响。`);
    goStep(3);
  } finally {
    ocrRunning = false;
    updateRecognitionButton();
  }
}

function renderRecognition() {
  const target = $('#recognitionTables');
  target.innerHTML = state.sources.map((source, sourceIndex) => {
    const active = sourceIsActive(source);
    if (!active) {
      return `<article class="recognition-card inactive-platform"><div class="recognition-heading"><span class="platform-logo" style="background:${source.id === 'wechat' ? '#475569' : '#245fa4'}">${source.id === 'wechat' ? '微' : '支'}</span><strong>${source.name}支出</strong><small>本月未上传截图，不参与金额校验和月报统计</small><span class="reconcile-badge pending">本月跳过</span></div></article>`;
    }
    const calculated = sum(source.entries.map((entry) => entry.amount));
    const difference = Number(source.total || 0) - calculated;
    const reconciled = source.total > 0 && Math.abs(difference) < RECONCILIATION_TOLERANCE;
    const pendingEntries = source.entries.filter((entry) => entry.needsConfirm && !entry.confirmed).length;
    const pendingSourceChecks = Number(source.monthConfirmed === false) + Number(source.totalConfirmed === false);
    const badgeClass = source.total <= 0 || pendingEntries + pendingSourceChecks > 0 ? 'pending' : reconciled ? '' : 'mismatch';
    const badgeText = source.total <= 0 ? '待填写截图总额' : !reconciled ? `相差 ${yuan(Math.abs(difference))}` : pendingEntries + pendingSourceChecks > 0 ? `还有 ${pendingEntries + pendingSourceChecks} 项待确认` : Math.abs(difference) > 0.01 ? `✓ 统计误差 ${yuan(Math.abs(difference))}` : `✓ 分类合计 ${yuan(calculated)}`;
    const rows = source.entries.map((entry, entryIndex) => {
      const primaryOptions = [...new Set([...categoryTree.map((group) => group.name), entry.category].filter(Boolean))].map((option) => `<option value="${escapeHtml(option)}" ${option === entry.category ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
      const secondaryOptions = secondaryOptionsFor(entry.category, entry.subcategory).map((option) => `<option value="${escapeHtml(option)}" ${option === entry.subcategory ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
      const isOcr = entry.inputMethod === 'ocr';
      const entryNeedsConfirmation = entry.needsConfirm && !entry.confirmed;
      const sourceLabel = entry.parentSource ? `${entry.parentSource} / ${entry.source}` : entry.source;
      return `<tr class="${entryNeedsConfirmation ? 'needs-confirm' : ''}">
        <td><b>${escapeHtml(sourceLabel)}</b><br><small style="color:#526278">${isOcr ? `本地OCR${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}` : '人工补充'}</small></td>
        <td class="amount"><input class="entry-amount-input" data-source-index="${sourceIndex}" data-entry-index="${entryIndex}" type="number" min="0" step="0.01" value="${entry.amount}" aria-label="修改${escapeHtml(entry.source)}金额" /></td>
        <td><select class="primary-select" data-source-index="${sourceIndex}" data-entry-index="${entryIndex}" aria-label="${escapeHtml(entry.source)}一级分类">${primaryOptions}</select></td>
        <td><select class="secondary-select" data-source-index="${sourceIndex}" data-entry-index="${entryIndex}" aria-label="${escapeHtml(entry.source)}二级分类">${secondaryOptions}</select></td>
        <td><label class="include-check"><input type="checkbox" data-include-source="${sourceIndex}" data-include-entry="${entryIndex}" ${entry.include ? 'checked' : ''} />计入</label></td>
        <td><input class="entry-note-input" data-source-index="${sourceIndex}" data-entry-index="${entryIndex}" type="text" maxlength="60" value="${escapeHtml(entry.note || '')}" placeholder="可选备注" aria-label="${escapeHtml(entry.source)}备注" /></td>
        <td><span class="confidence ${isOcr && entry.confidence < 85 ? 'low' : isOcr ? '' : 'manual'}">${isOcr ? `${entry.confidence}%` : '人工'}</span></td>
        <td>${entryNeedsConfirmation ? `<button class="confirm-action" data-confirm-source="${sourceIndex}" data-confirm-entry="${entryIndex}">请确认</button>` : '<span class="confirmed-mark">✓ 已确认</span>'}</td>
        <td><button class="delete-entry" data-delete-source="${sourceIndex}" data-delete-entry="${entryIndex}" aria-label="删除${escapeHtml(entry.source)}">×</button></td>
      </tr>`;
    }).join('');
    const sourceChecks = [
      source.total > 0 && !reconciled ? `<div class="source-check warning"><span><b>可能存在 OCR 漏项</b><small>当前分类合计比截图总额相差 ${yuan(Math.abs(difference))}；请对照截图，用上方“快速补充截图漏项”添加缺少分类。</small></span></div>` : '',
      source.monthConfirmed === false ? `<div class="source-check warning"><span><b>账单月份需要确认</b><small>${source.detectedMonth ? `识别为 ${source.detectedMonth}，当前复盘月份为 ${state.month}` : '截图中没有可靠识别到月份'}</small></span><button class="confirm-action" data-confirm-source-month="${sourceIndex}">确认属于本月</button></div>` : '',
      source.totalConfirmed === false ? `<div class="source-check warning"><span><b>平台总支出需要确认</b><small>${source.totalSource === 'category_sum' ? `暂用分类合计 ${yuan(source.total)}` : `本地OCR读取为 ${yuan(source.total)}`}</small></span><button class="confirm-action" data-confirm-source-total="${sourceIndex}">确认总额</button></div>` : '',
      ...(source.warnings || []).map((warning) => `<div class="source-check"><span><b>识别提示</b><small>${escapeHtml(warning)}</small></span></div>`)
    ].filter(Boolean).join('');
    return `<article class="recognition-card">
      <div class="recognition-heading"><span class="platform-logo" style="background:${source.id === 'wechat' ? '#475569' : '#245fa4'}">${source.id === 'wechat' ? '微' : '支'}</span><strong>${source.name}支出</strong><small>${source.entries.length} 个平台分类项 · 截图总额 ${source.total > 0 ? yuan(source.total) : '待填写'}${source.ocrConfidence ? ` · OCR ${source.ocrConfidence}%` : ''}</small><span class="reconcile-badge ${badgeClass}">${badgeText}</span></div>
      ${sourceChecks ? `<div class="source-checks">${sourceChecks}</div>` : ''}
      ${source.entries.length ? `<table class="recognition-table"><thead><tr><th>平台原分类</th><th>金额</th><th>一级分类</th><th>二级分类</th><th>是否计入</th><th>备注</th><th>置信度</th><th>状态</th><th>删除</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="recognition-empty">自动识别没有提取到一级分类。请对照右侧截图手动补充，或返回上传页重新识别。</div>'}
    </article>`;
  }).join('');
  $('#wechatDeclaredTotal').value = state.sources.find((source) => source.id === 'wechat')?.total || '';
  $('#alipayDeclaredTotal').value = state.sources.find((source) => source.id === 'alipay')?.total || '';
  state.sources.forEach((source) => { $(`#${source.id}DeclaredTotal`).disabled = !sourceIsActive(source); });
  const activePlatforms = state.sources.filter(sourceIsActive).map((source) => source.id);
  $$('#manualEntryPlatform option').forEach((option) => { option.disabled = !activePlatforms.includes(option.value); });
  if (!activePlatforms.includes($('#manualEntryPlatform').value) && activePlatforms.length) $('#manualEntryPlatform').value = activePlatforms[0];
  $('#addManualEntry').disabled = activePlatforms.length === 0;
  renderManualCategoryControls();
  renderReviewImages();
  updatePending();
}

function updatePending() {
  const results = reconciliationResults();
  const required = results.length;
  const passed = results.filter((item) => item.ok).length;
  const pendingConfirmations = sum(results.map((item) => item.pendingEntries + Number(!item.totalOk) + Number(!item.monthOk)));
  const amountMismatches = results.filter((item) => !item.amountOk).length;
  $('#pendingCopy').textContent = required > 0 && passed === required
    ? `${required} 个已上传平台金额和识别结果均已核对`
    : `${amountMismatches ? `${amountMismatches} 个平台金额待校验` : '金额已在容差内'}${pendingConfirmations ? ` · ${pendingConfirmations} 项待人工确认` : ''}`;
  $('#continueExtraButton').disabled = required === 0 || passed < required;
  const score = $('#reconcileScore');
  score.innerHTML = required > 0 && passed === required
    ? `<span>确定性校验</span><b>✓ ${passed} / ${required} 通过</b><small>金额差额在 ${yuan(RECONCILIATION_TOLERANCE)} 容差内，所有低置信度项已确认</small>`
    : `<span>确定性校验</span><b>${passed} / ${required || 1} 通过</b><small>${amountMismatches ? `请补充漏项或修正金额，使差额小于 ${yuan(RECONCILIATION_TOLERANCE)}` : '金额已通过，请确认低置信度识别项'}</small>`;
  renderProgress();
}

function selectOptionsMarkup(values, selected) {
  return [...new Set(values.filter(Boolean))].map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

function renderCategoryPairControls(primarySelector, secondarySelector, preferred = {}) {
  const primary = $(primarySelector);
  const secondary = $(secondarySelector);
  if (!primary || !secondary) return;
  const selectedPrimary = preferred.category || primary.value || categoryTree[0]?.name || '其他';
  const primaryNames = [...new Set([...categoryTree.map((group) => group.name), selectedPrimary])];
  primary.innerHTML = selectOptionsMarkup(primaryNames, selectedPrimary);
  const selectedSecondary = preferred.subcategory || secondary.value || secondaryOptionsFor(selectedPrimary)[0] || '其他';
  secondary.innerHTML = selectOptionsMarkup(secondaryOptionsFor(selectedPrimary, selectedSecondary), selectedSecondary);
}

function renderManualCategoryControls() {
  renderCategoryPairControls('#manualEntryPrimary', '#manualEntrySecondary');
  renderCategoryPairControls('#extraExpensePrimary', '#extraExpenseSecondary');
}

function addManualRecognitionEntry() {
  const platform = $('#manualEntryPlatform').value;
  const sourceName = $('#manualEntrySource').value.trim();
  const amount = Number($('#manualEntryAmount').value || 0);
  if (!sourceName || amount <= 0) return showMessage('请补全分类和金额', '平台原分类不能为空，金额需要大于 0。');
  const source = state.sources.find((item) => item.id === platform);
  if (!source || !sourceIsActive(source)) return showMessage('这个平台本月未上传', '请先返回上传页，为该平台添加至少一张截图。');
  const selectedCategory = $('#manualEntryPrimary').value || '其他';
  const selectedSubcategory = $('#manualEntrySecondary').value || '其他';
  source.entries.push({
    id: crypto.randomUUID(), source: sourceName, amount, category: selectedCategory,
    subcategory: selectedSubcategory, note: $('#manualEntryNote').value.trim(),
    confidence: null, needsConfirm: false, confirmed: true, include: true, inputMethod: 'manual'
  });
  $('#manualEntrySource').value = '';
  $('#manualEntryAmount').value = '';
  $('#manualEntryNote').value = '';
  state.completed = false;
  save();
  renderRecognition();
}

function renderReviewImages() {
  const records = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay];
  $('#localImageCount').textContent = `${records.length} 张`;
  $('#reviewImageStrip').innerHTML = records.length ? records.map((record) => `<button class="review-image-item" data-preview-image="${record.id}"><img src="${imageUrl(record)}" alt="${platformName(record.platform)}截图缩略图" /><span><b>${platformName(record.platform)} · ${escapeHtml(record.name)}</b><small>${record.width} × ${record.height}</small><small>${formatFileSize(record.size)} · 仅本地可见</small></span></button>`).join('') : '<div class="empty-state">本月尚未保存截图</div>';
}

function openStoredImage(id) {
  const record = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay].find((item) => item.id === id);
  if (!record) return;
  $('#imageDialogPlatform').textContent = `${platformName(record.platform)} · 本地截图`;
  $('#imageDialogTitle').textContent = record.name;
  $('#imageDialogPreview').src = imageUrl(record);
  openDialog('imageDialog');
}

function reportDataFor(review) {
  const income = sum([...Object.values(review.income || {}), ...(review.customIncome || []).map((item) => item.amount)]);
  const includedEntries = (review.sources || []).flatMap((source) => source.entries.filter((entry) => entry.include).map((entry) => ({ ...entry, platform: source.id })));
  const excludedEntries = (review.sources || []).flatMap((source) => source.entries.filter((entry) => !entry.include).map((entry) => ({ ...entry, platform: source.id })));
  const extraEntries = (review.extraExpenses || []).map((entry) => ({ source: `${entry.source} · ${entry.note || `${entry.category}/${entry.subcategory || '其他'}`}`, amount: entry.amount, category: entry.category, subcategory: entry.subcategory || '其他', note: entry.note || '', platform: 'other', include: true }));
  const allIncluded = [...includedEntries, ...extraEntries];
  const expense = sum(allIncluded.map((entry) => entry.amount));
  const byCategory = allIncluded.reduce((result, entry) => {
    result[entry.category] = (result[entry.category] || 0) + entry.amount;
    return result;
  }, {});
  const bySubcategory = allIncluded.reduce((result, entry) => {
    const primary = entry.category || '其他';
    const secondary = entry.subcategory || '其他';
    if (!result[primary]) result[primary] = {};
    result[primary][secondary] = (result[primary][secondary] || 0) + entry.amount;
    return result;
  }, {});
  const incomeMix = {
    salary: Number(review.income?.salary || 0), side: Number(review.income?.side || 0),
    investment: Number(review.income?.investment || 0),
    other: Number(review.income?.other || 0) + sum((review.customIncome || []).map((item) => item.amount))
  };
  return {
    income, expense, surplus: income - expense, rate: income ? (income - expense) / income * 100 : 0,
    byCategory, bySubcategory, excludedEntries, incomeMix,
    importedExpense: sum(includedEntries.map((entry) => entry.amount)),
    extraExpense: sum(extraEntries.map((entry) => entry.amount))
  };
}

function reportData() {
  return reportDataFor(state);
}

const changeRate = (current, previous) => previous ? (current - previous) / previous * 100 : null;
const changeLabel = (value) => value === null ? '暂无对比' : `${value >= 0 ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%`;

function reportMarkup() {
  const report = reportData();
  const categoryEntries = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]);
  const previousMonth = PREVIOUS_MONTH;
  const incomeMoM = changeRate(report.income, previousMonth?.income || 0);
  const incomeYoY = changeRate(report.income, YEAR_AGO.income);
  const expenseMoM = changeRate(report.expense, previousMonth?.expense || 0);
  const expenseYoY = changeRate(report.expense, YEAR_AGO.expense);
  const currentMix = Object.fromEntries(Object.entries(report.incomeMix).map(([key, value]) => [key, report.income ? value / report.income * 100 : 0]));
  const mixMonths = [...HISTORY.slice(-3), { month: monthShortLabel(state.month), income: report.income, expense: report.expense, incomeMix: currentMix }];
  const incomeMeta = [
    ['salary', '工资'], ['side', '副业'], ['investment', '投资理财'], ['other', '其他']
  ];
  let accumulatedIncome = 0;
  const incomeLabels = incomeMeta.map(([key, name]) => {
    const percent = currentMix[key] || 0;
    const top = (100 - accumulatedIncome - percent / 2) * 2;
    accumulatedIncome += percent;
    return { key, name, percent, top };
  }).filter((item) => item.percent > 0.05).sort((a, b) => a.top - b.top);
  incomeLabels.forEach((item, index) => {
    item.top = Math.max(8, item.top, index ? incomeLabels[index - 1].top + 29 : 8);
  });
  const overflow = incomeLabels.length ? incomeLabels.at(-1).top - 190 : 0;
  if (overflow > 0) incomeLabels.forEach((item) => { item.top -= overflow; });
  const incomeLabelMarkup = incomeLabels.map((item) => `<span class="stack-direct-label" style="top:${item.top}px"><i class="${item.key}"></i><b>${item.name}</b><em>${item.percent.toFixed(1)}%</em></span>`).join('');
  const stackedColumns = mixMonths.map((month, index) => {
    const isCurrent = index === mixMonths.length - 1;
    const segments = incomeMeta.map(([key, name]) => `<div class="stack-segment ${key}" style="height:${month.incomeMix[key]}%" title="${name} ${month.incomeMix[key].toFixed(1)}%"></div>`).join('');
    return `<div class="stack-column${isCurrent ? ' current' : ''}">${segments}<span>${month.month}${isCurrent ? '（本月）' : ''}</span>${isCurrent ? `<div class="stack-direct-labels">${incomeLabelMarkup}</div>` : ''}</div>`;
  }).join('');
  const palette = ['#173f70','#245fa4','#4d7fb5','#7399c2','#98b3d0','#bbcbdc','#64748b','#9aa4b1','#cbd5e1','#334155','#d8dee8'];
  const visiblePieEntries = categoryEntries.slice(0, 6);
  const remainingPieAmount = sum(categoryEntries.slice(6).map(([, amount]) => amount));
  if (remainingPieAmount > 0) visiblePieEntries.push(['其他分类', remainingPieAmount]);
  const pieWidth = 420, pieHeight = 286, pieCenterX = 210, pieCenterY = 143, pieRadius = 82;
  const piePoint = (percent, radius) => {
    const angle = (percent * 3.6 - 90) * Math.PI / 180;
    return { x: pieCenterX + Math.cos(angle) * radius, y: pieCenterY + Math.sin(angle) * radius };
  };
  let pieRunning = 0;
  const pieParts = visiblePieEntries.map(([name, amount], index) => {
    const percent = report.expense ? amount / report.expense * 100 : 0;
    const start = pieRunning;
    const end = pieRunning + percent;
    const startPoint = piePoint(start, pieRadius);
    const endPoint = piePoint(end, pieRadius);
    const midPoint = piePoint(start + percent / 2, pieRadius + 7);
    const elbowPoint = piePoint(start + percent / 2, pieRadius + 24);
    const isRight = elbowPoint.x >= pieCenterX;
    pieRunning = end;
    return {
      name, percent, startPoint, endPoint, midPoint, elbowPoint, isRight,
      color: palette[index % palette.length],
      path: `M ${pieCenterX} ${pieCenterY} L ${startPoint.x.toFixed(2)} ${startPoint.y.toFixed(2)} A ${pieRadius} ${pieRadius} 0 ${percent > 50 ? 1 : 0} 1 ${endPoint.x.toFixed(2)} ${endPoint.y.toFixed(2)} Z`
    };
  });
  ['left', 'right'].forEach((side) => {
    const sideParts = pieParts.filter((item) => item.isRight === (side === 'right')).sort((a, b) => a.elbowPoint.y - b.elbowPoint.y);
    sideParts.forEach((item, index) => {
      item.labelY = Math.max(23, item.elbowPoint.y, index ? sideParts[index - 1].labelY + 29 : 23);
    });
    const sideOverflow = sideParts.length ? sideParts.at(-1).labelY - (pieHeight - 23) : 0;
    if (sideOverflow > 0) sideParts.forEach((item) => { item.labelY -= sideOverflow; });
  });
  const expensePieSvg = `<svg class="expense-pie" viewBox="0 0 ${pieWidth} ${pieHeight}" role="img" aria-label="本月支出分类及百分比饼图">
    ${pieParts.map((item) => `<path d="${item.path}" fill="${item.color}" stroke="#fff" stroke-width="2"></path>`).join('')}
    ${pieParts.map((item) => {
      const lineEndX = item.isRight ? 352 : 68;
      const textX = item.isRight ? lineEndX + 7 : lineEndX - 7;
      return `<polyline points="${item.midPoint.x.toFixed(1)},${item.midPoint.y.toFixed(1)} ${item.elbowPoint.x.toFixed(1)},${item.labelY.toFixed(1)} ${lineEndX},${item.labelY.toFixed(1)}" fill="none" stroke="${item.color}" stroke-width="1.4"></polyline><text x="${textX}" y="${item.labelY + 3}" text-anchor="${item.isRight ? 'start' : 'end'}"><tspan class="pie-label-name">${escapeHtml(item.name)}</tspan><tspan class="pie-label-percent"> ${item.percent.toFixed(1)}%</tspan></text>`;
    }).join('')}
  </svg>`;
  const changeItems = [...new Set([...Object.keys(YEAR_AGO.categories || {}), ...Object.keys(report.byCategory)])].map((name) => {
    const current = report.byCategory[name] || 0;
    const previous = YEAR_AGO.categories[name] || 0;
    const delta = current - previous;
    const rate = previous ? delta / previous * 100 : null;
    return { name, current, previous, delta, rate };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const changeRows = changeItems.map((item, categoryIndex) => {
    const currentChildren = report.bySubcategory[item.name] || {};
    const previousChildren = YEAR_AGO.subcategories?.[item.name] || {};
    const childItems = [...new Set([...Object.keys(currentChildren), ...Object.keys(previousChildren)])].map((name) => {
      const current = currentChildren[name] || 0;
      const previous = previousChildren[name] || 0;
      const delta = current - previous;
      const rate = previous ? delta / previous * 100 : null;
      return { name, current, previous, delta, rate };
    }).sort((a, b) => b.current - a.current);
    const hasChildren = childItems.length > 0;
    const parentRow = `<tr class="category-main-row"><td><button type="button" class="category-expand-button" data-toggle-category="${categoryIndex}" aria-expanded="false" ${hasChildren ? '' : 'disabled'}><span class="category-chevron">›</span><b>${escapeHtml(item.name)}</b><small>${childItems.length} 个二级分类</small></button></td><td>${yuan(item.current)}</td><td>${YEAR_AGO.income ? yuan(item.previous) : '暂无数据'}</td><td class="${item.delta >= 0 ? 'change-up' : 'change-down'}">${YEAR_AGO.income ? `${item.delta >= 0 ? '↑' : '↓'} ${yuan(Math.abs(item.delta))}` : '—'}</td><td class="${item.delta >= 0 ? 'change-up' : 'change-down'}">${YEAR_AGO.income ? (item.rate === null ? '新增' : `${item.rate >= 0 ? '+' : ''}${item.rate.toFixed(1)}%`) : '—'}</td></tr>`;
    const childRows = childItems.map((child) => `<tr class="subcategory-row" data-category-group="${categoryIndex}" hidden><td><span class="subcategory-name">${escapeHtml(child.name)}</span></td><td>${yuan(child.current)}</td><td>${YEAR_AGO.income ? yuan(child.previous) : '暂无数据'}</td><td class="${child.delta >= 0 ? 'change-up' : 'change-down'}">${YEAR_AGO.income ? `${child.delta >= 0 ? '↑' : '↓'} ${yuan(Math.abs(child.delta))}` : '—'}</td><td class="${child.delta >= 0 ? 'change-up' : 'change-down'}">${YEAR_AGO.income ? (child.rate === null ? '新增' : `${child.rate >= 0 ? '+' : ''}${child.rate.toFixed(1)}%`) : '—'}</td></tr>`).join('');
    return parentRow + childRows;
  }).join('');
  return `<div class="report-kpis">
    <article class="report-kpi"><span>收入总额</span><strong>${yuan(report.income)}</strong><small>本月手动确认收入</small><div class="change-pills"><span class="change-pill">环比 ${changeLabel(incomeMoM)}</span><span class="change-pill">同比 ${changeLabel(incomeYoY)}</span></div></article>
    <article class="report-kpi"><span>支出总额</span><strong>${yuan(report.expense)}</strong><small>已上传平台＋其他支出补充</small><div class="change-pills"><span class="change-pill">环比 ${changeLabel(expenseMoM)}</span><span class="change-pill">同比 ${changeLabel(expenseYoY)}</span></div></article>
    <article class="report-kpi primary"><span>本月结余</span><strong>${yuan(report.surplus)}</strong><small>结余率 ${report.rate.toFixed(1)}%</small><div class="change-pills"><span class="change-pill">收入减去全部支出</span></div></article>
  </div>
  <article class="sankey-card"><div class="report-card-head"><div><h3>家庭资金流向</h3><p>收入来源汇入本月总收入，再分流为支出与结余。</p></div><small>桑基图 · 金额越大，流线越宽</small></div><div class="sankey-wrap"><canvas id="cashflowSankey" aria-label="收入、支出与结余桑基图"></canvas></div></article>
  <div class="analysis-grid">
    <article class="analysis-card"><div class="report-card-head"><div><h3>收入结构</h3><p>各类收入占当月收入的百分比。</p></div><small>100% 堆积柱状图</small></div><div class="stacked-chart">${stackedColumns}</div><div class="chart-legend"><span><i style="background:#173f70"></i>工资</span><span><i style="background:#477ab2"></i>副业</span><span><i style="background:#87a9cd"></i>投资理财</span><span><i style="background:#c6d5e5"></i>其他</span></div></article>
    <article class="analysis-card"><div class="report-card-head"><div><h3>支出结构</h3><p>本月统一一级分类占比；较小分类合并为“其他分类”。</p></div><small>饼图 · 类别与占比直接标注</small></div><div class="pie-chart-wrap">${expensePieSvg}</div></article>
  </div>
  <article class="category-change-card"><div class="report-card-head"><div><h3>支出一级大类同比变动</h3><p>点击一级分类可以展开二级分类；优先显示变动金额较大的分类。</p></div><small>${YEAR_AGO.income ? `${monthLabel(state.month)} vs 去年同期` : '完成去年同期月份后自动生成'}</small></div><table class="category-change-table"><thead><tr><th>一级／二级分类</th><th>本月</th><th>去年同月</th><th>变动金额</th><th>同比</th></tr></thead><tbody>${changeRows || '<tr><td colspan="5" style="text-align:center;color:#64748b">暂无已确认的支出分类</td></tr>'}</tbody></table></article>
  <div class="report-insight"><span>◎</span><div><b>报表口径说明</b><small>收入为手动填写；支出由微信、支付宝确认结果与银行卡/现金补充记录构成。同比环比只使用当前浏览器中真实保存的历史月份，不预填示例成绩。</small></div></div>`;
}

function renderReports() {
  const markup = reportMarkup();
  $('#mainReport').innerHTML = markup;
  $('#reportStatusText').textContent = state.completed ? '已完成 · 数据保存在当前浏览器' : '进行中 · 仅显示当前已保存的数据';
  $('#reportMonth').value = state.month;
  requestAnimationFrame(() => drawSankey(reportData()));
}

function renderExtraExpenses() {
  const total = sum(state.extraExpenses.map((entry) => entry.amount));
  $('#extraExpenseTotal').textContent = yuan(total);
  $('#extraExpenseList').innerHTML = state.extraExpenses.length ? state.extraExpenses.map((entry, index) => `<div class="extra-expense-item"><div><b>${escapeHtml(entry.category)} / ${escapeHtml(entry.subcategory || '其他')} · ${escapeHtml(entry.source)}</b><small>${escapeHtml(entry.note || '无备注')}</small></div><strong>${yuan(entry.amount)}</strong><button class="delete-extra" data-delete-extra="${index}" aria-label="删除补充记录">×</button></div>`).join('') : '<div class="empty-state">目前没有补充记录</div>';
  renderProgress();
}

function addExtraExpense() {
  const amount = Number($('#extraExpenseAmount').value || 0);
  if (amount <= 0) return showMessage('请输入金额', '补充支出的金额需要大于 0。');
  state.extraExpenses.push({ source: $('#extraExpenseSource').value, category: $('#extraExpensePrimary').value, subcategory: $('#extraExpenseSecondary').value, amount, note: $('#extraExpenseNote').value.trim() });
  $('#extraExpenseAmount').value = '';
  $('#extraExpenseNote').value = '';
  save();
  renderExtraExpenses();
  renderOverviewHistory();
}

function renderCompletionSummary() {
  const report = reportData();
  $('#completionSummary').innerHTML = `<article class="completion-item"><span>本月收入</span><strong>${yuan(report.income)}</strong><small>手动填写并确认</small></article><article class="completion-item"><span>截图识别支出</span><strong>${yuan(report.importedExpense)}</strong><small>微信＋支付宝</small></article><article class="completion-item"><span>其他支出补充</span><strong>${yuan(report.extraExpense)}</strong><small>银行卡、现金等</small></article><article class="completion-item"><span>本月结余</span><strong>${yuan(report.surplus)}</strong><small>完整分析请进入月度报告</small></article>`;
}

async function completeReview() {
  if (reconciliationResults().some((item) => !item.ok)) {
    goStep(3);
    return showMessage('请先完成金额校验', `每个平台差额小于 ${yuan(RECONCILIATION_TOLERANCE)} 可通过；更大的差额请补充漏识别分类。`);
  }
  state.completed = true;
  state.completedAt = new Date().toISOString();
  await persistReview();
  await FinanceDB.addEvent('review_completed', {
    month: state.month,
    categoryCount: state.sources.flatMap((source) => source.entries).length,
    imageCount: imagesByPlatform.wechat.length + imagesByPlatform.alipay.length,
    durationMs: state.reviewStartedAt ? new Date(state.completedAt).getTime() - new Date(state.reviewStartedAt).getTime() : null
  });
  if ($('#deleteImagesToggle').checked) {
    const records = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay];
    await Promise.all(records.map((record) => FinanceDB.deleteImage(record.id)));
    records.forEach((record) => revokeImageUrl(record.id));
    imagesByPlatform = { wechat: [], alipay: [] };
    state.uploads = { wechat: [], alipay: [] };
    await persistReview();
  }
  await refreshHistoryData();
  updateMonthUI();
  goStep(5);
}

function drawSankey(report) {
  const canvas = $('#cashflowSankey');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height, nodeW = 12, usable = Math.min(238, h - 64), centerX = w * .49, rightX = w - 112, leftX = 112;
  const incomeItems = [
    ['工资', report.incomeMix.salary, '#173f70'], ['副业', report.incomeMix.side, '#477ab2'],
    ['投资理财', report.incomeMix.investment, '#87a9cd'], ['其他收入', report.incomeMix.other, '#c6d5e5']
  ].filter((item) => item[1] > 0);
  const total = Math.max(report.income, 1), gap = 10;
  const scale = (usable - gap * (incomeItems.length - 1)) / total;
  let leftY = (h - (usable - gap * (incomeItems.length - 1) + gap * (incomeItems.length - 1))) / 2;
  let centerY = (h - usable) / 2;
  const flow = (x1, y1a, y1b, x2, y2a, y2b, color) => {
    const curve = (x2 - x1) * .46;
    ctx.beginPath(); ctx.moveTo(x1, y1a); ctx.bezierCurveTo(x1 + curve, y1a, x2 - curve, y2a, x2, y2a); ctx.lineTo(x2, y2b); ctx.bezierCurveTo(x2 - curve, y2b, x1 + curve, y1b, x1, y1b); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  };
  ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'middle';
  incomeItems.forEach(([name, value, color]) => {
    const thickness = Math.max(3, value * scale);
    flow(leftX + nodeW, leftY, leftY + thickness, centerX, centerY, centerY + thickness, `${color}66`);
    ctx.fillStyle = color; ctx.fillRect(leftX, leftY, nodeW, thickness);
    ctx.fillStyle = '#334155'; ctx.textAlign = 'right'; ctx.fillText(name, leftX - 8, leftY + thickness / 2);
    ctx.fillStyle = '#64748b'; ctx.font = '9px "Microsoft YaHei", sans-serif'; ctx.fillText(yuan(value), leftX - 8, leftY + thickness / 2 + 14); ctx.font = '11px "Microsoft YaHei", sans-serif';
    leftY += thickness + gap; centerY += thickness;
  });
  const totalY = (h - usable) / 2; ctx.fillStyle = '#245fa4'; ctx.fillRect(centerX, totalY, nodeW, usable);
  ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.font = '700 11px "Microsoft YaHei", sans-serif'; ctx.fillText('本月总收入', centerX + nodeW / 2, totalY - 16); ctx.font = '10px "Microsoft YaHei", sans-serif'; ctx.fillText(yuan(report.income), centerX + nodeW / 2, totalY + usable + 16);
  const expenseRatio = Math.min(report.expense / total, 1), expenseH = usable * expenseRatio, surplusH = Math.max(0, usable - expenseH), rightGap = surplusH > 0 ? 14 : 0;
  const adjustedExpenseH = Math.max(4, expenseH - rightGap / 2), adjustedSurplusH = Math.max(0, surplusH - rightGap / 2);
  flow(centerX + nodeW, totalY, totalY + adjustedExpenseH, rightX, totalY, totalY + adjustedExpenseH, '#d85b6666');
  ctx.fillStyle = '#d85b66'; ctx.fillRect(rightX, totalY, nodeW, adjustedExpenseH); ctx.fillStyle = '#a33a46'; ctx.textAlign = 'left'; ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.fillText('支出', rightX + 20, totalY + adjustedExpenseH / 2 - 7); ctx.font = '9px "Microsoft YaHei", sans-serif'; ctx.fillText(yuan(report.expense), rightX + 20, totalY + adjustedExpenseH / 2 + 8);
  if (adjustedSurplusH > 0) {
    const sy = totalY + adjustedExpenseH + rightGap;
    flow(centerX + nodeW, totalY + adjustedExpenseH, totalY + usable, rightX, sy, sy + adjustedSurplusH, '#2f8a6266');
    ctx.fillStyle = '#2f8a62'; ctx.fillRect(rightX, sy, nodeW, adjustedSurplusH); ctx.fillStyle = '#1f6a49'; ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.fillText('结余', rightX + 20, sy + adjustedSurplusH / 2 - 7); ctx.font = '9px "Microsoft YaHei", sans-serif'; ctx.fillText(yuan(report.surplus), rightX + 20, sy + adjustedSurplusH / 2 + 8);
  }
}

function renderOverviewHistory() {
  const current = reportData();
  const months = [...HISTORY.slice(-3), { month: monthShortLabel(state.month), key: state.month, income: current.income, expense: current.expense }];
  const max = Math.max(...months.map((item) => item.income), 1);
  $('#overviewHistoryBars').innerHTML = months.map((item) => `<div class="history-bar-group"><i class="income" style="height:${item.income / max * 100}%" title="收入 ${yuan(item.income)}"></i><i class="expense" style="height:${item.expense / max * 100}%" title="支出 ${yuan(item.expense)}"></i><span>${item.month}</span></div>`).join('');
  $('#historyCumulative').textContent = yuan(sum(months.map((item) => item.income - item.expense)));
  $('#historyAverageRate').textContent = `${(sum(months.map((item) => item.income ? (item.income - item.expense) / item.income * 100 : 0)) / months.length).toFixed(1)}%`;
  $('#historyHighestExpense').textContent = months.reduce((highest, item) => item.expense > highest.expense ? item : highest, months[0]).month;
  const records = [...allReviews.filter((review) => review.month !== state.month), state].sort((a, b) => b.month.localeCompare(a.month));
  $('#historyLedger').innerHTML = records.length ? records.map((review) => {
    const report = reportDataFor(review);
    const isCurrent = review.month === state.month;
    return `<button class="month-record ${isCurrent ? 'current' : ''}" data-open-review-month="${review.month}"><span><b>${monthShortLabel(review.month)}</b><small>${review.completed ? '已完成' : '进行中'}</small></span><span><b>${review.completed ? `结余 ${yuan(report.surplus)}` : '继续复盘'}</b><small>${review.completed ? `结余率 ${report.rate.toFixed(1)}%` : '打开 →'}</small></span></button>`;
  }).join('') : '<div class="empty-state">完成第一个月份后，这里会形成历史档案。</div>';
}

async function refreshHistoryData() {
  allReviews = (await FinanceDB.listReviews()).map((review) => normalizeReview(review, review.month));
  const summaries = allReviews.filter((review) => review.completed && review.month !== state.month && review.month < state.month).sort((a, b) => a.month.localeCompare(b.month)).map((review) => {
    const report = reportDataFor(review);
    const incomeMix = Object.fromEntries(Object.entries(report.incomeMix).map(([key, value]) => [key, report.income ? value / report.income * 100 : 0]));
    return { key: review.month, month: monthShortLabel(review.month), income: report.income, expense: report.expense, incomeMix };
  });
  HISTORY = summaries;
  const [year, month] = state.month.split('-').map(Number);
  const previousDate = new Date(year, month - 2, 1);
  const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
  PREVIOUS_MONTH = summaries.find((summary) => summary.key === previousKey) || null;
  const yearAgoKey = `${year - 1}-${String(month).padStart(2, '0')}`;
  const yearAgoReview = allReviews.find((review) => review.completed && review.month === yearAgoKey);
  if (yearAgoReview) {
    const report = reportDataFor(yearAgoReview);
    YEAR_AGO = { income: report.income, expense: report.expense, categories: report.byCategory, subcategories: report.bySubcategory };
  } else YEAR_AGO = { income: 0, expense: 0, categories: {}, subcategories: {} };
  renderOverviewHistory();
}

function showGuide(platform) {
  const isWechat = platform === 'wechat';
  $('#guideEyebrow').textContent = isWechat ? '微信截图指引' : '支付宝截图指引';
  $('#guideTitle').textContent = isWechat ? '如何获取微信支出汇总截图' : '如何获取支付宝支出汇总截图';
  const steps = isWechat ? [
    ['进入账单统计', '微信 → 我 → 服务 → 钱包 → 账单 → 统计'],
    ['选择月份与支出', '切换到需要复盘的月份，并选择“支出”'],
    ['展开全部分类', '确保页面包含月份、共支出和全部分类金额'],
    ['截取长截图', '截到“收起”为止，下方“每日对比”不需要上传']
  ] : [
    ['进入月度账单统计', '支付宝 → 我的 → 账单 → 收支分析 → 月度账单'],
    ['打开支出分类', '选择需要复盘的月份，并切换到“支出分类”'],
    ['保留当前展开状态', '一级分类和已展开的浅蓝色二级明细都可以识别，不必逐项调整'],
    ['截取完整分类', '截图应包含月份和所有分类；不支持长截图可按从上到下顺序上传多张']
  ];
  const preview = isWechat
    ? '<div class="capture-preview wechat-preview"><div class="capture-preview-head"><span>2026年8月</span><b>共支出 ¥2,715.40</b></div><div class="capture-preview-row"><span>餐饮</span><b>¥1,577.18</b></div><div class="capture-preview-row"><span>交通</span><b>¥509.40</b></div><div class="capture-preview-row muted"><span>……全部分类直到列表结束</span></div></div>'
    : '<div class="capture-preview alipay-preview"><div class="capture-preview-head"><span>2026年8月 · 支出分类</span><b>月度账单</b></div><div class="capture-preview-row"><span>1. 餐饮美食</span><b>¥719.78</b></div><div class="capture-preview-sub"><span>正餐 ¥613.49</span><span>咖啡奶茶 ¥101.30</span></div><div class="capture-preview-row muted"><span>……全部分类直到列表结束</span></div></div>';
  $('#guideContent').innerHTML = `<div class="guide-layout"><div class="guide-steps">${steps.map(([title, copy], index) => `<div class="guide-step"><span>${index + 1}</span><div><b>${title}</b><small>${copy}</small></div></div>`).join('')}</div><div><span class="guide-example-label">合格截图示意（虚构金额）</span>${preview}<div class="guide-privacy">只上传分类汇总；请勿上传含交易对象、商品名称或账号信息的逐笔明细。</div></div></div><div class="guide-tip">${isWechat ? '如果分多张截图上传，第一张请尽量包含月份和总支出，并按从上到下的顺序选择。' : '展开二级分类时，系统会先核对二级合计与一级总额；无法核对时保留一级总额并要求人工确认。'}</div>`;
  FinanceDB.addEvent('screenshot_guide_opened', { month: state.month, platform }).catch(() => {});
  openDialog('guideDialog');
}

function exportBlob(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+@]/.test(text) || /^-(?!\d)/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function currentMonthCsv() {
  const rows = [['月份', '记录类型', '平台/渠道', '平台原分类', '一级分类', '二级分类', '金额', '是否计入统计', '录入方式', '备注']];
  const incomeLabels = { salary: '工资收入', side: '副业收入', investment: '投资/理财收入', other: '其他收入' };
  Object.entries(state.income || {}).forEach(([key, amount]) => {
    if (Number(amount) > 0) rows.push([state.month, '收入', '手动填写', incomeLabels[key] || key, incomeLabels[key] || key, '', Number(amount).toFixed(2), '是', '手动', '']);
  });
  (state.customIncome || []).forEach((item) => {
    if (Number(item.amount) > 0) rows.push([state.month, '收入', '手动填写', item.name, item.name, '', Number(item.amount).toFixed(2), '是', '手动', '']);
  });
  (state.sources || []).forEach((source) => source.entries.forEach((entry) => rows.push([
    state.month, '支出', source.name, entry.source, entry.category, entry.subcategory || '其他', Number(entry.amount || 0).toFixed(2), entry.include ? '是' : '否', entry.inputMethod === 'ocr' ? '截图识别' : '手动补充', entry.note || ''
  ])));
  (state.extraExpenses || []).forEach((entry) => rows.push([
    state.month, '支出', entry.source, '', entry.category, entry.subcategory || '其他', Number(entry.amount || 0).toFixed(2), '是', '平台外补充', entry.note || ''
  ]));
  return `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

async function exportCurrentMonthCsv() {
  await persistReview();
  exportBlob(`家财月报-${state.month}.csv`, currentMonthCsv(), 'text/csv;charset=utf-8');
  await FinanceDB.addEvent('csv_exported', { month: state.month });
  showMessage('CSV 已导出', '可用 Excel、WPS 或其他表格软件打开。CSV 不含截图，也不能用于完整恢复本工具。');
}

async function exportTrialEventsCsv() {
  const events = (await FinanceDB.listEvents()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const rows = [['事件时间', '应用版本', '事件类型', '复盘月份', '平台', '耗时毫秒', '图片数', '切片数', '识别记录数', 'OCR置信度', '警告数', '解析器版本', '错误原因', '修改字段', '分类记录数']];
  events.forEach((event) => rows.push([
    event.createdAt || '', APP_VERSION, event.type || '', event.month || '', event.platform || '',
    event.durationMs ?? '', event.imageCount ?? event.count ?? '', event.segmentCount ?? '', event.entryCount ?? '',
    event.ocrConfidence ?? '', event.warningCount ?? '', event.parserVersion ?? '', event.reason ?? '', event.field ?? '', event.categoryCount ?? ''
  ]));
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  exportBlob(`家财月报-试用事件-${state.month}.csv`, csv, 'text/csv;charset=utf-8');
  await FinanceDB.addEvent('trial_events_exported', { month: state.month, eventCount: events.length });
  showMessage('试用事件已导出', `共导出 ${events.length} 条流程事件，不包含收入、支出金额或截图。发送前仍建议自行打开核对。`);
}

const safeFilename = (value) => String(value || '截图').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90);

async function exportOriginalImages() {
  const records = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay];
  if (!records.length) return showMessage('本月没有可导出的原图', '如果完成确认时选择了删除原始截图，本地只会保留分类与金额。');
  records.forEach((record, index) => {
    window.setTimeout(() => exportBlob(`${platformName(record.platform)}-${index + 1}-${safeFilename(record.name)}`, record.blob, record.type), index * 180);
  });
  await FinanceDB.addEvent('original_images_exported', { month: state.month, count: records.length });
  showMessage('原图下载已开始', `正在下载 ${records.length} 张原始截图；如果浏览器询问是否允许多个文件，请选择允许。`);
}

async function updateBackupStatus() {
  const setting = await FinanceDB.getSetting('lastBackupAt');
  const target = $('#backupStatus');
  if (!setting?.value) {
    target.textContent = '尚未导出备份';
    target.classList.add('backup-due');
    return;
  }
  const date = new Date(setting.value);
  target.textContent = `上次备份 ${date.toLocaleDateString('zh-CN')}`;
  target.classList.toggle('backup-due', Date.now() - date.getTime() > 35 * 24 * 60 * 60 * 1000);
}

async function updateStorageStatus() {
  const status = $('#storageStatus');
  if (!navigator.storage) {
    status.textContent = '当前浏览器不支持存储状态查询，请定期导出备份';
    status.className = 'storage-warning';
    return;
  }
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false
  ]);
  const used = formatFileSize(estimate.usage || 0);
  const quota = estimate.quota ? formatFileSize(estimate.quota) : '未知';
  status.textContent = `${persisted ? '已获得增强保护' : '普通浏览器存储'} · 已用 ${used} / 可用约 ${quota}`;
  status.className = persisted ? 'storage-ready' : 'storage-warning';
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return showMessage('当前浏览器不支持', '请定期导出完整本地备份，避免清理浏览器时丢失数据。');
  const granted = await navigator.storage.persist();
  await updateStorageStatus();
  showMessage(granted ? '本地存储保护已增强' : '浏览器没有授予增强保护', granted ? '浏览器会尽量避免自动清理本应用的数据，但你仍应定期导出备份。' : '数据仍会正常保存在本地；请避免清理网站数据，并定期导出备份。');
}

async function exportLocalBackup() {
  const button = $('#exportLocalData');
  button.disabled = true;
  button.textContent = '正在整理备份…';
  try {
    await persistReview();
    const backup = await FinanceDB.exportBackup();
    exportBlob(`家财月报-完整本地备份-${state.month}.json`, JSON.stringify(backup));
    await FinanceDB.setSetting('lastBackupAt', new Date().toISOString());
    await FinanceDB.addEvent('backup_exported', { month: state.month, reviewCount: backup.reviews.length, imageCount: backup.images.length });
    await updateBackupStatus();
    showMessage('备份已导出', '备份中包含收入、支出分类和原始截图，请妥善保管，不要发送给无关人员。');
  } catch (error) {
    showMessage('备份导出失败', error.message || '请稍后重试。');
  } finally {
    button.disabled = false;
    button.textContent = '导出完整 JSON 备份';
  }
}

async function restoreLocalBackup(file) {
  if (!file) return;
  if (!window.confirm('恢复备份会替换当前浏览器中的全部家财月报数据，确定继续吗？')) return;
  try {
    const backup = JSON.parse(await file.text());
    await FinanceDB.importBackup(backup);
    showMessage('备份恢复成功', '页面将重新加载并显示恢复后的月份数据。');
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    showMessage('无法恢复备份', error.message || '请确认选择的是家财月报导出的 JSON 文件。');
  }
}

async function clearLocalData() {
  if (!window.confirm('确定清除当前浏览器中的所有月度数据和原始截图吗？此操作无法撤销，建议先导出备份。')) return;
  await FinanceDB.clearAll();
  imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  imageObjectUrls.clear();
  window.location.reload();
}

$$('[data-nav]').forEach((element) => element.addEventListener('click', (event) => {
  event.preventDefault();
  const page = element.dataset.nav;
  if (page) showPage(page);
}));
$$('[data-start-review]').forEach((button) => button.addEventListener('click', () => {
  if (!state.reviewStartedAt) { state.reviewStartedAt = new Date().toISOString(); save(); }
  showPage('review');
  goStep(state.step || 1);
}));
$$('[data-next-step]').forEach((button) => button.addEventListener('click', () => goStep(button.dataset.nextStep)));
$$('[data-prev-step]').forEach((button) => button.addEventListener('click', () => goStep(button.dataset.prevStep)));
$$('[data-step-jump]').forEach((button) => button.addEventListener('click', () => goStep(button.dataset.stepJump)));
$$('[data-open-dialog]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.openDialog)));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
$$('[data-guide]').forEach((button) => button.addEventListener('click', () => showGuide(button.dataset.guide)));

$$('.income-input').forEach(bindIncomeInput);
$('#addIncomeCategory').addEventListener('click', addCustomIncomeRow);
$('#reviewMonth').addEventListener('change', (event) => switchMonth(event.target.value));
$('#reportMonth').addEventListener('change', async (event) => {
  await switchMonth(event.target.value, { openReview: false });
  showPage('report');
});
$('#wechatFiles').addEventListener('change', async (event) => { await handleImageFiles('wechat', event.target.files); event.target.value = ''; });
$('#alipayFiles').addEventListener('change', async (event) => { await handleImageFiles('alipay', event.target.files); event.target.value = ''; });
$('#recognizeButton').addEventListener('click', startRecognition);
$('#continueExtraButton').addEventListener('click', () => goStep(4));
$('#addManualEntry').addEventListener('click', addManualRecognitionEntry);
$('#manualEntrySource').addEventListener('blur', (event) => {
  if (event.target.value.trim()) renderCategoryPairControls('#manualEntryPrimary', '#manualEntrySecondary', suggestCategory(event.target.value.trim()));
});
$('#manualEntryPrimary').addEventListener('change', () => {
  const category = $('#manualEntryPrimary').value;
  renderCategoryPairControls('#manualEntryPrimary', '#manualEntrySecondary', { category, subcategory: secondaryOptionsFor(category)[0] });
});
$('#extraExpensePrimary').addEventListener('change', () => {
  const category = $('#extraExpensePrimary').value;
  renderCategoryPairControls('#extraExpensePrimary', '#extraExpenseSecondary', { category, subcategory: secondaryOptionsFor(category)[0] });
});
['wechat', 'alipay'].forEach((platform) => {
  $(`#${platform}DeclaredTotal`).addEventListener('change', (event) => {
    const source = state.sources.find((item) => item.id === platform);
    source.total = Number(event.target.value || 0);
    source.totalConfirmed = source.total > 0;
    source.totalSource = 'manual';
    state.completed = false;
    FinanceDB.addEvent('ocr_total_corrected', { month: state.month, platform }).catch(() => {});
    save();
    renderRecognition();
  });
});
$('#addExtraExpense').addEventListener('click', addExtraExpense);
$('#completeReviewButton').addEventListener('click', () => completeReview().catch((error) => showMessage('无法完成本月复盘', error.message)));
$('#extraExpenseList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-extra]');
  if (!button) return;
  state.extraExpenses.splice(Number(button.dataset.deleteExtra), 1);
  save();
  renderExtraExpenses();
  renderOverviewHistory();
});

$('#recognitionTables').addEventListener('change', (event) => {
  let entry;
  let field;
  if (event.target.matches('.primary-select')) {
    entry = state.sources[Number(event.target.dataset.sourceIndex)].entries[Number(event.target.dataset.entryIndex)];
    entry.category = event.target.value;
    entry.subcategory = secondaryOptionsFor(entry.category)[0] || '其他';
    field = 'category';
  }
  if (event.target.matches('.secondary-select')) {
    entry = state.sources[Number(event.target.dataset.sourceIndex)].entries[Number(event.target.dataset.entryIndex)];
    entry.subcategory = event.target.value;
    field = 'subcategory';
  }
  if (event.target.matches('[data-include-source]')) {
    entry = state.sources[Number(event.target.dataset.includeSource)].entries[Number(event.target.dataset.includeEntry)];
    entry.include = event.target.checked;
    field = 'include';
  }
  if (event.target.matches('.entry-amount-input')) {
    entry = state.sources[Number(event.target.dataset.sourceIndex)].entries[Number(event.target.dataset.entryIndex)];
    entry.amount = Number(event.target.value || 0);
    field = 'amount';
  }
  if (event.target.matches('.entry-note-input')) {
    entry = state.sources[Number(event.target.dataset.sourceIndex)].entries[Number(event.target.dataset.entryIndex)];
    entry.note = event.target.value.trim();
    field = 'note';
  }
  if (!entry) return;
  if (field !== 'note') {
    entry.confirmed = true;
    entry.corrected = true;
  }
  state.completed = false;
  const source = state.sources.find((item) => item.entries.includes(entry));
  if (entry.inputMethod === 'ocr' && ['category', 'subcategory', 'include'].includes(field)) {
    ocrCategoryMappings[`${source.id}|${entry.source}`] = { category: entry.category, subcategory: entry.subcategory, include: entry.include };
    FinanceDB.setSetting('ocrCategoryMappings', ocrCategoryMappings).catch(() => {});
  }
  FinanceDB.addEvent('ocr_entry_corrected', { month: state.month, platform: source?.id, field }).catch(() => {});
  save();
  renderOverviewHistory();
  renderRecognition();
});

$('#recognitionTables').addEventListener('click', (event) => {
  const entryConfirm = event.target.closest('[data-confirm-source]');
  if (entryConfirm) {
    const sourceIndex = Number(entryConfirm.dataset.confirmSource);
    const entry = state.sources[sourceIndex].entries[Number(entryConfirm.dataset.confirmEntry)];
    entry.confirmed = true;
    FinanceDB.addEvent('ocr_entry_confirmed', { month: state.month, platform: state.sources[sourceIndex].id }).catch(() => {});
    state.completed = false;
    save();
    renderRecognition();
    return;
  }
  const monthConfirm = event.target.closest('[data-confirm-source-month]');
  if (monthConfirm) {
    const source = state.sources[Number(monthConfirm.dataset.confirmSourceMonth)];
    source.monthConfirmed = true;
    FinanceDB.addEvent('ocr_month_confirmed', { month: state.month, platform: source.id }).catch(() => {});
    state.completed = false;
    save();
    renderRecognition();
    return;
  }
  const totalConfirm = event.target.closest('[data-confirm-source-total]');
  if (totalConfirm) {
    const source = state.sources[Number(totalConfirm.dataset.confirmSourceTotal)];
    source.totalConfirmed = Number(source.total || 0) > 0;
    FinanceDB.addEvent('ocr_total_confirmed', { month: state.month, platform: source.id }).catch(() => {});
    state.completed = false;
    save();
    renderRecognition();
    return;
  }
  const deleteButton = event.target.closest('[data-delete-source]');
  if (!deleteButton) return;
  state.sources[Number(deleteButton.dataset.deleteSource)].entries.splice(Number(deleteButton.dataset.deleteEntry), 1);
  state.completed = false;
  save();
  renderRecognition();
});

$('#mainReport').addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-category]');
  if (!button || button.disabled) return;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  $$(`.subcategory-row[data-category-group="${button.dataset.toggleCategory}"]`, $('#mainReport')).forEach((row) => { row.hidden = expanded; });
});

document.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-image]');
  if (deleteButton) {
    event.preventDefault();
    deleteStoredImage(deleteButton.dataset.imagePlatform, deleteButton.dataset.deleteImage).catch((error) => showMessage('无法删除截图', error.message));
    return;
  }
  const preview = event.target.closest('[data-preview-image]');
  if (preview) openStoredImage(preview.dataset.previewImage);
  const historyButton = event.target.closest('[data-open-review-month]');
  if (historyButton) switchMonth(historyButton.dataset.openReviewMonth);
});

$('#mobileMenu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#exportReport').addEventListener('click', () => {
  const report = reportData();
  const rows = Object.entries(report.byCategory).sort((a,b) => b[1] - a[1]).map(([name, amount]) => `<tr><td>${escapeHtml(name)}</td><td>${yuan(amount)}</td></tr>`).join('');
  exportBlob(`家财月报-${state.month}.html`, `<!doctype html><meta charset="utf-8"><title>家财月报 ${state.month}</title><style>body{font-family:sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111827}h1{color:#173f70}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.summary div,table{border:1px solid #d8dee8;padding:16px;border-radius:10px}strong{display:block;margin-top:8px;font-size:22px}table{width:100%;margin-top:20px;border-collapse:collapse}td{padding:10px;border-top:1px solid #d8dee8}</style><h1>家财月报 · ${monthLabel(state.month)}</h1><div class="summary"><div>收入<strong>${yuan(report.income)}</strong></div><div>支出<strong>${yuan(report.expense)}</strong></div><div>结余<strong>${yuan(report.surplus)}</strong></div></div><table><tbody>${rows}</tbody></table><p>数据口径：收入手动填写；支出为微信、支付宝确认分类和其他渠道补充。</p>`, 'text/html');
});
$('#exportLocalData').addEventListener('click', exportLocalBackup);
$('#exportCurrentMonthCsv').addEventListener('click', () => exportCurrentMonthCsv().catch((error) => showMessage('CSV 导出失败', error.message)));
$('#exportTrialEvents').addEventListener('click', () => exportTrialEventsCsv().catch((error) => showMessage('试用事件导出失败', error.message)));
$('#exportOriginalImages').addEventListener('click', () => exportOriginalImages().catch((error) => showMessage('原图导出失败', error.message)));
$('#restoreLocalData').addEventListener('click', () => $('#restoreLocalDataFile').click());
$('#restoreLocalDataFile').addEventListener('change', (event) => restoreLocalBackup(event.target.files[0]));
$('#clearLocalData').addEventListener('click', () => clearLocalData().catch((error) => showMessage('清除失败', error.message)));
$('#requestPersistentStorage').addEventListener('click', () => requestPersistentStorage().catch((error) => showMessage('申请失败', error.message)));
$('#deleteImagesToggle').addEventListener('change', (event) => FinanceDB.setSetting('deleteImagesAfterConfirm', event.target.checked));

$('#cloudFallbackToggle').addEventListener('change', (event) => {
  if (event.target.checked) {
    event.target.checked = false;
    showMessage('正式版再确认', '云端视觉模型会让截图离开设备。MVP默认关闭，只有本地识别失败且用户明确同意时才考虑启用。');
  }
});

function renderCategoryTreeEditor() {
  const summary = $('#categoryTreeSummary');
  if (summary) summary.innerHTML = categoryTree.map((group) => `<span>${escapeHtml(group.name)} <small>${group.children.length} 个二级</small></span>`).join('');
  const editor = $('#categoryTreeEditor');
  if (!editor) return;
  editor.innerHTML = categoryTree.map((group, groupIndex) => `<section class="category-tree-group"><div><b>${escapeHtml(group.name)}</b><button type="button" data-delete-primary="${groupIndex}" aria-label="删除一级分类${escapeHtml(group.name)}">删除一级</button></div><p>${group.children.map((child, childIndex) => `<span>${escapeHtml(child)}<button type="button" data-delete-secondary="${childIndex}" data-primary-index="${groupIndex}" aria-label="删除二级分类${escapeHtml(child)}">×</button></span>`).join('')}</p></section>`).join('');
}

async function persistCategoryTree() {
  categoryTree = normalizeCategoryTree(categoryTree);
  await Promise.all([
    FinanceDB.setSetting('expenseCategoryTree', safeClone(categoryTree)),
    FinanceDB.setSetting('expenseCategorySchemaVersion', CATEGORY_SCHEMA_VERSION)
  ]);
  FinanceDB.addEvent('category_tree_updated', { primaryCount: categoryTree.length, secondaryCount: sum(categoryTree.map((group) => group.children.length)) }).catch(() => {});
  renderCategoryTreeEditor();
  renderManualCategoryControls();
  renderRecognition();
}

$('#saveCustomCategory').addEventListener('click', () => {
  const primaryName = $('#customPrimaryName').value.trim().slice(0, 12);
  const secondaryName = ($('#customSecondaryName').value.trim() || '其他').slice(0, 16);
  if (!primaryName) return showMessage('请填写一级分类', '例如“吃”“宠物”或你自己的分类名称。');
  let group = categoryTree.find((item) => item.name === primaryName);
  if (!group) {
    group = { name: primaryName, children: [] };
    categoryTree.push(group);
  }
  if (!group.children.includes(secondaryName)) group.children.push(secondaryName);
  $('#customPrimaryName').value = '';
  $('#customSecondaryName').value = '';
  persistCategoryTree().catch((error) => showMessage('分类保存失败', error.message));
});

$('#restoreDefaultCategories').addEventListener('click', () => {
  if (!window.confirm('恢复系统预设分类会替换你当前的可选分类列表，但不会删除或改写已经保存的历史记录。确定继续吗？')) return;
  categoryTree = DEFAULT_CATEGORY_TREE.map((group) => ({ name: group.name, children: [...group.children] }));
  persistCategoryTree().then(() => showMessage('已恢复系统预设分类', '历史月份中已保存的分类与金额不会改变；后续录入将使用预设列表。')).catch((error) => showMessage('恢复失败', error.message));
});

$('#categoryTreeEditor').addEventListener('click', (event) => {
  const secondaryButton = event.target.closest('[data-delete-secondary]');
  if (secondaryButton) {
    const group = categoryTree[Number(secondaryButton.dataset.primaryIndex)];
    if (group.children.length === 1) return showMessage('至少保留一个二级分类', '可以先添加新的二级分类，再删除当前这一项。');
    group.children.splice(Number(secondaryButton.dataset.deleteSecondary), 1);
    persistCategoryTree().catch((error) => showMessage('分类保存失败', error.message));
    return;
  }
  const primaryButton = event.target.closest('[data-delete-primary]');
  if (!primaryButton) return;
  if (categoryTree.length === 1) return showMessage('至少保留一个一级分类', '分类体系不能为空。');
  categoryTree.splice(Number(primaryButton.dataset.deletePrimary), 1);
  persistCategoryTree().catch((error) => showMessage('分类保存失败', error.message));
});

async function initializeApplication() {
  await FinanceDB.open();
  const [categorySetting, mappingSetting, categorySchemaSetting] = await Promise.all([
    FinanceDB.getSetting('expenseCategoryTree'), FinanceDB.getSetting('ocrCategoryMappings'), FinanceDB.getSetting('expenseCategorySchemaVersion')
  ]);
  categoryTree = normalizeCategoryTree(categorySetting?.value);
  if (Number(categorySchemaSetting?.value || 0) < CATEGORY_SCHEMA_VERSION) {
    const foodGroup = categoryTree.find((group) => group.name === '吃');
    if (foodGroup && !foodGroup.children.includes('零食')) foodGroup.children.push('零食');
    await Promise.all([
      FinanceDB.setSetting('expenseCategoryTree', safeClone(categoryTree)),
      FinanceDB.setSetting('expenseCategorySchemaVersion', CATEGORY_SCHEMA_VERSION)
    ]);
  }
  ocrCategoryMappings = mappingSetting?.value && typeof mappingSetting.value === 'object' ? mappingSetting.value : {};
  const initialMonth = monthKeyNow();
  const existing = await FinanceDB.getReview(initialMonth);
  state = normalizeReview(existing, initialMonth);
  if (!existing) await persistReview();
  const deleteSetting = await FinanceDB.getSetting('deleteImagesAfterConfirm');
  $('#deleteImagesToggle').checked = Boolean(deleteSetting?.value);
  await loadImagesForMonth(state.month);
  clearCustomIncomeRows();
  restoreCustomIncomeRows();
  updateMonthUI();
  renderIncome();
  renderUpload('wechat');
  renderUpload('alipay');
  renderExtraExpenses();
  renderRecognition();
  renderCategoryTreeEditor();
  await refreshHistoryData();
  renderReports();
  goStep(state.step || 1);
  showPage('home');
  applicationReady = true;
  await updateStorageStatus().catch(() => { $('#storageStatus').textContent = '状态查询失败，请定期导出备份'; });
  await updateBackupStatus().catch(() => { $('#backupStatus').textContent = '备份状态查询失败'; });
}

initializeApplication().catch(handleFatalError);
window.addEventListener('resize', () => { if ($('#page-report').classList.contains('active')) drawSankey(reportData()); });
document.addEventListener('visibilitychange', () => {
  if (applicationReady && document.visibilityState === 'hidden') {
    window.clearTimeout(saveTimer);
    persistReview().catch(() => {});
  }
});
window.addEventListener('beforeunload', () => imageObjectUrls.forEach((url) => URL.revokeObjectURL(url)));

