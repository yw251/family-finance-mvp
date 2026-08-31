'use strict';

const APP_VERSION = '0.8.0-mobile';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_PLATFORM = 9;
const RECONCILIATION_TOLERANCE = 10;
const CATEGORY_SCHEMA_VERSION = 3;

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
  { name: '人情', children: [] },
  { name: '房租', children: [] },
  { name: '房贷', children: [] },
  { name: '父母', children: [] },
  { name: '其他', children: [] }
];
const LEGACY_PRIMARY_MAP = {
  餐饮: '吃', 居住缴费: '住', 交通出行: '行', 衣物与护理: '穿', 日用与数码: '用',
  休闲娱乐: '娱乐', 育儿与教育: '宝', 医疗健康: '健康', 宠物: '其他', 人情与代付: '人情'
};
const INCOME_DEFS = [
  { id: 'salary', name: '工资收入', note: '工资、奖金、补贴' },
  { id: 'side', name: '副业收入', note: '兼职、稿费、接单' },
  { id: 'investment', name: '投资理财收入', note: '利息、基金、股票' },
  { id: 'other', name: '其他收入', note: '不含转账、借款与退款' }
];
const CAT_ICON = { 吃: 'utensils', 穿: 'shopping-bag', 住: 'house', 行: 'bus', 用: 'shopping-bag', 美: 'heart-pulse', 宝: 'gift', 健康: 'heart-pulse', 成长: 'graduation-cap', 娱乐: 'pie', 人情: 'gift', 房租: 'house', 房贷: 'house', 父母: 'gift', 其他: 'tag' };
const PALETTE = ['#B91C1C', '#DC2626', '#EF4444', '#F97316', '#F59E0B', '#FBBF24', '#EAB308', '#9A3412'];
const MODE_KEY = 'ff_mode';

function makeDemoReview(month, income, categoryAmounts, incomeMix = {}) {
  const entries = categoryAmounts.map(([category, amount, subcategory = ''], index) => ({
    id: `demo-${month}-${index}`, source: `演示分类：${category}`, amount, category, subcategory,
    note: '演示数据', confidence: 1, needsConfirm: false, confirmed: true, include: true, inputMethod: 'demo'
  }));
  const wechatEntries = entries.filter((_, index) => index % 2 === 0);
  const alipayEntries = entries.filter((_, index) => index % 2 === 1);
  const createdAt = `${month}-01T00:00:00.000Z`;
  return {
    schemaVersion: 1, appVersion: APP_VERSION, month, step: 5, completed: true, recognized: true,
    income: { salary: incomeMix.salary ?? Math.round(income * .9), side: incomeMix.side ?? income - Math.round(income * .9), investment: incomeMix.investment ?? 0, other: incomeMix.other ?? 0 },
    customIncome: [], extraExpenses: [], uploads: { wechat: [], alipay: [] },
    sources: [
      { id: 'wechat', name: '微信', total: wechatEntries.reduce((total, entry) => total + entry.amount, 0), entries: wechatEntries, recognizedAt: createdAt, totalConfirmed: true, monthConfirmed: true, warnings: [] },
      { id: 'alipay', name: '支付宝', total: alipayEntries.reduce((total, entry) => total + entry.amount, 0), entries: alipayEntries, recognizedAt: createdAt, totalConfirmed: true, monthConfirmed: true, warnings: [] }
    ],
    createdAt, updatedAt: createdAt, completedAt: createdAt, demo: true
  };
}

const DEMO_REVIEWS = [
  makeDemoReview('2025-08', 14200, [['房租', 3000], ['住', 900, '其他'], ['吃', 3420, '外食'], ['用', 1560, '日用百货'], ['成长', 1180, '其他'], ['行', 540, '其他'], ['人情', 420]]),
  makeDemoReview('2026-03', 14500, [['房租', 3200], ['住', 820, '其他'], ['吃', 3320, '外食'], ['用', 2010, '日用百货'], ['成长', 1260, '其他'], ['人情', 940], ['行', 660, '其他'], ['健康', 666, '其他']]),
  makeDemoReview('2026-04', 15600, [['房租', 3200], ['住', 850, '其他'], ['吃', 3150, '外食'], ['用', 1720, '日用百货'], ['成长', 1280, '其他'], ['行', 720, '其他'], ['健康', 420, '其他'], ['人情', 668]]),
  makeDemoReview('2026-05', 14000, [['房租', 3200], ['住', 900, '其他'], ['吃', 3820, '外食'], ['人情', 3480], ['用', 2160, '日用百货'], ['行', 960, '其他'], ['健康', 583, '其他'], ['成长', 320, '其他']]),
  makeDemoReview('2026-06', 15200, [['房租', 3200], ['住', 900, '其他'], ['吃', 3105, '外食'], ['用', 1680, '日用百货'], ['成长', 1260, '其他'], ['行', 780, '其他'], ['人情', 600], ['健康', 365, '其他']]),
  makeDemoReview('2026-07', 14800, [['房租', 3200], ['住', 900, '其他'], ['吃', 3560, '外食'], ['用', 2320, '日用百货'], ['成长', 1260, '其他'], ['人情', 1050], ['行', 486, '其他'], ['健康', 280, '其他']]),
  makeDemoReview('2026-08', 15620, [['房租', 3200], ['住', 1000, '其他'], ['吃', 3280, '外食'], ['用', 1846, '日用百货'], ['成长', 1280, '其他'], ['人情', 800], ['行', 512.5, '其他'], ['健康', 356, '其他']], { salary: 15000, side: 620 })
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ic = (id) => `<svg class="icon"><use href="#${id}"/></svg>`;
const sum = (values) => values.reduce((total, value) => total + Number(value || 0), 0);
const fmt = (value) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const signed = (value) => `${Number(value || 0) >= 0 ? '+' : '-'}${fmt(Math.abs(Number(value || 0)))}`;
const money = (value) => `¥ ${fmt(value)}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const uniqueId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (month, spaced = false) => { const [y, m] = month.split('-'); return spaced ? `${y} 年 ${Number(m)} 月` : `${y}年${Number(m)}月`; };
const shortMonth = (month) => `${Number(month.split('-')[1])}月`;
const shiftMonth = (month, offset) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + offset, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const platformName = (platform) => platform === 'wechat' ? '微信' : '支付宝';
const safeClone = (value) => structuredClone(value);

const emptySources = () => [
  { id: 'wechat', name: '微信', total: 0, entries: [] },
  { id: 'alipay', name: '支付宝', total: 0, entries: [] }
];
const createEmptyState = (month = monthNow()) => ({
  schemaVersion: 1, appVersion: APP_VERSION, month, step: 1,
  income: { salary: 0, side: 0, investment: 0, other: 0 }, customIncome: [],
  extraExpenses: [], sources: emptySources(), uploads: { wechat: [], alipay: [] },
  recognized: false, completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
});

let APP_MODE = null;
try { APP_MODE = localStorage.getItem(MODE_KEY); } catch (_) {}
const requestedMode = new URLSearchParams(location.search).get('mode');
if (requestedMode === 'demo' || requestedMode === 'own') APP_MODE = requestedMode;
else if (APP_MODE !== 'demo' && APP_MODE !== 'own') APP_MODE = null;

let state = createEmptyState();
let homeMonth = monthNow();
let reportMonth = monthNow();
let allReviews = [];
let ownReviews = [];
let imagesByPlatform = { wechat: [], alipay: [] };
let categoryTree = DEFAULT_CATEGORY_TREE.map((group) => ({ name: group.name, children: [...group.children] }));
let categoryMappings = {};
let activePage = 'home';
let editingEntryId = null;
let ocrRunning = false;
let saveTimer;
let onboardingStep = 1;
let onboardingCanClose = false;
const imageObjectUrls = new Map();

function normalizeCategoryTree(value) {
  const source = Array.isArray(value) ? value : DEFAULT_CATEGORY_TREE;
  const groups = [];
  source.forEach((group) => {
    const name = String(group?.name || '').trim().slice(0, 12);
    if (!name || groups.some((item) => item.name === name)) return;
    const children = [...new Set((Array.isArray(group.children) ? group.children : []).map((item) => String(item || '').trim().slice(0, 16)).filter(Boolean))];
    groups.push({ name, children });
  });
  return groups.length ? groups : DEFAULT_CATEGORY_TREE.map((group) => ({ name: group.name, children: [...group.children] }));
}

function suggestCategory(sourceName) {
  const value = String(sourceName || '');
  const rules = [
    [/房租/, '房租', ''], [/房贷/, '房贷', ''], [/父母|爸|妈/, '父母', ''],
    [/咖啡|奶茶/, '吃', '咖啡奶茶'], [/外卖|简餐/, '吃', '外卖简餐'], [/生鲜|买菜|菜场/, '吃', '生鲜采购'], [/餐|美食|正餐|外食/, '吃', '外食'],
    [/饰品/, '穿', '饰品'], [/鞋/, '穿', '鞋'], [/衣|服饰|装扮/, '穿', '衣服'],
    [/水费|用水/, '住', '水'], [/电费|用电/, '住', '电'], [/网费|宽带/, '住', '网'], [/燃气|煤气/, '住', '燃气'], [/物业/, '住', '物业'],
    [/地铁|公交/, '行', '地铁公交'], [/打车|租车|网约车/, '行', '打车'], [/高铁|飞机|机票|火车/, '行', '高铁飞机'],
    [/数码|电器/, '用', '数码电器'], [/日用|百货|购物/, '用', '日用百货'], [/护肤|化妆|美容|美发/, '美', '其他'],
    [/母婴|亲子|育儿|宝宝|婴儿/, '宝', '其他'], [/运动|医疗|健康|看病|药|疫苗|保险/, '健康', '其他'],
    [/英语|读书|教育|培训|学习/, '成长', '其他'], [/旅行|旅游|影音|电影|娱乐|文化|休闲/, '娱乐', '其他'],
    [/转账|代付|人情|红包|礼物/, '人情', '']
  ];
  const matched = rules.find(([pattern]) => pattern.test(value));
  return matched ? { category: matched[1], subcategory: matched[2] } : { category: '其他', subcategory: '' };
}

function secondaryOptionsFor(category, current = '') {
  const group = categoryTree.find((item) => item.name === category);
  if (group && group.children.length === 0) return [];
  return [...new Set([...(group?.children || ['其他']), current].filter(Boolean))];
}

function normalizeClassification(record = {}) {
  const suggested = suggestCategory(record.source || record.note || '');
  let category = String(record.category || '').trim();
  let subcategory = String(record.subcategory || '').trim();
  if (!category) category = suggested.category;
  if (LEGACY_PRIMARY_MAP[category] && !record.subcategory) category = suggested.category !== '其他' ? suggested.category : LEGACY_PRIMARY_MAP[category];
  const group = categoryTree.find((item) => item.name === category);
  if (group && group.children.length === 0) subcategory = '';
  else if (!subcategory) subcategory = suggested.category === category ? suggested.subcategory : secondaryOptionsFor(category)[0] || '';
  return { ...record, id: record.id || uniqueId(), category, subcategory, amount: Number(record.amount || 0), include: record.include !== false, note: String(record.note || '') };
}

function normalizeReview(review, month) {
  const blank = createEmptyState(month);
  const normalized = { ...blank, ...(review || {}), month, appVersion: APP_VERSION };
  normalized.income = { ...blank.income, ...(review?.income || {}) };
  normalized.customIncome = Array.isArray(review?.customIncome) ? review.customIncome : [];
  normalized.extraExpenses = Array.isArray(review?.extraExpenses) ? review.extraExpenses.map(normalizeClassification) : [];
  normalized.sources = (Array.isArray(review?.sources) && review.sources.length === 2 ? review.sources : emptySources()).map((source) => ({
    ...source,
    entries: Array.isArray(source.entries) ? source.entries.map((entry) => normalizeClassification({ confirmed: entry.needsConfirm ? Boolean(entry.confirmed) : true, inputMethod: entry.inputMethod || 'manual', ...entry })) : [],
    totalConfirmed: source.totalConfirmed ?? Number(source.total || 0) > 0,
    monthConfirmed: source.monthConfirmed ?? true,
    warnings: Array.isArray(source.warnings) ? source.warnings : []
  }));
  normalized.uploads = { wechat: [], alipay: [], ...(review?.uploads || {}) };
  normalized.step = Math.min(5, Math.max(1, Number(normalized.step || 1)));
  return normalized;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
}

function showNotice(title, description) {
  $('#noticeTitle').textContent = title;
  $('#noticeDesc').textContent = description;
  $('#notice').classList.add('show');
}

function openSheet(id) { document.getElementById(id)?.classList.add('show'); }
function closeSheet(id) { document.getElementById(id)?.classList.remove('show'); }

async function persistReview() {
  state.updatedAt = new Date().toISOString();
  if (APP_MODE === 'demo') {
    const snapshot = normalizeReview(safeClone(state), state.month);
    const index = allReviews.findIndex((review) => review.month === state.month);
    if (index >= 0) allReviews[index] = snapshot;
    else allReviews.push(snapshot);
    allReviews.sort((a, b) => a.month.localeCompare(b.month));
    return;
  }
  await FinanceDB.putReview(safeClone(state));
  await refreshReviews();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistReview().catch((error) => showNotice('保存失败', error.message)), 120);
}

async function refreshReviews() {
  ownReviews = (await FinanceDB.listReviews()).map((review) => normalizeReview(review, review.month)).sort((a, b) => a.month.localeCompare(b.month));
  allReviews = APP_MODE === 'demo'
    ? DEMO_REVIEWS.map((review) => normalizeReview(safeClone(review), review.month)).sort((a, b) => a.month.localeCompare(b.month))
    : ownReviews;
}

function demoReviewFor(month) {
  const review = DEMO_REVIEWS.find((item) => item.month === month);
  return review ? normalizeReview(safeClone(review), month) : createEmptyState(month);
}

function hasOwnData() {
  return ownReviews.some((review) => {
    const report = reportDataFor(review);
    return review.completed || report.income > 0 || report.expense > 0;
  });
}

function updateModeUI() {
  const pill = $('#demoPill');
  if (!pill) return;
  pill.hidden = false;
  pill.classList.toggle('demo', APP_MODE === 'demo');
  pill.innerHTML = APP_MODE === 'demo'
    ? `${ic('i-scan')}演示模式 · 数据为示例`
    : `${ic('i-user')}我的账本 · ${hasOwnData() ? '本地数据' : '暂无数据'}`;
  $$('[data-quick-mode]').forEach((button) => {
    const active = button.dataset.quickMode === APP_MODE;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderAll() {
  renderIncome();
  renderShots();
  renderSupply();
  renderConfirm();
  renderSettings();
  renderHome();
  renderReport();
  showStep(state.step || 1, false);
}

async function loadModeState(mode) {
  APP_MODE = mode;
  await refreshReviews();
  if (mode === 'demo') {
    state = normalizeReview(safeClone(allReviews.find((review) => review.month === '2026-08') || demoReviewFor('2026-08')), '2026-08');
    homeMonth = state.month;
    reportMonth = state.month;
    imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    imageObjectUrls.clear();
    imagesByPlatform = { wechat: [], alipay: [] };
  } else {
    const month = monthNow();
    const existing = await FinanceDB.getReview(month);
    state = normalizeReview(existing, month);
    homeMonth = month;
    reportMonth = month;
    await loadImages(month);
  }
  updateModeUI();
  renderAll();
}

function obGo(step) {
  onboardingStep = Math.min(3, Math.max(1, Number(step || 1)));
  $$('.ob-slide').forEach((slide) => slide.classList.toggle('active', Number(slide.dataset.ob) === onboardingStep));
  $$('.ob-dots i').forEach((dot) => dot.classList.toggle('on', Number(dot.dataset.dot) === onboardingStep));
  $('#obNext').textContent = '下一步';
  $('#obNav').hidden = onboardingStep === 3;
}

function showOnboarding({ allowClose = false, step = 1 } = {}) {
  onboardingCanClose = allowClose;
  $('#obClose').hidden = !allowClose;
  $('#onboard').classList.add('show');
  $('#onboard').setAttribute('aria-hidden', 'false');
  document.body.classList.add('onboarding-open');
  obGo(step);
}

function hideOnboarding() {
  $('#onboard').classList.remove('show');
  $('#onboard').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('onboarding-open');
}

async function chooseMode(mode) {
  if (mode !== 'demo' && mode !== 'own') return;
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
  await loadModeState(mode);
  hideOnboarding();
  switchPage('home');
  toast(mode === 'demo' ? '已进入演示账本' : '已进入我的账本');
}

function imageUrl(record) {
  if (!imageObjectUrls.has(record.id)) imageObjectUrls.set(record.id, URL.createObjectURL(record.blob));
  return imageObjectUrls.get(record.id);
}

async function loadImages(month) {
  imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  imageObjectUrls.clear();
  const [wechat, alipay] = await Promise.all([FinanceDB.listImages(month, 'wechat'), FinanceDB.listImages(month, 'alipay')]);
  imagesByPlatform = { wechat, alipay };
}

function reportDataFor(review) {
  const income = sum([...Object.values(review.income || {}), ...(review.customIncome || []).map((item) => item.amount)]);
  const imported = (review.sources || []).flatMap((source) => (source.entries || []).filter((entry) => entry.include !== false));
  const extra = review.extraExpenses || [];
  const included = [...imported, ...extra];
  const expense = sum(included.map((entry) => entry.amount));
  const byCategory = included.reduce((result, entry) => { const key = entry.category || '其他'; result[key] = (result[key] || 0) + Number(entry.amount || 0); return result; }, {});
  const bySubcategory = included.reduce((result, entry) => {
    if (!entry.subcategory) return result;
    const primary = entry.category || '其他';
    result[primary] ||= {};
    result[primary][entry.subcategory] = (result[primary][entry.subcategory] || 0) + Number(entry.amount || 0);
    return result;
  }, {});
  return { income, expense, surplus: income - expense, byCategory, bySubcategory, importedExpense: sum(imported.map((entry) => entry.amount)), extraExpense: sum(extra.map((entry) => entry.amount)) };
}

function progressFor(review) {
  if (!review) return 0;
  if (review.completed) return 5;
  return Math.min(4, Math.max(1, Number(review.step || 1)));
}

function switchPage(page) {
  activePage = page;
  $$('.page').forEach((element) => element.classList.toggle('active', element.id === `page-${page}`));
  $$('.tabbar .tab').forEach((button) => {
    const on = button.dataset.page === page;
    button.classList.toggle('active', on && page !== 'review');
    button.classList.toggle('engaged', on && page === 'review');
    button.setAttribute('aria-selected', String(on));
  });
  $('#confirmBar').classList.toggle('show', page === 'review' && state.step === 3 && !$('#confirmZone').hidden);
  if (page === 'home') renderHome();
  if (page === 'report') renderReport();
  if (page === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function switchStateMonth(month, { page = activePage } = {}) {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  await persistReview();
  if (APP_MODE === 'demo') {
    state = normalizeReview(safeClone(allReviews.find((review) => review.month === month) || demoReviewFor(month)), month);
    imagesByPlatform = { wechat: [], alipay: [] };
  } else {
    const existing = await FinanceDB.getReview(month);
    state = normalizeReview(existing, month);
    if (!existing) await FinanceDB.putReview(safeClone(state));
    await loadImages(month);
  }
  homeMonth = month;
  reportMonth = month;
  renderIncome();
  renderShots();
  renderSupply();
  renderConfirm();
  renderHome();
  renderReport();
  showStep(state.step || 1, false);
  switchPage(page);
}

function renderHome() {
  const review = allReviews.find((item) => item.month === homeMonth);
  const report = review ? reportDataFor(review) : null;
  $('#homeMonthBtn').innerHTML = `${monthLabel(homeMonth)}<span class="month-tag">约 5-10 分钟完成</span>`;
  $('#homeTrialTxt').textContent = `${monthLabel(homeMonth, true)} · ${review?.completed ? '已完成' : review ? '进行中' : '待开始'}`;
  const body = $('#homeBody');
  if (!review || (!review.completed && progressFor(review) <= 1 && report.income === 0 && report.expense === 0)) {
    body.innerHTML = `<div class="empty"><div class="empty-ico">${ic('i-receipt')}</div><h3>${monthLabel(homeMonth)}还没有数据</h3><p>每月一次，约 5-10 分钟完成收支复盘，几分钟生成统一月报</p><button class="btn btn-primary" id="emptyCta">开始本月复盘</button></div>`;
    $('#emptyCta').addEventListener('click', () => openReview(homeMonth));
    return;
  }
  const progress = progressFor(review);
  const pct = Math.round(progress / 5 * 100);
  const stepNames = ['创建复盘', '填写月度收入', '上传支出截图', '确认并补充支出', '完成本月复盘'];
  const progressItems = stepNames.map((name, index) => {
    const done = index < progress;
    const current = index === progress && progress < 5;
    return `<div class="prog-item ${done ? 'done' : current ? 'cur' : 'todo'}"><span class="st">${done ? ic('i-check') : index + 1}</span><span class="tx">${name}</span>${current ? '<span class="fl">进行中</span>' : ''}</div>`;
  }).join('');
  const relevant = allReviews.filter((item) => item.month <= homeMonth).slice(-4);
  const trendValues = relevant.map((item) => ({ review: item, report: reportDataFor(item) }));
  const maxValue = Math.max(...trendValues.flatMap((item) => [item.report.income, item.report.expense]), 1);
  const trendColumns = trendValues.map(({ review: item, report: data }) => `<div class="trend-col"><div class="trend-bars"><div class="b in" style="height:${Math.max(data.income ? 3 : 0, Math.round(data.income / maxValue * 80))}px"></div><div class="b out" style="height:${Math.max(data.expense ? 3 : 0, Math.round(data.expense / maxValue * 80))}px"></div></div><div class="trend-m">${shortMonth(item.month)}</div></div>`).join('');
  const cumulative = sum(trendValues.map((item) => item.report.surplus));
  const averageRate = trendValues.length ? sum(trendValues.map((item) => item.report.income ? item.report.surplus / item.report.income * 100 : 0)) / trendValues.length : 0;
  const highest = trendValues.reduce((best, item) => !best || item.report.expense > best.report.expense ? item : best, null);
  const historyRows = [...allReviews].reverse().slice(0, 12).map((item) => { const data = reportDataFor(item); return `<button class="hist-row" data-history-month="${item.month}"><span class="hist-m tnum">${shortMonth(item.month)}</span><span class="hist-mid tnum">收 ${fmt(data.income)}<br>支 ${fmt(data.expense)}</span><span class="hist-bal tnum ${data.surplus < 0 ? 'money-out' : ''}">${signed(data.surplus)}</span><span class="chev">${ic('i-chevron-right')}</span></button>`; }).join('');
  body.innerHTML = `<div class="card prog-card"><div class="prog-head"><span class="prog-title">${ic('i-scan')}本月复盘进度</span><span class="prog-pct tnum">${pct}%</span></div><div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>${progressItems}<div class="btn-row" style="margin-top:14px"><button class="btn btn-primary" id="homeCta">${review.completed ? '查看本月报告' : '继续本月复盘'}</button></div></div>
    <div class="card balance" style="margin-bottom:14px"><div class="lb">${ic('i-wallet')}本月结余</div><div class="amt tnum-lg">¥ ${fmt(report.surplus)}</div><div class="split"><div class="col"><div class="k">收入</div><div class="v money-in tnum">${fmt(report.income)}</div></div><div class="col"><div class="k">支出</div><div class="v money-out tnum">${fmt(report.expense)}</div></div></div></div>
    <div class="sec-title">${ic('i-trending-up')}近 4 个月收支趋势</div><div class="card trend" style="margin-bottom:14px"><div class="trend-legend"><span class="lg"><i style="background:var(--income)"></i>收入</span><span class="lg"><i style="background:var(--expense)"></i>支出</span></div><div class="trend-chart">${trendColumns || '<p class="muted">暂无历史月份</p>'}</div><div class="trend-meta"><div class="tm"><div class="k">累计结余</div><div class="v tnum">${signed(cumulative)}</div></div><div class="tm"><div class="k">平均结余率</div><div class="v tnum">${averageRate.toFixed(1)}%</div></div><div class="tm"><div class="k">支出最高月份</div><div class="v tnum">${highest ? shortMonth(highest.review.month) : '—'}</div></div><div class="tm"><div class="k">数据范围</div><div class="v tnum">近 ${trendValues.length} 个月</div></div></div></div>
    <div class="sec-title">${ic('i-calendar')}月度复盘档案（点击月份查看报告）</div><div class="card hist-card">${historyRows}</div>`;
  $('#homeCta').addEventListener('click', () => review.completed ? openReport(homeMonth) : openReview(homeMonth));
  $$('[data-history-month]', body).forEach((button) => button.addEventListener('click', () => openReport(button.dataset.historyMonth)));
}

async function openReview(month = homeMonth, { startAtBeginning = true } = {}) {
  if (state.month !== month) await switchStateMonth(month, { page: 'review' });
  homeMonth = month;
  state.reviewStartedAt ||= new Date().toISOString();
  scheduleSave();
  renderIncome();
  renderShots();
  renderSupply();
  renderConfirm();
  const openingStep = state.completed && startAtBeginning ? 1 : (state.step || 1);
  showStep(openingStep, false);
  switchPage('review');
}

function showStep(step, persist = true) {
  const next = Math.min(5, Math.max(1, Number(step || 1)));
  state.step = next;
  $$('.step-pane').forEach((pane) => pane.classList.toggle('show', pane.id === `step${next}`));
  $$('.s-item').forEach((item) => { const index = Number(item.dataset.si); item.classList.toggle('done', index < next); item.classList.toggle('cur', index === next); });
  $('#trackFill').style.width = `${(next - 1) / 4 * 100}%`;
  $('#confirmBar').classList.toggle('show', activePage === 'review' && next === 3 && !$('#confirmZone').hidden);
  if (persist) scheduleSave();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function incomeTotal() { return sum([...Object.values(state.income || {}), ...(state.customIncome || []).map((item) => item.amount)]); }

function renderIncome() {
  $('#incList').innerHTML = INCOME_DEFS.map((item) => `<div class="inc-item"><div class="nm"><b>${item.name}</b><em>${item.note}</em></div><div class="amt-in"><span class="cur">¥</span><input class="inc-input" data-income="${item.id}" type="text" inputmode="decimal" value="${Number(state.income[item.id] || 0) || ''}" aria-label="${item.name}金额"></div></div>`).join('') +
    state.customIncome.map((item, index) => `<div class="inc-item"><div class="nm"><b>${escapeHtml(item.name)}</b><em>自定义收入</em></div><div class="amt-in"><span class="cur">¥</span><input class="inc-input" data-custom-income="${index}" type="text" inputmode="decimal" value="${Number(item.amount || 0) || ''}"></div><button class="pencil inc-del" data-delete-income="${index}" aria-label="删除${escapeHtml(item.name)}">${ic('i-x')}</button></div>`).join('');
  $('#incTotal').textContent = money(incomeTotal());
}

function renderShots() {
  ['wechat', 'alipay'].forEach((platform) => {
    const records = imagesByPlatform[platform] || [];
    const grid = $(`.thumb-grid[data-plat="${platform}"]`);
    grid.innerHTML = records.map((record) => `<div class="thumb"><img src="${imageUrl(record)}" alt="${platformName(platform)}截图缩略图" data-preview-image="${record.id}"><button class="thumb-del" data-delete-image="${record.id}" data-image-platform="${platform}" aria-label="删除${escapeHtml(record.name)}">${ic('i-trash-2')}</button></div>`).join('');
    grid.closest('.plat').querySelector('.cnt').textContent = records.length;
    state.uploads[platform] = records.map(({ id, name, type, size, width, height, hash, createdAt }) => ({ id, name, type, size, width, height, hash, createdAt }));
  });
  const uploaded = imagesByPlatform.wechat.length + imagesByPlatform.alipay.length;
  const demoMode = APP_MODE === 'demo';
  $('#step2 .step-hint').innerHTML = demoMode
    ? '演示账本已内置微信、支付宝示例识别结果，<b>无需上传截图</b>，可直接进入下一步体验确认流程。'
    : '上传微信、支付宝的<b>月度汇总账单截图</b>，截图仅在本地识别。';
  $$('.upload-add').forEach((button) => {
    button.disabled = demoMode;
    button.setAttribute('aria-disabled', String(demoMode));
    const platform = button.dataset.plat;
    button.querySelector('b').textContent = demoMode ? `${platformName(platform)}演示结果已载入` : `添加${platformName(platform)}截图`;
    button.querySelector('small').textContent = demoMode ? '演示模式无需上传真实图片' : '点击后选择拍照或手机相册';
  });
  $('#toStep3').disabled = !demoMode && uploaded === 0;
  $('#toStep3').textContent = demoMode ? '查看演示识别结果' : '开始识别';
}

async function imageDimensions(file) {
  if (typeof createImageBitmap === 'function') {
    try { const bitmap = await createImageBitmap(file); const dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return dimensions; } catch (_) {}
  }
  return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('浏览器无法读取这张图片')); }; image.src = url; });
}

async function fileHash(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (globalThis.crypto?.subtle) { const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
  let hash = 2166136261; bytes.forEach((byte) => { hash = Math.imul(hash ^ byte, 16777619); }); return `local-${(hash >>> 0).toString(16)}-${file.size}`;
}

const supportedImage = (file) => /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');

async function handleFiles(platform, fileList) {
  if (APP_MODE === 'demo') return showNotice('演示账本已内置识别结果', '无需上传真实截图，可直接点击“查看演示识别结果”继续体验。');
  const files = [...fileList];
  if (!files.length) return;
  const existing = imagesByPlatform[platform] || [];
  if (existing.length + files.length > MAX_IMAGES_PER_PLATFORM) return showNotice('截图数量过多', `每个平台每月最多保存 ${MAX_IMAGES_PER_PLATFORM} 张。`);
  const invalid = files.find((file) => !supportedImage(file) || file.size > MAX_IMAGE_BYTES);
  if (invalid) return showNotice('有图片无法导入', '支持 JPG、PNG、WebP、HEIC，且单张不超过 15 MB。');
  const records = [];
  for (const file of files) {
    const [dimensions, hash] = await Promise.all([imageDimensions(file), fileHash(file)]);
    if ([...existing, ...records].some((record) => record.hash === hash)) continue;
    records.push({ id: uniqueId(), month: state.month, platform, name: file.name, type: file.type, size: file.size, width: dimensions.width, height: dimensions.height, hash, createdAt: new Date().toISOString(), blob: file });
  }
  if (!records.length) return toast('这些截图已经添加过了');
  await FinanceDB.putImages(records);
  imagesByPlatform[platform] = [...existing, ...records];
  const source = state.sources.find((item) => item.id === platform);
  source.needsRecognition = true;
  state.completed = false;
  renderShots();
  await persistReview();
  FinanceDB.addEvent('images_added', { month: state.month, platform, count: records.length }).catch(() => {});
  toast(`已添加 ${records.length} 张${platformName(platform)}截图`);
}

async function deleteImage(platform, id) {
  await FinanceDB.deleteImage(id);
  URL.revokeObjectURL(imageObjectUrls.get(id));
  imageObjectUrls.delete(id);
  imagesByPlatform[platform] = imagesByPlatform[platform].filter((record) => record.id !== id);
  const source = state.sources.find((item) => item.id === platform);
  if (imagesByPlatform[platform].length) source.needsRecognition = true;
  else { source.entries = source.entries.filter((entry) => entry.inputMethod === 'manual'); source.total = 0; source.recognizedAt = null; source.needsRecognition = false; }
  renderShots();
  await persistReview();
}

function sourceIsActive(source) {
  return Boolean(imagesByPlatform[source.id]?.length || source.entries?.length || source.recognizedAt || Number(source.total || 0));
}

function updateOcrProgress({ platform, fileIndex = 0, fileCount = 1, progress = 0, label = '准备本地识别', platformIndex = 0, platformCount = 1 }) {
  const platformProgress = (fileIndex + progress) / Math.max(fileCount, 1);
  const overall = Math.min(1, (platformIndex + platformProgress) / Math.max(platformCount, 1));
  const percent = Math.round(overall * 100);
  $('#ocrFill').style.width = `${Math.max(2, percent)}%`;
  $('#ocrPct').textContent = `${percent}%`;
  $('#ocrTip').textContent = `${platformName(platform)} · ${label} · 第 ${Math.min(fileIndex + 1, fileCount)} / ${fileCount} 个本地图像处理任务`;
}

async function enterStep3() {
  if (APP_MODE === 'demo') {
    showStep(3);
    renderShotStrip();
    $('#ocrZone').hidden = true;
    $('#confirmZone').hidden = false;
    renderConfirm();
    $('#confirmBar').classList.add('show');
    return;
  }
  const uploaded = ['wechat', 'alipay'].filter((platform) => imagesByPlatform[platform].length > 0);
  if (!uploaded.length) return showNotice('请先上传截图', '微信或支付宝至少上传一张月度汇总截图。');
  showStep(3);
  renderShotStrip();
  const needsOcr = uploaded.filter((platform) => {
    const source = state.sources.find((item) => item.id === platform);
    return source.needsRecognition === true || !source.recognizedAt || source.parserVersion !== FinanceOCR.version;
  });
  if (!needsOcr.length) {
    $('#ocrZone').hidden = true;
    $('#confirmZone').hidden = false;
    renderConfirm();
    $('#confirmBar').classList.add('show');
    return;
  }
  await startRecognition(needsOcr);
}

async function startRecognition(platforms) {
  if (ocrRunning) return;
  ocrRunning = true;
  $('#ocrZone').hidden = false;
  $('#confirmZone').hidden = true;
  $('#confirmBar').classList.remove('show');
  $('#ocrFill').style.width = '2%';
  $('#ocrPct').textContent = '0%';
  $('#ocrList').innerHTML = platforms.map((platform) => `<div class="card ocr-item" data-ocr-platform="${platform}"><span class="ocr-thumb">${ic('i-receipt')}</span><span class="ocr-info"><span class="ocr-name">${platformName(platform)}月度汇总</span><span class="ocr-status">等待识别</span></span><span class="ocr-state"><span class="spinner"></span></span></div>`).join('');
  const failures = [];
  try {
    for (let platformIndex = 0; platformIndex < platforms.length; platformIndex += 1) {
      const platform = platforms[platformIndex];
      const currentSource = state.sources.find((item) => item.id === platform);
      const manualEntries = currentSource.entries.filter((entry) => entry.inputMethod === 'manual');
      const previousEntries = new Map(currentSource.entries.map((entry) => [`${entry.source}|${Number(entry.amount).toFixed(2)}`, entry]));
      const row = $(`[data-ocr-platform="${platform}"]`);
      row.querySelector('.ocr-status').textContent = '本地识别中…';
      try {
        const recognized = await FinanceOCR.recognizePlatform(platform, imagesByPlatform[platform], state.month, (progress) => updateOcrProgress({ ...progress, platformIndex, platformCount: platforms.length }));
        const manualKeys = new Set(manualEntries.map((entry) => `${entry.source}|${Number(entry.amount).toFixed(2)}`));
        recognized.entries = recognized.entries.filter((entry) => !manualKeys.has(`${entry.source}|${Number(entry.amount).toFixed(2)}`)).map((entry) => {
          const key = `${entry.source}|${Number(entry.amount).toFixed(2)}`;
          const previous = previousEntries.get(key);
          const remembered = categoryMappings[`${platform}|${entry.source}`];
          return normalizeClassification({
            ...entry, id: previous?.id || uniqueId(), category: previous?.category || remembered?.category || entry.category,
            subcategory: previous?.subcategory || remembered?.subcategory || entry.subcategory,
            include: previous?.include ?? remembered?.include ?? entry.include,
            confirmed: previous ? Boolean(previous.confirmed) : remembered ? true : entry.confirmed,
            note: previous?.note || ''
          });
        });
        recognized.entries.push(...manualEntries);
        recognized.needsRecognition = false;
        state.sources[state.sources.findIndex((source) => source.id === platform)] = recognized;
        row.querySelector('.ocr-status').textContent = `识别完成 · ${recognized.entries.length} 个分类`;
        row.querySelector('.ocr-state').innerHTML = `<span class="ocr-check">${ic('i-check-circle')}</span>`;
        FinanceDB.addEvent('ocr_platform_completed', { month: state.month, platform, durationMs: recognized.durationMs, imageCount: recognized.ocrFileCount, segmentCount: recognized.ocrSegmentCount, entryCount: recognized.entries.length, parserVersion: recognized.parserVersion }).catch(() => {});
      } catch (error) {
        failures.push(platformName(platform));
        currentSource.warnings = [`自动识别失败：${error.message || '未知错误'}`];
        currentSource.monthConfirmed = true;
        currentSource.needsRecognition = true;
        row.querySelector('.ocr-status').textContent = '自动识别失败，可人工补充';
        row.querySelector('.ocr-state').innerHTML = `<span class="money-out">${ic('i-alert-triangle')}</span>`;
        FinanceDB.addEvent('ocr_platform_failed', { month: state.month, platform, reason: error.name || 'unknown_error' }).catch(() => {});
      }
    }
    state.recognized = state.sources.some((source) => Boolean(source.recognizedAt));
    state.completed = false;
    await persistReview();
    updateOcrProgress({ platform: platforms.at(-1), fileIndex: 1, fileCount: 1, progress: 1, label: '识别完成', platformIndex: platforms.length - 1, platformCount: platforms.length });
    if (failures.length) showNotice('部分截图未能自动识别', `${failures.join('、')}可在确认页使用“补漏项”手动录入分类汇总。`);
    setTimeout(() => {
      $('#ocrZone').hidden = true;
      $('#confirmZone').hidden = false;
      renderConfirm();
      $('#confirmBar').classList.add('show');
    }, 350);
  } finally {
    ocrRunning = false;
  }
}

function renderShotStrip() {
  const records = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay];
  $('#shotStrip').innerHTML = records.map((record) => `<button class="shot-mini" data-preview-image="${record.id}"><img src="${imageUrl(record)}" alt="${platformName(record.platform)}截图"><span>${platformName(record.platform)}</span></button>`).join('') || (APP_MODE === 'demo' ? '<p class="muted">演示账本已直接载入微信、支付宝分类识别结果</p>' : '<p class="muted">本月没有保存的截图</p>');
}

function reconciliationFor(source) {
  if (!sourceIsActive(source)) return { active: false, calculated: 0, difference: 0, pending: 0, ok: true };
  const calculated = sum(source.entries.map((entry) => entry.amount));
  const difference = Number(source.total || 0) - calculated;
  const pending = source.entries.filter((entry) => entry.needsConfirm && !entry.confirmed).length + Number(source.monthConfirmed === false) + Number(source.totalConfirmed === false);
  const amountOk = Number(source.total || 0) > 0 && Math.abs(difference) < RECONCILIATION_TOLERANCE;
  return { active: true, calculated, difference, pending, amountOk, ok: amountOk && pending === 0 };
}

function categoryChip(entry) {
  const iconName = CAT_ICON[entry.category] || 'tag';
  const label = entry.subcategory ? `${entry.category}/${entry.subcategory}` : entry.category;
  return `<span class="chip">${ic(`i-${iconName}`)}${escapeHtml(label || '待分类')}</span>`;
}

function entryCard(source, sourceIndex, entry, entryIndex) {
  const editing = editingEntryId === entry.id;
  const needsConfirm = entry.needsConfirm && !entry.confirmed;
  const primaryOptions = [...new Set([...categoryTree.map((group) => group.name), entry.category].filter(Boolean))].map((name) => `<option value="${escapeHtml(name)}" ${name === entry.category ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
  const secondaries = secondaryOptionsFor(entry.category, entry.subcategory);
  const secondaryOptions = secondaries.length ? secondaries.map((name) => `<option value="${escapeHtml(name)}" ${name === entry.subcategory ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('') : '<option value="">无二级分类</option>';
  const edit = editing ? `<div class="it-edit" data-source-index="${sourceIndex}" data-entry-index="${entryIndex}"><div class="edit-lb">一级分类</div><div class="sel-wrap"><select class="mobile-primary">${primaryOptions}</select>${ic('i-chevron-down')}</div><div class="edit-lb" style="margin-top:10px">二级分类</div><div class="sel-wrap"><select class="mobile-secondary" ${secondaries.length ? '' : 'disabled'}>${secondaryOptions}</select>${ic('i-chevron-down')}</div><div class="edit-lb" style="margin-top:10px">金额（元）</div><div class="edit-amt"><span class="cur">¥</span><input class="edit-val" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(entry.amount || 0)}"></div><label class="mobile-include"><input type="checkbox" ${entry.include !== false ? 'checked' : ''}> 计入月报</label><div class="edit-actions"><button class="btn btn-ghost edit-cancel">取消</button><button class="btn btn-primary edit-save" style="height:40px;font-size:14px;padding:0 18px">保存</button></div></div>` : '';
  const inputLabel = entry.inputMethod === 'demo' ? '演示数据' : entry.inputMethod === 'ocr' ? '截图识别' : '手动补充';
  return `<div class="it-card ${needsConfirm ? 'is-unknown' : ''}" data-entry-id="${entry.id}"><div class="it-top"><button class="chk ${needsConfirm ? '' : 'on'}" data-confirm-source="${sourceIndex}" data-confirm-entry="${entryIndex}" aria-label="${needsConfirm ? '确认' : '已确认'}${escapeHtml(entry.source)}">${needsConfirm ? '' : ic('i-check')}</button>${categoryChip(entry)}<span class="it-name">${escapeHtml(entry.parentSource ? `${entry.parentSource} / ${entry.source}` : entry.source || '平台分类')}</span><span class="it-amt money-out tnum">-${fmt(entry.amount)}</span></div><div class="it-sub"><span class="it-plat">${source.name} · ${inputLabel}</span>${needsConfirm ? `<span class="it-note warn">${ic('i-alert-triangle')}请确认分类与金额</span>` : ''}<button class="pencil" data-edit-entry="${entry.id}" aria-label="编辑${escapeHtml(entry.source)}">${ic('i-pencil')}</button><button class="pencil" data-delete-entry="${entryIndex}" data-source-index="${sourceIndex}" aria-label="删除${escapeHtml(entry.source)}">${ic('i-trash-2')}</button></div>${edit}</div>`;
}

function sourceGroup(source, sourceIndex) {
  if (!sourceIsActive(source)) return '';
  const check = reconciliationFor(source);
  const badgeClass = !check.amountOk ? 'mismatch' : check.pending ? 'pending' : '';
  const badgeText = !Number(source.total || 0) ? '待填写截图总额' : !check.amountOk ? `相差 ${money(Math.abs(check.difference))}` : check.pending ? `${check.pending} 项待确认` : '金额已核对';
  const warnings = (source.warnings || []).map((warning) => `<div class="source-check warning">${ic('i-alert-triangle')}<span><b>识别提示</b><small>${escapeHtml(warning)}</small></span></div>`).join('');
  const sourceChecks = `${source.monthConfirmed === false ? `<div class="source-check warning"><span><b>账单月份需要确认</b><small>${source.detectedMonth ? `识别为 ${source.detectedMonth}，当前复盘月份为 ${state.month}` : '截图中没有可靠识别到月份'}</small></span><button class="confirm-action" data-confirm-month="${sourceIndex}">确认属于本月</button></div>` : ''}${source.totalConfirmed === false ? `<div class="source-check warning"><span><b>平台总支出需要确认</b><small>本地识别为 ${money(source.total)}</small></span><button class="confirm-action" data-confirm-total="${sourceIndex}">确认总额</button></div>` : ''}${warnings}`;
  return `<div class="grp"><div class="grp-head"><span class="grp-tag">${ic('i-receipt')}${source.name}支出</span><span class="grp-cnt">${source.entries.length} 个分类</span></div><div class="card mobile-platform-total"><div><span>${source.name}截图总支出</span><label class="amt-in"><span class="cur">¥</span><input type="number" inputmode="decimal" min="0" step="0.01" data-source-total="${sourceIndex}" value="${Number(source.total || 0) || ''}" placeholder="0.00"></label></div><div class="mobile-reconcile"><span>分类合计 <b>${money(check.calculated)}</b></span><span class="reconcile-badge ${badgeClass}">${badgeText}</span></div><button class="btn btn-secondary btn-sm" data-missing-platform="${source.id}">${ic('i-plus')}补充${source.name}截图漏项</button>${sourceChecks}</div>${source.entries.map((entry, entryIndex) => entryCard(source, sourceIndex, entry, entryIndex)).join('') || '<div class="card recognition-empty">没有识别到分类，请使用上方按钮补充截图漏项。</div>'}</div>`;
}

function renderConfirm() {
  const activeSources = state.sources.filter(sourceIsActive);
  $('#confirmList').innerHTML = state.sources.map(sourceGroup).join('');
  const total = activeSources.reduce((count, source) => count + source.entries.length, 0);
  const pending = activeSources.reduce((count, source) => count + reconciliationFor(source).pending, 0);
  const confirmed = Math.max(0, total - activeSources.reduce((count, source) => count + source.entries.filter((entry) => entry.needsConfirm && !entry.confirmed).length, 0));
  $('#sumTotal').textContent = total;
  $('#sumTodo').textContent = pending;
  $('#confirmCount').textContent = `已确认 ${confirmed} 项`;
  $('#confirmGo').textContent = pending ? `还有 ${pending} 项待确认` : '确认并继续';
  const allOkay = activeSources.length > 0 && activeSources.every((source) => reconciliationFor(source).ok);
  $('#confirmGo').disabled = !allOkay;
  $('#toStep4').disabled = !allOkay;
  const shotTotal = sum(activeSources.map((source) => source.total));
  const ocrTotal = sum(activeSources.flatMap((source) => source.entries).map((entry) => entry.amount));
  const difference = shotTotal - ocrTotal;
  $('#vShot').textContent = money(shotTotal);
  $('#vOcr').textContent = money(ocrTotal);
  $('#vDiff').textContent = `差 ${money(Math.abs(difference))}`;
  $('#vDiff').classList.toggle('ok', Math.abs(difference) < RECONCILIATION_TOLERANCE);
  $('.verify-state').innerHTML = allOkay ? `${ic('i-check')}通过` : `${ic('i-alert-triangle')}待核对`;
  $('.verify-state').classList.toggle('pending', !allOkay);
}

function fillCategorySelect(primaryId, secondaryId, preferred = {}) {
  const primary = document.getElementById(primaryId);
  const secondary = document.getElementById(secondaryId);
  const selectedPrimary = preferred.category || primary.value || categoryTree[0]?.name || '其他';
  primary.innerHTML = categoryTree.map((group) => `<option value="${escapeHtml(group.name)}" ${group.name === selectedPrimary ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
  const options = secondaryOptionsFor(selectedPrimary, preferred.subcategory || secondary.value);
  if (!options.length) { secondary.innerHTML = '<option value="">无二级分类</option>'; secondary.disabled = true; return; }
  secondary.disabled = false;
  const selectedSecondary = preferred.subcategory || secondary.value || options[0];
  secondary.innerHTML = options.map((name) => `<option value="${escapeHtml(name)}" ${name === selectedSecondary ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

function renderSupply() {
  const list = $('#supplyList');
  list.innerHTML = state.extraExpenses.length ? state.extraExpenses.map((entry, index) => `<div class="supply-row"><span class="sn">${escapeHtml(entry.category)}${entry.subcategory ? ` / ${escapeHtml(entry.subcategory)}` : ''}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}<em>${escapeHtml(entry.source || '其他渠道')}</em></span><span class="sa tnum">-${fmt(entry.amount)}</span><button class="pencil" data-delete-supply="${index}" aria-label="删除补充支出">${ic('i-trash-2')}</button></div>`).join('') : '<p class="supply-empty">还没有补充记录</p>';
  $('#supplyTotal').textContent = money(sum(state.extraExpenses.map((entry) => entry.amount)));
  fillCategorySelect('supL1', 'supL2');
  fillCategorySelect('msL1', 'msL2');
}

function addSupply() {
  const amount = Number($('#supAmt').value || 0);
  if (amount <= 0) return toast('请填写有效金额');
  state.extraExpenses.push(normalizeClassification({ source: $('#supChannel').value, category: $('#supL1').value, subcategory: $('#supL2').value, amount, note: $('#supNote').value.trim(), inputMethod: 'manual', include: true, confirmed: true }));
  $('#supAmt').value = '';
  $('#supNote').value = '';
  state.completed = false;
  renderSupply();
  scheduleSave();
  toast('补充支出已保存');
}

function addMissingEntry() {
  const amount = Number($('#msAmt').value || 0);
  if (amount <= 0) return toast('请填写有效金额');
  const platform = $('#msPlat').value.includes('微信') ? 'wechat' : 'alipay';
  const source = state.sources.find((item) => item.id === platform);
  source.entries.push(normalizeClassification({ id: uniqueId(), source: $('#msRaw').value.trim() || '手动补充分类', category: $('#msL1').value, subcategory: $('#msL2').value, amount, note: $('#msDate').value.trim(), inputMethod: 'manual', needsConfirm: false, confirmed: true, include: true }));
  $('#msAmt').value = '';
  $('#msRaw').value = '';
  $('#msDate').value = '';
  state.completed = false;
  closeSheet('sheetMissing');
  renderConfirm();
  scheduleSave();
  toast(`已补充${platformName(platform)}截图漏项`);
}

async function completeReview() {
  const activeSources = state.sources.filter(sourceIsActive);
  if (!activeSources.length || !activeSources.every((source) => reconciliationFor(source).ok)) return showNotice('还有内容需要核对', '请先确认平台总额、分类金额以及所有待确认项。');
  state.completed = true;
  state.step = 5;
  state.completedAt = new Date().toISOString();
  const deleteSetting = APP_MODE === 'demo' ? null : await FinanceDB.getSetting('deleteImagesAfterConfirm');
  if (APP_MODE !== 'demo' && deleteSetting?.value) {
    for (const record of [...imagesByPlatform.wechat, ...imagesByPlatform.alipay]) await FinanceDB.deleteImage(record.id);
    await loadImages(state.month);
  }
  await persistReview();
  renderDone();
  if (APP_MODE !== 'demo') FinanceDB.addEvent('review_completed', { month: state.month, categoryCount: activeSources.reduce((count, source) => count + source.entries.length, 0) }).catch(() => {});
}

function renderDone() {
  const report = reportDataFor(state);
  const confirmed = state.sources.flatMap((source) => source.entries).filter((entry) => entry.confirmed || !entry.needsConfirm).length;
  $('#doneTitle').textContent = `${shortMonth(state.month)}复盘完成`;
  $('#doneSub').textContent = `已确认 ${confirmed} 个分类 · 补充支出 ${state.extraExpenses.length} 条 · 数据仅保存在本机`;
  $('#doneIncome').textContent = fmt(report.income);
  $('#doneExpense').textContent = fmt(report.expense);
  $('#doneBalance').textContent = signed(report.surplus);
  $('#doneBalance').style.color = report.surplus < 0 ? 'var(--danger)' : 'var(--fg)';
  showStep(5, false);
}

function percentChange(current, previous) { return Number(previous || 0) ? (Number(current || 0) - Number(previous || 0)) / Number(previous) * 100 : null; }
function changePill(value, lowerIsBetter = false, kind = '环比') {
  if (value === null) return `<span class="kpill muted">暂无${kind}</span>`;
  const positive = value >= 0;
  const good = lowerIsBetter ? !positive : positive;
  return `<span class="kpill" style="color:${good ? 'var(--income)' : 'var(--expense)'}">${ic(positive ? 'i-arrow-up-right' : 'i-arrow-down-right')}${Math.abs(value).toFixed(1)}% ${kind}</span>`;
}

function incomeStructure(report, review) {
  const items = [
    ['工资', Number(review.income.salary || 0), '#1E40AF'], ['副业', Number(review.income.side || 0), '#2563EB'],
    ['投资理财', Number(review.income.investment || 0), '#0EA5E9'], ['其他', Number(review.income.other || 0) + sum(review.customIncome.map((item) => item.amount)), '#38BDF8']
  ].filter((item) => item[1] > 0);
  if (!items.length) return '<p class="muted">本月未填写收入</p>';
  const segments = items.map(([name, amount, color]) => `<div class="stack-seg" style="width:${amount / report.income * 100}%;background:${color}"></div>`).join('');
  const legend = items.map(([name, amount, color]) => `<span class="legend-item"><i style="background:${color}"></i>${name} ${(amount / report.income * 100).toFixed(1)}%</span>`).join('');
  return `<div class="stacked-bar">${segments}</div><div class="chart-legend">${legend}</div>`;
}

function expensePie(report) {
  const sorted = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return '<p class="muted">本月暂无支出</p>';
  const visible = sorted.slice(0, 5);
  const rest = sum(sorted.slice(5).map(([, value]) => value));
  if (rest > 0) visible.push(['其他分类', rest]);
  const total = report.expense || 1;
  const cx = 55, cy = 55, radius = 45;
  let angle = -Math.PI / 2;
  let paths = '';
  let legend = '';
  visible.forEach(([name, amount], index) => {
    const fraction = amount / total;
    const next = angle + fraction * Math.PI * 2;
    const x1 = cx + radius * Math.cos(angle), y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(next), y2 = cy + radius * Math.sin(next);
    paths += `<path d="M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 ${fraction > .5 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${PALETTE[index % PALETTE.length]}" stroke="#fff" stroke-width="1.5"/>`;
    legend += `<span class="legend-item"><i style="background:${PALETTE[index % PALETTE.length]}"></i>${escapeHtml(name)} ${(fraction * 100).toFixed(1)}%</span>`;
    angle = next;
  });
  return `<div class="pie-flex"><svg viewBox="0 0 110 110" role="img" aria-label="支出结构饼图" style="width:120px;height:120px;display:block">${paths}</svg><div class="chart-legend">${legend}</div></div>`;
}

function flowChart(report, review) {
  if (!report.income && !report.expense) return '<p class="muted" style="padding:16px">暂无可展示的数据</p>';
  const incomeItems = [
    ['工资', Number(review.income?.salary || 0), '#173f70'],
    ['副业', Number(review.income?.side || 0), '#477ab2'],
    ['投资理财', Number(review.income?.investment || 0), '#87a9cd'],
    ['其他收入', Number(review.income?.other || 0) + sum((review.customIncome || []).map((item) => item.amount)), '#c6d5e5']
  ].filter((item) => item[1] > 0);
  if (report.expense > report.income) incomeItems.push(['本月缺口', report.expense - report.income, '#94a3b8']);

  const expenseSource = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]);
  const expenseColors = ['#d85b66', '#df6d76', '#e47f87', '#e99197', '#eda4a9', '#f1b7bb'];
  const expenseItems = expenseSource.slice(0, 5).map(([name, value], index) => [name, value, expenseColors[index]]);
  const remainingExpense = sum(expenseSource.slice(5).map(([, value]) => value));
  if (remainingExpense > 0) expenseItems.push(['其他分类', remainingExpense, '#c87b83']);
  const rightItems = [...expenseItems];
  if (report.surplus > 0) rightItems.push(['结余', report.surplus, '#2f8a62']);

  const width = 430;
  const height = Math.max(286, 88 + Math.max(incomeItems.length, rightItems.length) * 31);
  const leftX = 104, centerX = 211, rightX = 318, nodeWidth = 8, gap = 7;
  const flowTotal = Math.max(report.income, report.expense, 1);
  const flowHeight = Math.min(210, height - 64);
  const scale = flowHeight / flowTotal;
  const centerTop = (height - flowHeight) / 2;
  const thicknessFor = (value) => Math.max(3, Number(value || 0) * scale);
  const groupTop = (items) => {
    const contentHeight = sum(items.map(([, value]) => thicknessFor(value))) + Math.max(0, items.length - 1) * gap;
    return (height - contentHeight) / 2;
  };
  const ribbon = (x1, y1a, y1b, x2, y2a, y2b, color) => {
    const curve = (x2 - x1) * .46;
    return `<path d="M${x1} ${y1a} C${x1 + curve} ${y1a} ${x2 - curve} ${y2a} ${x2} ${y2a} L${x2} ${y2b} C${x2 - curve} ${y2b} ${x1 + curve} ${y1b} ${x1} ${y1b} Z" fill="${color}" fill-opacity=".42"/>`;
  };
  const amountLabel = (name, value) => `${escapeHtml(name)} ¥${Math.round(value).toLocaleString('zh-CN')}`;

  let leftY = groupTop(incomeItems), leftCenterY = centerTop;
  const leftMarkup = incomeItems.map(([name, value, color]) => {
    const thickness = thicknessFor(value);
    const markup = `${ribbon(leftX + nodeWidth, leftY, leftY + thickness, centerX, leftCenterY, leftCenterY + thickness, color)}<rect x="${leftX}" y="${leftY}" width="${nodeWidth}" height="${thickness}" rx="2" fill="${color}"/><text x="${leftX - 7}" y="${leftY + thickness / 2 + 3}" text-anchor="end" class="sankey-label">${amountLabel(name, value)}</text>`;
    leftY += thickness + gap;
    leftCenterY += thickness;
    return markup;
  }).join('');

  let rightY = groupTop(rightItems), rightCenterY = centerTop;
  const rightMarkup = rightItems.map(([name, value, color]) => {
    const thickness = thicknessFor(value);
    const labelColor = name === '结余' ? '#1f6a49' : '#a33a46';
    const markup = `${ribbon(centerX + nodeWidth, rightCenterY, rightCenterY + thickness, rightX, rightY, rightY + thickness, color)}<rect x="${rightX}" y="${rightY}" width="${nodeWidth}" height="${thickness}" rx="2" fill="${color}"/><text x="${rightX + 14}" y="${rightY + thickness / 2 + 3}" class="sankey-label" fill="${labelColor}">${amountLabel(name, value)}</text>`;
    rightY += thickness + gap;
    rightCenterY += thickness;
    return markup;
  }).join('');

  const centerLabel = report.expense > report.income ? `收入及缺口 ¥${fmt(flowTotal)}` : `总收入 ¥${fmt(report.income)}`;
  return `<div class="sankey-intro">收入来源汇入本月总收入，再按支出一级分类与结余分流</div><svg class="mobile-sankey" viewBox="0 0 ${width} ${height}" role="img" aria-label="收入来源、一级支出分类与结余桑基图">${leftMarkup}<rect x="${centerX}" y="${centerTop}" width="${nodeWidth}" height="${flowHeight}" rx="3" fill="#245fa4"/><text x="${centerX + nodeWidth / 2}" y="${centerTop - 12}" text-anchor="middle" class="sankey-total">${centerLabel}</text>${rightMarkup}</svg>`;
}

function yoyMarkup(report, previousYear) {
  if (!previousYear) return `<div class="yoy-empty">${ic('i-info')}完成去年同期月份后自动生成同比变动。</div>`;
  const old = reportDataFor(previousYear);
  const names = [...new Set([...Object.keys(report.byCategory), ...Object.keys(old.byCategory)])];
  const rows = names.map((name) => {
    const current = report.byCategory[name] || 0;
    const previous = old.byCategory[name] || 0;
    const delta = current - previous;
    const percent = previous ? delta / previous * 100 : null;
    const children = report.bySubcategory[name] || {};
    const subRows = Object.entries(children).map(([child, amount]) => { const oldAmount = old.bySubcategory[name]?.[child] || 0; const difference = amount - oldAmount; return `<div class="yoy-row yoy-subrow"><span class="yoy-name sub">${escapeHtml(child)}</span><span class="yoy-v">${fmt(amount)}</span><span class="yoy-v muted">${oldAmount ? fmt(oldAmount) : '—'}</span><span class="${difference >= 0 ? 'up' : 'down'}">${difference >= 0 ? '↑' : '↓'}${fmt(Math.abs(difference))}</span><span class="${difference >= 0 ? 'up' : 'down'}">${oldAmount ? `${Math.abs(difference / oldAmount * 100).toFixed(1)}%` : '新增'}</span></div>`; }).join('');
    return `<button class="yoy-row" data-yoy="${escapeHtml(name)}"><span class="yoy-name"><i class="chev">${ic('i-chevron-right')}</i>${escapeHtml(name)}</span><span class="yoy-v">${fmt(current)}</span><span class="yoy-v muted">${previous ? fmt(previous) : '—'}</span><span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '↑' : '↓'}${fmt(Math.abs(delta))}</span><span class="${delta >= 0 ? 'up' : 'down'}">${percent === null ? '新增' : `${Math.abs(percent).toFixed(1)}%`}</span></button>${subRows ? `<div class="yoy-sub" data-yoy-sub="${escapeHtml(name)}" hidden>${subRows}</div>` : ''}`;
  }).join('');
  return `<div class="yoy-grid yoy-hdr"><span>一级/二级分类</span><span>本月</span><span>去年同月</span><span>变动金额</span><span>同比</span></div>${rows}`;
}

async function openReport(month) {
  reportMonth = month;
  if (state.month !== month) await switchStateMonth(month, { page: 'report' });
  renderReport();
  switchPage('report');
}

function renderReport() {
  $('#repMonthBtn').textContent = monthLabel(reportMonth);
  const review = allReviews.find((item) => item.month === reportMonth);
  const body = $('#reportBody');
  const status = $('.report-status span');
  const dataSourceText = APP_MODE === 'demo' ? '演示数据，仅供体验' : '数据来自当前浏览器';
  if (!review || (!review.completed && reportDataFor(review).income === 0 && reportDataFor(review).expense === 0)) {
    status.innerHTML = `报告状态：<b>未生成</b> · ${dataSourceText}`;
    body.innerHTML = `<div class="empty"><div class="empty-ico">${ic('i-pie')}</div><h3>${monthLabel(reportMonth)}还没有月报</h3><p>完成该月复盘后，这里会生成收支统计、资金流向与同比分析</p><button class="btn btn-primary" id="repCta">去复盘</button></div>`;
    $('#repCta').addEventListener('click', () => openReview(reportMonth));
    return;
  }
  const report = reportDataFor(review);
  const previous = allReviews.find((item) => item.month === shiftMonth(reportMonth, -1));
  const previousReport = previous ? reportDataFor(previous) : null;
  const yearAgo = allReviews.find((item) => item.month === shiftMonth(reportMonth, -12));
  status.innerHTML = `报告状态：<b>${review.completed ? '已完成' : '进行中'}</b> · ${dataSourceText}`;
  const categories = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]);
  const maximum = Math.max(...categories.map(([, amount]) => amount), 1);
  const bars = categories.map(([name, amount], index) => `<div class="cat-row"><span class="cat-ico" style="color:${PALETTE[index % PALETTE.length]}">${ic(`i-${CAT_ICON[name] || 'tag'}`)}</span><div class="cat-main"><div class="cat-line"><span class="cat-name">${escapeHtml(name)}</span><span class="cat-pct tnum">${report.expense ? (amount / report.expense * 100).toFixed(1) : '0.0'}%</span></div><div class="cat-track"><div class="cat-bar" style="width:${amount / maximum * 100}%;background:${PALETTE[index % PALETTE.length]}"></div></div></div><span class="cat-amt tnum">${fmt(amount)}</span></div>`).join('') || '<p class="muted" style="padding:16px">本月暂无支出分类</p>';
  body.innerHTML = `<div class="kpi-row"><div class="kpi-card"><div class="kpi-k">收入总额</div><div class="kpi-v money-in tnum">¥${fmt(report.income)}</div><div class="kpi-pills">${changePill(percentChange(report.income, previousReport?.income), false)}</div><div class="kpi-note">本月手动确认收入</div></div><div class="kpi-card"><div class="kpi-k">支出总额</div><div class="kpi-v money-out tnum">¥${fmt(report.expense)}</div><div class="kpi-pills">${changePill(percentChange(report.expense, previousReport?.expense), true)}</div><div class="kpi-note">截图确认＋其他渠道补充</div></div></div>
    <div class="card balance-strip"><div><span class="bs-k">本月结余</span><span class="bs-v tnum-lg">¥${fmt(report.surplus)}</span></div><span class="bs-meta tnum">结余率 ${report.income ? (report.surplus / report.income * 100).toFixed(1) : '0.0'}%</span></div>
    <div class="sec-title">${ic('i-share-2')}家庭资金流向</div><div class="card sankey-card">${flowChart(report, review)}</div>
    <div class="analysis-grid"><div class="card analysis-card"><div class="card-h"><b>收入结构</b><small>各类收入占当月收入的百分比</small></div>${incomeStructure(report, review)}</div><div class="card analysis-card"><div class="card-h"><b>支出结构</b><small>本月统一一级分类占比</small></div>${expensePie(report)}</div></div>
    <div class="sec-title">${ic('i-trending-up')}支出一级大类同比变动 <span class="sec-sub">${shortMonth(reportMonth)} vs 去年同月</span></div><div class="card yoy-card">${yoyMarkup(report, yearAgo)}</div>
    <div class="sec-title">${ic('i-pie')}分类支出 Top</div><div class="card cat-card">${bars}</div>
    <div class="caliber-note">${ic('i-info')}<span><b>报表口径：</b>收入为手动填写；支出由微信、支付宝确认结果与银行卡/现金补充记录构成；${APP_MODE === 'demo' ? '当前同比环比使用内置演示月份，不会写入你的真实账本。' : '同比环比只使用当前浏览器中真实保存的历史月份。'}</span></div>
    <div class="sec-title">${ic('i-download')}导出月报</div><div class="export-row"><button class="btn btn-primary" id="exportReportHtml">${ic('i-download')}下载月报</button><button class="btn btn-secondary" id="copyReport">${ic('i-copy')}复制摘要</button></div>`;
  $$('[data-yoy]', body).forEach((row) => row.addEventListener('click', () => { const sub = body.querySelector(`[data-yoy-sub="${CSS.escape(row.dataset.yoy)}"]`); if (!sub) return; sub.hidden = !sub.hidden; row.querySelector('.chev').style.transform = sub.hidden ? '' : 'rotate(90deg)'; }));
  $('#exportReportHtml').addEventListener('click', () => exportReportHtml(review));
  $('#copyReport').addEventListener('click', async () => { await navigator.clipboard.writeText(`${monthLabel(reportMonth)}：收入 ${money(report.income)}，支出 ${money(report.expense)}，结余 ${money(report.surplus)}。`); toast('月报摘要已复制'); });
}

function exportBlob(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportReportHtml(review) {
  const report = reportDataFor(review);
  const rows = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]).map(([name, amount]) => `<tr><td>${escapeHtml(name)}</td><td>${money(amount)}</td></tr>`).join('');
  exportBlob(`家财月报-${review.month}.html`, `<!doctype html><meta charset="utf-8"><title>家财月报 ${review.month}</title><style>body{font-family:sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1f2933}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.summary div,table{border:1px solid #ddd;padding:16px;border-radius:10px}strong{display:block;margin-top:8px;font-size:22px}table{width:100%;margin-top:20px;border-collapse:collapse}td{padding:10px;border-top:1px solid #ddd}</style><h1>家财月报 · ${monthLabel(review.month)}</h1><div class="summary"><div>收入<strong>${money(report.income)}</strong></div><div>支出<strong>${money(report.expense)}</strong></div><div>结余<strong>${money(report.surplus)}</strong></div></div><table>${rows}</table><p>收入为手动填写；支出为微信、支付宝确认分类与其他渠道补充。</p>`, 'text/html');
}

const csvCell = (value) => { let text = String(value ?? ''); if (/^[=+@]/.test(text) || /^-(?!\d)/.test(text)) text = `'${text}`; return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
function currentMonthCsv() {
  const rows = [['月份', '记录类型', '平台/渠道', '平台原分类', '一级分类', '二级分类', '金额', '是否计入统计', '录入方式', '备注']];
  const incomeLabels = { salary: '工资收入', side: '副业收入', investment: '投资理财收入', other: '其他收入' };
  Object.entries(state.income).forEach(([key, amount]) => { if (Number(amount) > 0) rows.push([state.month, '收入', '手动填写', incomeLabels[key], incomeLabels[key], '', Number(amount).toFixed(2), '是', '手动', '']); });
  state.customIncome.forEach((item) => { if (Number(item.amount) > 0) rows.push([state.month, '收入', '手动填写', item.name, item.name, '', Number(item.amount).toFixed(2), '是', '手动', '']); });
  state.sources.forEach((source) => source.entries.forEach((entry) => rows.push([state.month, '支出', source.name, entry.source, entry.category, entry.subcategory || '', Number(entry.amount).toFixed(2), entry.include ? '是' : '否', entry.inputMethod === 'ocr' ? '截图识别' : '手动补充', entry.note || ''])));
  state.extraExpenses.forEach((entry) => rows.push([state.month, '支出', entry.source, '', entry.category, entry.subcategory || '', Number(entry.amount).toFixed(2), '是', '平台外补充', entry.note || '']));
  return `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

async function exportBackup() { await persistReview(); const backup = await FinanceDB.exportBackup(); exportBlob(`家财月报-完整本地备份-${state.month}.json`, JSON.stringify(backup)); await FinanceDB.setSetting('lastBackupAt', new Date().toISOString()); toast('完整 JSON 备份已导出'); }
async function restoreBackup(file) { if (!file || !confirm('恢复备份会替换当前浏览器中的全部家财月报数据，确定继续吗？')) return; try { const backup = JSON.parse(await file.text()); await FinanceDB.importBackup(backup); showNotice('备份恢复成功', '页面即将重新加载。'); setTimeout(() => location.reload(), 500); } catch (error) { showNotice('无法恢复备份', error.message); } }
async function exportEvents() { const events = await FinanceDB.listEvents(); const rows = [['事件时间', '事件类型', '月份', '平台', '耗时毫秒', '图片数', '分类数']]; events.forEach((event) => rows.push([event.createdAt || '', event.type || '', event.month || '', event.platform || '', event.durationMs || '', event.imageCount || event.count || '', event.entryCount || event.categoryCount || ''])); exportBlob(`家财月报-试用事件-${state.month}.csv`, `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8'); toast('试用事件 CSV 已导出'); }
async function exportImages() { const records = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay]; if (!records.length) return showNotice('本月没有可导出的原图', '本月未保存截图，或截图已在完成确认后删除。'); records.forEach((record, index) => setTimeout(() => exportBlob(`${platformName(record.platform)}-${index + 1}-${record.name.replace(/[<>:"/\\|?*]/g, '_')}`, record.blob, record.type), index * 180)); toast(`开始下载 ${records.length} 张原始截图`); }

function renderSettings() {
  $('#categoryTreeSummary').innerHTML = categoryTree.map((group) => `<div class="ct1">${ic(`i-${CAT_ICON[group.name] || 'tag'}`)}${escapeHtml(group.name)}</div>${group.children.length ? `<div class="ct2">${group.children.map((child) => `<span>${escapeHtml(child)}</span>`).join('')}</div>` : ''}`).join('');
  renderCustomCategoryList();
  const modeText = APP_MODE === 'demo' ? '当前为演示账本，真实本地数据未被修改' : `当前为我的账本${hasOwnData() ? '，已有本地数据' : '，尚未记录数据'}`;
  const resetModeText = $('#resetModeBtn .set-txt em');
  if (resetModeText) resetModeText.textContent = modeText;
  navigator.storage?.persisted?.().then((persisted) => { $('#storagePill').textContent = persisted ? '已保护' : '未申请'; $('#storagePill').className = `storage-pill${persisted ? '' : ' warn'}`; }).catch(() => {});
}

function renderCustomCategoryList() {
  $('#customCatList').innerHTML = categoryTree.map((group, groupIndex) => `<div class="supply-row"><span class="sn"><b>${escapeHtml(group.name)}</b>${group.children.length ? ` / ${group.children.map(escapeHtml).join('、')}` : ''}</span><button class="pencil" data-delete-category="${groupIndex}" aria-label="删除${escapeHtml(group.name)}">${ic('i-trash-2')}</button></div>`).join('');
}

async function persistCategoryTree() {
  categoryTree = normalizeCategoryTree(categoryTree);
  await Promise.all([FinanceDB.setSetting('expenseCategoryTree', safeClone(categoryTree)), FinanceDB.setSetting('expenseCategorySchemaVersion', CATEGORY_SCHEMA_VERSION)]);
  renderSettings(); renderSupply(); renderConfirm();
}

async function requestStorageProtection() {
  if (!navigator.storage?.persist) return showNotice('当前浏览器不支持', '请定期导出完整 JSON 备份。');
  const granted = await navigator.storage.persist(); renderSettings(); showNotice(granted ? '本地存储保护已增强' : '浏览器没有授予增强保护', granted ? '浏览器会尽量避免自动清理数据，但仍建议定期备份。' : '数据仍会保存在本地，请定期导出备份。');
}

function previewImage(id) {
  const record = [...imagesByPlatform.wechat, ...imagesByPlatform.alipay].find((item) => item.id === id);
  if (!record) return;
  $('#previewTitle').textContent = `${platformName(record.platform)} · ${escapeHtml(record.name)}`;
  $('#previewBody').innerHTML = `<img src="${imageUrl(record)}" alt="${platformName(record.platform)}账单截图" style="width:100%;height:auto;border-radius:10px">`;
  openSheet('sheetPreview');
}

function bindMonthPicker(buttonId, pickerId, getMonth, onChange) {
  const button = document.getElementById(buttonId), picker = document.getElementById(pickerId);
  button.addEventListener('click', () => { picker.value = getMonth(); if (picker.showPicker) { try { picker.showPicker(); return; } catch (_) {} } picker.click(); });
  picker.addEventListener('change', () => { if (picker.value) onChange(picker.value); });
}

function bindEvents() {
  $('#obNext').addEventListener('click', () => { if (onboardingStep < 3) obGo(onboardingStep + 1); else chooseMode('demo').catch((error) => showNotice('无法切换账本', error.message)); });
  $('#obDemo').addEventListener('click', () => chooseMode('demo').catch((error) => showNotice('无法切换账本', error.message)));
  $('#obOwn').addEventListener('click', () => chooseMode('own').catch((error) => showNotice('无法切换账本', error.message)));
  $('#obClose').addEventListener('click', () => { if (onboardingCanClose) hideOnboarding(); });
  $('#resetModeBtn').addEventListener('click', () => { try { localStorage.removeItem(MODE_KEY); } catch (_) {} APP_MODE = null; showOnboarding({ allowClose: false, step: 3 }); });
  $('#reobBtn').addEventListener('click', () => showOnboarding({ allowClose: true, step: 1 }));
  $$('[data-quick-mode]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.quickMode;
    if (mode === APP_MODE) return toast(mode === 'demo' ? '当前已是演示账本' : '当前已是我的账本');
    chooseMode(mode).catch((error) => showNotice('无法切换账本', error.message));
  }));
  $$('.tabbar .tab').forEach((button) => button.addEventListener('click', () => button.dataset.page === 'review' ? openReview(homeMonth) : switchPage(button.dataset.page)));
  $('#homePrev').addEventListener('click', () => { homeMonth = shiftMonth(homeMonth, -1); renderHome(); });
  $('#homeNext').addEventListener('click', () => { homeMonth = shiftMonth(homeMonth, 1); renderHome(); });
  $('#repPrev').addEventListener('click', () => { reportMonth = shiftMonth(reportMonth, -1); renderReport(); });
  $('#repNext').addEventListener('click', () => { reportMonth = shiftMonth(reportMonth, 1); renderReport(); });
  bindMonthPicker('homeMonthBtn', 'homeMonthPicker', () => homeMonth, (month) => { homeMonth = month; renderHome(); });
  bindMonthPicker('repMonthBtn', 'repMonthPicker', () => reportMonth, (month) => { reportMonth = month; renderReport(); });
  $('#reviewClose').addEventListener('click', () => switchPage('home'));
  $('#skipIncome').addEventListener('click', () => showStep(2));
  $('#toStep2').addEventListener('click', () => showStep(2));
  $('#backToStep1').addEventListener('click', () => showStep(1));
  $('#toStep3').addEventListener('click', () => enterStep3().catch((error) => showNotice('识别失败', error.message)));
  $('#backToStep2').addEventListener('click', () => showStep(2));
  $('#toStep4').addEventListener('click', () => showStep(4));
  $('#backToStep3').addEventListener('click', () => showStep(3));
  $('#toStep5').addEventListener('click', () => completeReview().then(renderDone).catch((error) => showNotice('无法完成复盘', error.message)));
  $('#confirmGo').addEventListener('click', () => showStep(4));
  $('#editReviewData').addEventListener('click', () => showStep(1, false));
  $('#genReport').addEventListener('click', () => openReport(state.month));
  $('#backHome').addEventListener('click', () => { homeMonth = state.month; switchPage('home'); });
  $('#editMonthBtn').addEventListener('click', () => openReview(reportMonth));
  $('#addIncCat').addEventListener('click', () => { const name = prompt('输入自定义收入分类名称'); if (!name?.trim()) return; state.customIncome.push({ name: name.trim().slice(0, 16), amount: 0 }); renderIncome(); scheduleSave(); });
  $('#addSupply').addEventListener('click', addSupply);
  $('#msSave').addEventListener('click', addMissingEntry);
  $('#supL1').addEventListener('change', () => fillCategorySelect('supL1', 'supL2', { category: $('#supL1').value }));
  $('#msL1').addEventListener('change', () => fillCategorySelect('msL1', 'msL2', { category: $('#msL1').value }));
  $$('.plat-help').forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.guide === 'alipay' ? 'sheetGuideAli' : 'sheetGuideWx')));
  $('#homePrivacyBtn').addEventListener('click', () => openSheet('sheetPrivacy'));
  $('#privacyBtn2').addEventListener('click', () => openSheet('sheetPrivacy'));
  $('#manageCatBtn').addEventListener('click', () => { renderCustomCategoryList(); openSheet('sheetCat'); });
  $('#manageCatBtn2').addEventListener('click', () => { renderCustomCategoryList(); openSheet('sheetCat'); });
  $('#ruleBtn').addEventListener('click', () => openSheet('sheetRule'));
  $('#msMissingBtn').addEventListener('click', () => { fillCategorySelect('msL1', 'msL2'); openSheet('sheetMissing'); });
  $('#noticeOk').addEventListener('click', () => $('#notice').classList.remove('show'));
  $('#requestStorageBtn').addEventListener('click', () => requestStorageProtection().catch((error) => showNotice('申请失败', error.message)));
  $('#delShotToggle').addEventListener('click', async () => { const on = !$('#delShotToggle').classList.contains('on'); $('#delShotToggle').classList.toggle('on', on); $('#delShotToggle').setAttribute('aria-checked', String(on)); await FinanceDB.setSetting('deleteImagesAfterConfirm', on); });
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', (event) => restoreBackup(event.target.files[0]));
  $('#clearBtn').addEventListener('click', () => { $('#clearModal').hidden = false; });
  $('#doClear').addEventListener('click', async () => { await FinanceDB.clearAll(); location.reload(); });
  $$('.export-item').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.exp;
    if (action === 'json') exportBackup().catch((error) => showNotice('备份失败', error.message));
    if (action === 'csv') { exportBlob(`家财月报-${state.month}.csv`, currentMonthCsv(), 'text/csv;charset=utf-8'); toast('本月 CSV 已导出'); }
    if (action === 'event') exportEvents().catch((error) => showNotice('导出失败', error.message));
    if (action === 'shots') exportImages().catch((error) => showNotice('导出失败', error.message));
  }));
  $('#addCatBtn').addEventListener('click', () => { const primary = $('#newL1').value.trim().slice(0, 12), secondary = $('#newL2').value.trim().slice(0, 16); if (!primary) return toast('请填写一级分类'); let group = categoryTree.find((item) => item.name === primary); if (!group) { group = { name: primary, children: [] }; categoryTree.push(group); } if (secondary && !group.children.includes(secondary)) group.children.push(secondary); $('#newL1').value = ''; $('#newL2').value = ''; persistCategoryTree().then(() => toast('分类已保存')); });
  $('#resetCatBtn').addEventListener('click', () => { if (!confirm('恢复预设分类不会修改历史记录，确定继续吗？')) return; categoryTree = DEFAULT_CATEGORY_TREE.map((group) => ({ name: group.name, children: [...group.children] })); persistCategoryTree().then(() => toast('已恢复系统预设分类')); });
  $('#guideImgWx').addEventListener('click', () => { $('#previewTitle').textContent = '微信合格截图'; $('#previewBody').innerHTML = `<img src="${$('#guideImgWx').src}" alt="微信合格截图" style="width:100%;height:auto;border-radius:10px">`; openSheet('sheetPreview'); });
  $('#guideImgAli').addEventListener('click', () => { $('#previewTitle').textContent = '支付宝合格截图'; $('#previewBody').innerHTML = `<img src="${$('#guideImgAli').src}" alt="支付宝合格截图" style="width:100%;height:auto;border-radius:10px">`; openSheet('sheetPreview'); });

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]'); if (close) { const id = close.dataset.close; const modal = document.getElementById(id); if (modal?.classList.contains('sheet-layer')) closeSheet(id); else if (modal) modal.hidden = true; return; }
    const addShot = event.target.closest('.add-shot'); if (addShot) { document.getElementById(`${addShot.dataset.plat}AlbumFiles`).click(); return; }
    const deleteShot = event.target.closest('[data-delete-image]'); if (deleteShot) { deleteImage(deleteShot.dataset.imagePlatform, deleteShot.dataset.deleteImage).catch((error) => showNotice('删除失败', error.message)); return; }
    const preview = event.target.closest('[data-preview-image]'); if (preview) { previewImage(preview.dataset.previewImage); return; }
    const deleteIncome = event.target.closest('[data-delete-income]'); if (deleteIncome) { state.customIncome.splice(Number(deleteIncome.dataset.deleteIncome), 1); renderIncome(); scheduleSave(); return; }
    const confirmEntry = event.target.closest('[data-confirm-source]'); if (confirmEntry) { const entry = state.sources[Number(confirmEntry.dataset.confirmSource)].entries[Number(confirmEntry.dataset.confirmEntry)]; entry.confirmed = true; state.completed = false; renderConfirm(); scheduleSave(); return; }
    const editEntry = event.target.closest('[data-edit-entry]'); if (editEntry) { editingEntryId = editingEntryId === editEntry.dataset.editEntry ? null : editEntry.dataset.editEntry; renderConfirm(); return; }
    const cancelEdit = event.target.closest('.edit-cancel'); if (cancelEdit) { editingEntryId = null; renderConfirm(); return; }
    const saveEdit = event.target.closest('.edit-save'); if (saveEdit) { const form = saveEdit.closest('.it-edit'); const source = state.sources[Number(form.dataset.sourceIndex)]; const entry = source.entries[Number(form.dataset.entryIndex)]; entry.category = form.querySelector('.mobile-primary').value; entry.subcategory = form.querySelector('.mobile-secondary').disabled ? '' : form.querySelector('.mobile-secondary').value; entry.amount = Number(form.querySelector('.edit-val').value || 0); entry.include = form.querySelector('.mobile-include input').checked; entry.confirmed = true; entry.corrected = true; if (APP_MODE !== 'demo') { categoryMappings[`${source.id}|${entry.source}`] = { category: entry.category, subcategory: entry.subcategory, include: entry.include }; FinanceDB.setSetting('ocrCategoryMappings', categoryMappings).catch(() => {}); } editingEntryId = null; state.completed = false; renderConfirm(); scheduleSave(); toast(APP_MODE === 'demo' ? '演示修改已临时保存' : '修改已保存'); return; }
    const deleteEntry = event.target.closest('[data-delete-entry]'); if (deleteEntry) { state.sources[Number(deleteEntry.dataset.sourceIndex)].entries.splice(Number(deleteEntry.dataset.deleteEntry), 1); state.completed = false; renderConfirm(); scheduleSave(); return; }
    const confirmMonth = event.target.closest('[data-confirm-month]'); if (confirmMonth) { state.sources[Number(confirmMonth.dataset.confirmMonth)].monthConfirmed = true; state.completed = false; renderConfirm(); scheduleSave(); return; }
    const confirmTotal = event.target.closest('[data-confirm-total]'); if (confirmTotal) { state.sources[Number(confirmTotal.dataset.confirmTotal)].totalConfirmed = true; state.completed = false; renderConfirm(); scheduleSave(); return; }
    const missing = event.target.closest('[data-missing-platform]'); if (missing) { $('#msPlat').value = missing.dataset.missingPlatform === 'wechat' ? '微信支付' : '支付宝'; fillCategorySelect('msL1', 'msL2'); openSheet('sheetMissing'); return; }
    const deleteSupply = event.target.closest('[data-delete-supply]'); if (deleteSupply) { state.extraExpenses.splice(Number(deleteSupply.dataset.deleteSupply), 1); state.completed = false; renderSupply(); scheduleSave(); return; }
    const deleteCategory = event.target.closest('[data-delete-category]'); if (deleteCategory) { if (categoryTree.length === 1) return toast('至少保留一个一级分类'); categoryTree.splice(Number(deleteCategory.dataset.deleteCategory), 1); persistCategoryTree(); return; }
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('.platform-file-input')) { const platform = event.target.id.startsWith('wechat') ? 'wechat' : 'alipay'; handleFiles(platform, event.target.files).catch((error) => showNotice('截图保存失败', error.message)); event.target.value = ''; }
    if (event.target.matches('[data-source-total]')) { const source = state.sources[Number(event.target.dataset.sourceTotal)]; source.total = Number(event.target.value || 0); source.totalConfirmed = source.total > 0; source.totalSource = 'manual'; state.completed = false; renderConfirm(); scheduleSave(); }
    if (event.target.matches('.mobile-primary')) { const form = event.target.closest('.it-edit'); const options = secondaryOptionsFor(event.target.value); const secondary = form.querySelector('.mobile-secondary'); secondary.innerHTML = options.length ? options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('') : '<option value="">无二级分类</option>'; secondary.disabled = !options.length; }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-income]')) { state.income[event.target.dataset.income] = Number(event.target.value || 0); $('#incTotal').textContent = money(incomeTotal()); state.completed = false; scheduleSave(); }
    if (event.target.matches('[data-custom-income]')) { state.customIncome[Number(event.target.dataset.customIncome)].amount = Number(event.target.value || 0); $('#incTotal').textContent = money(incomeTotal()); state.completed = false; scheduleSave(); }
  });
}

async function initialize() {
  if (!window.FinanceDB || !window.FinanceOCR) throw new Error('核心数据模块没有加载，请刷新页面重试。');
  await FinanceDB.open();
  const [categorySetting, mappingSetting, schemaSetting, deleteSetting] = await Promise.all([FinanceDB.getSetting('expenseCategoryTree'), FinanceDB.getSetting('ocrCategoryMappings'), FinanceDB.getSetting('expenseCategorySchemaVersion'), FinanceDB.getSetting('deleteImagesAfterConfirm')]);
  categoryTree = normalizeCategoryTree(categorySetting?.value);
  if (Number(schemaSetting?.value || 0) < CATEGORY_SCHEMA_VERSION) {
    ['房租', '房贷', '父母', '人情', '其他'].forEach((name) => { const group = categoryTree.find((item) => item.name === name); if (group) group.children = []; });
    await Promise.all([FinanceDB.setSetting('expenseCategoryTree', safeClone(categoryTree)), FinanceDB.setSetting('expenseCategorySchemaVersion', CATEGORY_SCHEMA_VERSION)]);
  }
  categoryMappings = mappingSetting?.value && typeof mappingSetting.value === 'object' ? mappingSetting.value : {};
  await refreshReviews();
  $('#delShotToggle').classList.toggle('on', Boolean(deleteSetting?.value));
  $('#delShotToggle').setAttribute('aria-checked', String(Boolean(deleteSetting?.value)));
  bindEvents();
  const params = new URLSearchParams(location.search);
  const needsOnboarding = APP_MODE === null;
  await loadModeState(APP_MODE === 'demo' ? 'demo' : 'own');
  const page = params.get('p');
  if (page === 'review') switchPage('review'); else if (page === 'report') switchPage('report'); else if (page === 'settings') switchPage('settings'); else switchPage('home');
  const step = Number(params.get('s')); if (page === 'review' && step >= 1 && step <= 5) { showStep(step, false); if (step === 3) { $('#ocrZone').hidden = true; $('#confirmZone').hidden = false; renderShotStrip(); renderConfirm(); } }
  const sheet = params.get('sheet'); if (sheet && document.getElementById(sheet)) openSheet(sheet);
  const onboardingParam = Number(params.get('ob'));
  if (needsOnboarding) showOnboarding({ allowClose: false, step: onboardingParam >= 1 && onboardingParam <= 3 ? onboardingParam : 1 });
}

initialize().catch((error) => showNotice('手机端初始化失败', error.message || '请刷新页面重试。'));
window.addEventListener('beforeunload', () => imageObjectUrls.forEach((url) => URL.revokeObjectURL(url)));
